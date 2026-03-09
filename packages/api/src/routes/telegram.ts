import { Hono } from 'hono';
import { query, queryOne } from '../db/client.js';
import { PendingMessage } from '../db/types.js';
import { sendSMS, logMessage } from '../services/sms.js';
import { answerCallbackQuery, editMessage } from '../services/telegram.js';

const telegramRouter = new Hono();

// ─────────────────────────────────────────────
//  POST /api/telegram/callback
//  Receives all Telegram updates (callback_query + regular messages from Chris).
//  No auth — Telegram pushes to this endpoint.
// ─────────────────────────────────────────────

interface TelegramUser {
  id: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: { message_id: number };
  data?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  text?: string;
  chat?: { id: number };
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

telegramRouter.post('/callback', async (c) => {
  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.json({ ok: true }); // always ack
  }

  // Handle inline button presses
  if (update.callback_query) {
    void handleCallbackQuery(update.callback_query).catch(console.error);
    return c.json({ ok: true });
  }

  // Handle plain text messages from Chris (edit flow)
  if (update.message?.text) {
    void handlePlainMessage(update.message).catch(console.error);
  }

  return c.json({ ok: true });
});

// ─────────────────────────────────────────────
//  Callback query handler (button presses)
// ─────────────────────────────────────────────

async function handleCallbackQuery(cq: TelegramCallbackQuery): Promise<void> {
  const { id: callbackQueryId, data } = cq;
  if (!data) {
    await answerCallbackQuery(callbackQueryId, '');
    return;
  }

  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) {
    await answerCallbackQuery(callbackQueryId, 'Unknown action');
    return;
  }

  const action = data.slice(0, colonIdx);
  const pendingId = data.slice(colonIdx + 1);

  const row = await queryOne<PendingMessage>(
    `SELECT * FROM pending_messages WHERE id = $1`,
    [pendingId]
  );

  // Already handled or not found — just dismiss the spinner
  if (!row || row.state !== 'pending') {
    await answerCallbackQuery(callbackQueryId, '⚠️ Already handled');
    return;
  }

  switch (action) {
    case 'approve':
      await handleApprove(callbackQueryId, row);
      break;
    case 'edit':
      await handleEdit(callbackQueryId, row);
      break;
    case 'skip':
      await handleSkip(callbackQueryId, row);
      break;
    default:
      await answerCallbackQuery(callbackQueryId, 'Unknown action');
  }
}

async function handleApprove(callbackQueryId: string, row: PendingMessage): Promise<void> {
  // Mark approved
  await query(
    `UPDATE pending_messages SET state = 'approved', sent_at = now() WHERE id = $1`,
    [row.id]
  );

  // Send the SMS
  try {
    await sendSMS(row.candidate_phone, row.message);
    await logMessage(row.candidate_id, 'outbound', 'sms', row.message);
  } catch (err) {
    console.error('sendSMS error on approve:', err);
  }

  // Update Telegram card
  if (row.telegram_message_id) {
    await editMessage(row.telegram_message_id, `✅ *Sent* — ${row.message}`);
  }

  await answerCallbackQuery(callbackQueryId, '✅ Sent!');
}

async function handleEdit(callbackQueryId: string, row: PendingMessage): Promise<void> {
  // Set state to 'editing' so the next plain message from Chris is treated as the edit
  await query(
    `UPDATE pending_messages SET state = 'editing' WHERE id = $1`,
    [row.id]
  );

  if (row.telegram_message_id) {
    await editMessage(
      row.telegram_message_id,
      `✏️ *Editing* — reply to this chat with your edited version:\n\n"${row.message}"`
    );
  }

  await answerCallbackQuery(callbackQueryId, '✏️ Reply with your edited version');
}

async function handleSkip(callbackQueryId: string, row: PendingMessage): Promise<void> {
  await query(
    `UPDATE pending_messages SET state = 'skipped' WHERE id = $1`,
    [row.id]
  );

  if (row.telegram_message_id) {
    await editMessage(row.telegram_message_id, `❌ *Skipped* — message not sent`);
  }

  await answerCallbackQuery(callbackQueryId, '❌ Skipped');
}

// ─────────────────────────────────────────────
//  Plain message handler (edit flow)
// ─────────────────────────────────────────────

async function handlePlainMessage(msg: TelegramMessage): Promise<void> {
  const text = msg.text?.trim();
  if (!text) return;

  // Find the most recent pending_message in 'editing' state
  const row = await queryOne<PendingMessage>(
    `SELECT * FROM pending_messages WHERE state = 'editing' ORDER BY created_at DESC LIMIT 1`
  );
  if (!row) return; // No pending edit — ignore (Chris is just chatting)

  const editedMessage = text;

  // 1. Log feedback before sending
  await query(
    `INSERT INTO feedback_log (candidate_id, position_title, conversation_context, hunter_draft, chris_edit)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      row.candidate_id,
      row.position_title,
      row.conversation_context,
      row.message,
      editedMessage,
    ]
  );

  // 2. Mark pending_message as edited and sent
  await query(
    `UPDATE pending_messages
     SET state = 'edited', edited_message = $1, sent_at = now()
     WHERE id = $2`,
    [editedMessage, row.id]
  );

  // 3. Send the edited SMS
  try {
    await sendSMS(row.candidate_phone, editedMessage);
    await logMessage(row.candidate_id, 'outbound', 'sms', editedMessage);
  } catch (err) {
    console.error('sendSMS error on edit send:', err);
  }

  // 4. Update Telegram card
  if (row.telegram_message_id) {
    await editMessage(
      row.telegram_message_id,
      `✏️ *Edited & Sent*\n\n~~Draft:~~ _${row.message}_\n\n*Sent:* ${editedMessage}`
    );
  }
}

// ─────────────────────────────────────────────
//  GET /api/telegram/flush-pending
//  Cron job — auto-send messages that expired without a response.
//  Call every 30 minutes.
// ─────────────────────────────────────────────

telegramRouter.get('/flush-pending', async (c) => {
  const expired = await query<PendingMessage>(
    `SELECT * FROM pending_messages WHERE state = 'pending' AND expires_at < now()`
  );

  let sent = 0;
  let errors = 0;

  for (const row of expired) {
    try {
      await sendSMS(row.candidate_phone, row.message);
      await logMessage(row.candidate_id, 'outbound', 'sms', row.message);

      await query(
        `UPDATE pending_messages SET state = 'auto_sent', sent_at = now() WHERE id = $1`,
        [row.id]
      );

      if (row.telegram_message_id) {
        await editMessage(
          row.telegram_message_id,
          `⏱ *Auto-sent* (no response after 4h)\n\n${row.message}`
        );
      }

      sent++;
    } catch (err) {
      console.error(`flush-pending: error on ${row.id}:`, err);
      errors++;
    }
  }

  return c.json({ ok: true, sent, errors, total: expired.length });
});

export default telegramRouter;
