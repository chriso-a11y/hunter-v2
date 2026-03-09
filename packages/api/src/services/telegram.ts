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
