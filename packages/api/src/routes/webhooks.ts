import { Hono } from 'hono';
import { XMLParser } from 'fast-xml-parser';
import { query, queryOne } from '../db/client.js';
import { Candidate, Position } from '../db/types.js';
import { getNewMessages, parseCandidate, sendEmail, watchInbox, GmailMessage } from '../services/gmail.js';
import { logMessage, isOptOut, normalizePhone, getCandidateByPhone } from '../services/sms.js';
import { scoreCandidate, extractContactInfo, generateInitialSMS } from '../services/ai.js';
import { handleInboundSMS } from '../services/conversation.js';
import { notify } from '../services/telegram.js';
import { queueForApproval } from '../services/approval.js';
import { fetchIndeedResume, extractApplicationUrl } from '../services/indeed.js';

const webhooks = new Hono();

// historyId is persisted to DB — see getStoredHistoryId / setStoredHistoryId below
async function getStoredHistoryId(): Promise<string> {
  const row = await queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'gmail_history_id'`, []);
  return row?.value ? (JSON.parse(row.value) as string) : '';
}

async function setStoredHistoryId(id: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('gmail_history_id', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(id)]
  );
}

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

    const storedHistoryId = await getStoredHistoryId();
    if (!historyId || historyId === storedHistoryId) return;

    const prevHistoryId = storedHistoryId;
    await setStoredHistoryId(historyId);

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

  // Try to fetch resume from Indeed if this is an Indeed notification email
  let indeedResumeText = '';
  if (parsed.rawEmail.includes('indeed.com') || parsed.rawEmail.toLowerCase().includes('indeed')) {
    const appUrl = extractApplicationUrl(parsed.rawEmail);
    if (appUrl) {
      console.log(`[Indeed] Found application URL: ${appUrl}`);
      indeedResumeText = await fetchIndeedResume(appUrl).catch(() => '');
      if (indeedResumeText.length > 100) {
        console.log(`[Indeed] Resume fetched: ${indeedResumeText.length} chars`);
        parsed.resumeText = indeedResumeText;
      }
    }
  }

  // Determine whether a real resume was included
  const hasAttachmentText = msg.attachments.some((a) => a.text && a.text.length > 50);
  const hasResume = (parsed.resumeText.length >= 100) || indeedResumeText.length >= 100 || hasAttachmentText;

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
  ).catch(() => ({ score: 0, reasoning: 'Scoring failed — skipping to avoid false positives' }));

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

  // Threshold: must score ≥50 to proceed to SMS outreach
  const threshold = 50; // Score < 50 → decline
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
    const posTitle = position?.title ?? 'Sales Rep';
    const questions: Array<{ question: string }> = (position?.knockout_questions ?? []) as Array<{ question: string }>;
    const firstQuestion = questions[0]?.question;

    // Generate personalized opener — references something real from their resume,
    // flows directly into the first knockout question (no YES/NO gate)
    const smsBody = await generateInitialSMS(name, posTitle, parsed.resumeText, firstQuestion, hasResume).catch(() => {
      const firstName = name.split(' ')[0];
      const fallbackQ = firstQuestion ? ` Quick question — ${firstQuestion}` : '';
      return `Hey ${firstName}! Hunter here from Frontline Adjusters — saw your application for ${posTitle}.${fallbackQ}`;
    });

    // Route through approval queue — Chris approves before it fires
    await queueForApproval(candidate.id, name, phone, posTitle, '', smsBody).catch(console.error);
    await query(`UPDATE candidates SET state = 'sms_sent', updated_at = now() WHERE id = $1`, [candidate.id]);
    await notify(`📨 New candidate: *${name}* (${posTitle}, score: ${score}/100) — pending approval`);
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

// Gmail watch renewal — call weekly to keep push notifications active
// Requires Bearer auth (applied at app level for non-webhook routes,
// but we expose this here for convenience with a manual token check)
webhooks.post('/gmail/watch', async (c) => {
  const auth = c.req.header('Authorization') ?? '';
  const password = process.env.AUTH_PASSWORD;
  if (password && auth !== `Bearer ${password}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    const result = await watchInbox();
    await setStoredHistoryId(result.historyId);
    return c.json({ ok: true, historyId: result.historyId, expiration: result.expiration });
  } catch (err) {
    console.error('watchInbox error:', err);
    return c.json({ error: 'Failed to activate Gmail watch' }, 500);
  }
});

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

// Indeed ATS webhook — handles both XML (Indeed Apply standard) and JSON formats
webhooks.post('/indeed', async (c) => {
  void processIndeedWebhookAsync(c.req.raw.clone());
  return c.json({ ok: true });
});

interface IndeedApplicantData {
  name: string;
  email: string;
  phone: string | null;
  resumeText: string;
  positionTitle: string;
}

async function parseIndeedPayload(req: Request): Promise<IndeedApplicantData | null> {
  const rawText = await req.text();
  if (!rawText) return null;

  const contentType = req.headers.get('content-type') ?? '';

  // Try JSON first (Format B)
  if (contentType.includes('application/json') || rawText.trimStart().startsWith('{')) {
    try {
      const data = JSON.parse(rawText) as {
        applicant?: {
          fullName?: string;
          email?: string;
          phoneNumber?: string;
          resume?: { file?: string; text?: string };
        };
        job?: { title?: string };
      };
      const applicant = data?.applicant;
      if (!applicant?.email) return null;

      let resumeText = '';
      if (applicant.resume?.text) {
        resumeText = applicant.resume.text;
      } else if (applicant.resume?.file) {
        // Attempt plain-text decode of base64 file; works for text resumes
        try {
          resumeText = Buffer.from(applicant.resume.file, 'base64').toString('utf8');
        } catch {
          resumeText = '';
        }
      }

      return {
        name: applicant.fullName ?? 'Unknown',
        email: applicant.email,
        phone: applicant.phoneNumber ? (normalizePhone(applicant.phoneNumber) ?? null) : null,
        resumeText,
        positionTitle: data?.job?.title ?? 'Sales Rep',
      };
    } catch {
      // Fall through to XML parsing
    }
  }

  // Fallback: XML (Format A — Indeed Apply standard)
  try {
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const parsed = parser.parse(rawText) as Record<string, unknown>;
    const callback = (parsed?.['indeed-apply-callback'] ?? {}) as Record<string, unknown>;
    const applicant = (callback?.applicant ?? {}) as Record<string, unknown>;
    const job = (callback?.job ?? {}) as Record<string, unknown>;

    const email = String(applicant?.email ?? '').trim();
    if (!email) return null;

    const rawPhone = String(applicant?.phone ?? '').trim();
    const resumeText = String(applicant?.resume ?? '').trim();

    return {
      name: String(applicant?.fullname ?? 'Unknown').trim(),
      email,
      phone: rawPhone ? (normalizePhone(rawPhone) ?? null) : null,
      resumeText,
      positionTitle: String(job?.title ?? 'Sales Rep').trim(),
    };
  } catch {
    return null;
  }
}

async function processIndeedWebhookAsync(req: Request): Promise<void> {
  try {
    const data = await parseIndeedPayload(req);
    if (!data || !data.email) {
      console.log('Indeed webhook: could not parse applicant data');
      return;
    }

    const { name, email, phone, resumeText, positionTitle } = data;

    // Deduplicate by email
    const existing = await queryOne<Candidate>(
      `SELECT * FROM candidates WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email]
    );
    if (existing) {
      console.log(`Indeed: duplicate application from ${email}, skipping`);
      return;
    }

    // Match position
    let position: Position | null = null;
    if (positionTitle) {
      position = await queryOne<Position>(
        `SELECT * FROM positions WHERE title ILIKE $1 AND status = 'active' LIMIT 1`,
        [positionTitle]
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
      resumeText,
      position?.title ?? 'Sales Rep'
    ).catch(() => ({ score: 0, reasoning: 'Scoring failed — skipping to avoid false positives' }));

    // Save candidate
    const rawSource = `Indeed Application\nName: ${name}\nEmail: ${email}\nPhone: ${phone ?? 'N/A'}\n\n${resumeText}`;
    const rows = await query<Candidate>(
      `INSERT INTO candidates (position_id, name, email, phone, resume_text, raw_email, fit_score, state, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', 'indeed')
       RETURNING *`,
      [position?.id ?? null, name, email, phone, resumeText, rawSource, score]
    );

    const candidate = rows[0];
    if (!candidate) return;

    await logMessage(candidate.id, 'inbound', 'email', rawSource);

    // Threshold: score ≥50 to proceed
    const threshold = 50;
    if (score < threshold) {
      await query(`UPDATE candidates SET state = 'rejected', updated_at = now() WHERE id = $1`, [candidate.id]);
      await notify(`❌ Indeed: auto-declined *${name}* (score: ${score}/100) — ${reasoning}`);
      return;
    }

    const hasResume = resumeText.length >= 100;

    if (phone) {
      const posTitle = position?.title ?? 'Sales Rep';
      const questions: Array<{ question: string }> = (position?.knockout_questions ?? []) as Array<{ question: string }>;
      const firstQuestion = questions[0]?.question;

      const smsBody = await generateInitialSMS(name, posTitle, resumeText, firstQuestion, hasResume).catch(() => {
        const firstName = name.split(' ')[0];
        const fallbackQ = firstQuestion ? ` Quick question — ${firstQuestion}` : '';
        const fallbackResume = !hasResume ? ` Also, feel free to text or email your resume or LinkedIn whenever you get a chance.` : '';
        return `Hey ${firstName}! Hunter here from Frontline Adjusters — saw your Indeed application for ${posTitle}.${fallbackQ}${fallbackResume}`;
      });

      await queueForApproval(candidate.id, name, phone, posTitle, '', smsBody).catch(console.error);
      await query(`UPDATE candidates SET state = 'sms_sent', updated_at = now() WHERE id = $1`, [candidate.id]);
      await notify(`📨 Indeed candidate: *${name}* (${posTitle}, score: ${score}/100) — pending approval`);
    } else {
      await notify(`📨 Indeed candidate: *${name}* (score: ${score}/100) — no phone number provided`);
    }
  } catch (err) {
    console.error('Indeed webhook processing error:', err);
  }
}

export default webhooks;
