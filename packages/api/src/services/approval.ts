import { query } from '../db/client.js';
import { PendingMessage } from '../db/types.js';
import { sendWithInlineKeyboard } from './telegram.js';

/**
 * Queues a draft SMS for Telegram approval before it is sent.
 * Sends Chris an approval card with inline buttons (Send / Edit / Skip).
 * Returns the pending_message UUID.
 */
export async function queueForApproval(
  candidateId: string,
  candidateName: string,
  candidatePhone: string,
  positionTitle: string,
  conversationContext: string,
  draftMessage: string
): Promise<string> {
  // 1. Insert into pending_messages (with context for later feedback logging)
  const rows = await query<PendingMessage>(
    `INSERT INTO pending_messages
       (candidate_id, candidate_phone, message, state, position_title, conversation_context)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING *`,
    [candidateId, candidatePhone, draftMessage, positionTitle, conversationContext]
  );

  const row = rows[0];
  if (!row) throw new Error('Failed to insert pending_message');

  const pendingId = row.id;

  // 2. Build Telegram approval card
  const header = `💬 *Hunter → ${candidateName}* _(${positionTitle})_`;
  const contextBlock = conversationContext
    ? `\n\n*Recent messages:*\n${conversationContext}`
    : '';
  const draft = `\n\n*Draft SMS:*\n"${draftMessage}"`;
  const text = `${header}${contextBlock}${draft}`;

  const buttons = [
    [
      { text: '✅ Send', callback_data: `approve:${pendingId}` },
      { text: '✏️ Edit', callback_data: `edit:${pendingId}` },
      { text: '❌ Skip', callback_data: `skip:${pendingId}` },
    ],
  ];

  // 3. Send Telegram message and store message_id
  const telegramMessageId = await sendWithInlineKeyboard(text, buttons);

  if (telegramMessageId !== null) {
    await query(
      `UPDATE pending_messages SET telegram_message_id = $1 WHERE id = $2`,
      [telegramMessageId, pendingId]
    );
  }

  // 4. Return the pending_id
  return pendingId;
}
