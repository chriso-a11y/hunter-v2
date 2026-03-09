import { Hono } from 'hono';
import { query, queryOne } from '../db/client.js';
import { Candidate, Position } from '../db/types.js';
import { getNewMessages, parseCandidate, sendEmail, GmailMessage } from '../services/gmail.js';
import { sendSMS, logMessage, isOptOut, normalizePhone, getCandidateByPhone } from '../services/sms.js';
import { scoreCandidate, extractContactInfo } from '../services/ai.js';
import { handleInboundSMS } from '../services/conversation.js';
import { notify } from '../services/telegram.js';

const webhooks = new Hono();

// Track last processed historyId
let lastHistoryId = '';

// Gmail Pub/Sub push
webhooks.post('/gmail', async (c) => {
  // Always return 200 immediately — process async
  void processGmailPushAsync(c.req.raw.clone());
  return c.json({ ok: true });
});

async function processGmailPushAsync(req: Request): Promise<void> {
  try {
    const body = await req.json() as { message?: { data?: string } };
    const dataB64 = body?.message?.data;
    if (!dataB64) return;

    const decoded = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8')) as { historyId?: string };
    const historyId = decoded.historyId?.toString() ?? '';

    if (!historyId || historyId === lastHistoryId) return;

    const prevHistoryId = lastHistoryId;
    lastHistoryId = historyId;

    if (!prevHistoryId) return; // First notification — just store historyId

    const messages = await getNewMessages(prevHistoryId);

    for (const msg of messages) {
      await processInboundEmail(msg);
    }
  } catch (err) {
    console.error('Gmail webhook processing error:', err);
  }
}

async function processInboundEmail(msg: GmailMessage): Promise<void> {
  const parsed = parseCandidate(msg);

  // Skip if clearly spam/automated (no body content worth considering)
  if (!parsed.email || parsed.resumeText.length < 20) return;

  // Use AI to extract contact info if parsing was uncertain
  let name = parsed.name;
  let email = parsed.email;
  let phone = parsed.phone;

  if (!phone || name === 'Unknown') {
    const extracted = await extractContactInfo(parsed.rawEmail).catch(() => null);
    if (extracted) {
      if (extracted.name && name === 'Unknown') name = extracted.name;
      if (extracted.email && !email) email = extracted.email;
      if (extracted.phone && !phone) {
        phone = normalizePhone(extracted.phone);
      }
    }
  }

  if (!email) {
    console.log('No email found in message, skipping');
    return;
  }

  // Check for existing candidate by email
  const existing = await queryOne<Candidate>(
    `SELECT * FROM candidates WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
    [email]
  );
  if (existing) {
    console.log(`Duplicate application from ${email}, skipping`);
    return;
  }

  // Match position
  let position: Position | null = null;
  if (parsed.positionHint) {
    position = await queryOne<Position>(
      `SELECT * FROM positions WHERE title ILIKE $1 AND status = 'active' LIMIT 1`,
      [parsed.positionHint]
    );
  }
  if (!position) {
    position = await queryOne<Position>(
      `SELECT * FROM positions WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`,
      []
    );
  }

  // Score candidate
  const { score, reasoning } = await scoreCandidate(
    parsed.resumeText,
    position?.title ?? 'Sales Rep'
  ).catch(() => ({ score: 50, reasoning: '' }));

  // Save candidate
  const rows = await query<Candidate>(
    `INSERT INTO candidates (position_id, name, email, phone, resume_text, raw_email, fit_score, state, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', 'email')
     RETURNING *`,
    [position?.id ?? null, name, email, phone, parsed.resumeText, parsed.rawEmail, score]
  );

  const candidate = rows[0];
  if (!candidate) return;

  // Log inbound email
  await logMessage(candidate.id, 'inbound', 'email', parsed.rawEmail);

  // Score < 30 → decline
  const threshold = 30;
  if (score < threshold) {
    const declineEmail = buildDeclineEmail(name);
    await sendEmail(email, 'Your Application to Frontline Adjusters', declineEmail).catch(console.error);
    await logMessage(candidate.id, 'outbound', 'email', declineEmail);
    await query(`UPDATE candidates SET state = 'rejected', updated_at = now() WHERE id = $1`, [candidate.id]);
    await notify(`❌ Auto-declined ${name} (score: ${score}/100) — ${reasoning}`);
    return;
  }

  // Score >= 30
  if (phone) {
    // Send initial SMS
    const firstName = name.split(' ')[0];
    const posTitle = position?.title ?? 'Sales Rep';
    const smsBody = `Hey ${firstName}! 👋 This is Hunter with Frontline Adjusters — saw your application for ${posTitle}. Super excited to connect! Mind if I ask you a couple quick questions to see if it's a good fit?\n\nReply YES to continue or STOP to opt out.`;

    await sendSMS(phone, smsBody).catch(console.error);
    await logMessage(candidate.id, 'outbound', 'sms', smsBody);
    await query(`UPDATE candidates SET state = 'sms_sent', updated_at = now() WHERE id = $1`, [candidate.id]);
    await notify(`📨 New candidate: *${name}* (${posTitle}, score: ${score}/100) — SMS sent`);
  } else {
    // No phone — ask for it via email
    const askPhone = buildAskPhoneEmail(name, position?.title ?? 'Sales Rep');
    await sendEmail(email, 'Quick Question — Frontline Adjusters', askPhone).catch(console.error);
    await logMessage(candidate.id, 'outbound', 'email', askPhone);
    await notify(`📨 New candidate: *${name}* (score: ${score}/100) — no phone, email sent requesting it`);
  }
}

function buildDeclineEmail(name: string): string {
  const firstName = name.split(' ')[0];
  return `Hi ${firstName},

Thank you so much for applying to Frontline Adjusters! We really appreciate your interest.

After reviewing your application, we've decided to move forward with other candidates at this time. We'll keep your information on file and reach out if anything changes.

Wishing you the best in your search!

Hunter Jacobs
Recruiting Coordinator
Frontline Adjusters`;
}

function buildAskPhoneEmail(name: string, positionTitle: string): string {
  const firstName = name.split(' ')[0];
  return `Hi ${firstName},

Thanks so much for applying for the ${positionTitle} role at Frontline Adjusters!

We'd love to connect — could you share your cell number? We have a quick 10-minute screening process and want to make sure we can reach you.

Just reply to this email with your number and we'll be in touch!

Hunter Jacobs
Recruiting Coordinator
Frontline Adjusters`;
}

// Twilio inbound SMS webhook
webhooks.post('/twilio', async (c) => {
  // Return 200 immediately
  const formData = await c.req.formData().catch(() => null);

  void processTwilioWebhook(formData).catch(console.error);

  // Twilio expects TwiML or empty 200
  c.header('Content-Type', 'text/xml');
  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

webhooks.get('/twilio', async (c) => {
  return c.json({ ok: true });
});

async function processTwilioWebhook(formData: FormData | null): Promise<void> {
  if (!formData) return;

  const from = formData.get('From')?.toString() ?? '';
  const body = formData.get('Body')?.toString() ?? '';

  if (!from || !body) return;

  const normalizedFrom = normalizePhone(from) ?? from;
  const candidate = await getCandidateByPhone(normalizedFrom);

  if (!candidate) {
    console.log(`Inbound SMS from unknown number: ${from}`);
    return;
  }

  // Log inbound
  await logMessage(candidate.id, 'inbound', 'sms', body);

  // Handle opt-out
  if (isOptOut(body)) {
    await query(
      `UPDATE candidates SET state = 'opted_out', opted_out = true, updated_at = now() WHERE id = $1`,
      [candidate.id]
    );
    await notify(`🛑 Opt-out: *${candidate.name}* has unsubscribed from SMS`);
    return;
  }

  // Don't engage opted-out candidates
  if (candidate.opted_out || candidate.state === 'opted_out') return;

  await handleInboundSMS(normalizedFrom, body, candidate);
}

export default webhooks;
