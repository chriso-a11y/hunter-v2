import TelegramBot from 'node-telegram-bot-api';
import { Candidate } from '../db/types.js';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  if (!bot) {
    bot = new TelegramBot(token);
  }
  return bot;
}

const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

export async function notify(message: string): Promise<void> {
  const b = getBot();
  if (!b || !CHAT_ID) {
    console.log('[Telegram notify]', message);
    return;
  }
  try {
    await b.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram notify error:', err);
  }
}

export async function notifyWithCandidate(
  candidate: Candidate,
  message: string,
  positionTitle?: string
): Promise<void> {
  const scoreBar = '█'.repeat(Math.round((candidate.fit_score ?? 0) / 10)) +
    '░'.repeat(10 - Math.round((candidate.fit_score ?? 0) / 10));

  const text = `${message}

👤 *${candidate.name}*
📋 Role: ${positionTitle ?? 'Unknown'}
📱 Phone: ${candidate.phone ?? 'N/A'}
📧 Email: ${candidate.email}
📊 Fit Score: ${candidate.fit_score}/100 \`${scoreBar}\``;

  await notify(text);
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

/**
 * Sends a message with an inline keyboard.
 * Returns the Telegram message_id, or null on failure.
 */
export async function sendWithInlineKeyboard(
  text: string,
  buttons: InlineButton[][]
): Promise<number | null> {
  const b = getBot();
  if (!b || !CHAT_ID) {
    console.log('[Telegram sendWithInlineKeyboard]', text);
    return null;
  }
  try {
    const msg = await b.sendMessage(CHAT_ID, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
    return msg.message_id;
  } catch (err) {
    console.error('Telegram sendWithInlineKeyboard error:', err);
    return null;
  }
}

/**
 * Answers a Telegram callback query (dismisses the loading spinner).
 */
export async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  const b = getBot();
  if (!b) return;
  try {
    await b.answerCallbackQuery(callbackQueryId, { text });
  } catch (err) {
    console.error('Telegram answerCallbackQuery error:', err);
  }
}

/**
 * Edits the text of an existing Telegram message.
 */
export async function editMessage(messageId: number, newText: string): Promise<void> {
  const b = getBot();
  if (!b || !CHAT_ID) return;
  try {
    await b.editMessageText(newText, {
      chat_id: CHAT_ID,
      message_id: messageId,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('Telegram editMessage error:', err);
  }
}
