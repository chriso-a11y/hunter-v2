import twilio from 'twilio';
import { query, queryOne } from '../db/client.js';
import { Candidate, Message } from '../db/types.js';

let twilioClient: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!twilioClient) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return twilioClient;
}

export async function sendSMS(to: string, body: string): Promise<void> {
  const client = getClient();
  await client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER!,
    to,
    body,
  });
}

export async function logMessage(
  candidateId: string,
  direction: 'inbound' | 'outbound',
  channel: 'sms' | 'email',
  body: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await query(
    `INSERT INTO messages (candidate_id, direction, channel, body, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [candidateId, direction, channel, body, JSON.stringify(metadata)]
  );
}

export async function getCandidateByPhone(phone: string): Promise<Candidate | null> {
  return queryOne<Candidate>(
    `SELECT * FROM candidates WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
    [phone]
  );
}

// Normalize phone to E.164
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 7) return `+${digits}`;
  return null;
}

const OPT_OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'cancel', 'end', 'quit']);

export function isOptOut(body: string): boolean {
  return OPT_OUT_KEYWORDS.has(body.trim().toLowerCase());
}
