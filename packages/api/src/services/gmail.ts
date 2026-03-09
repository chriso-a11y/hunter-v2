import { google } from 'googleapis';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { normalizePhone } from './sms.js';

function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });
  return oauth2Client;
}

function getGmail() {
  return google.gmail({ version: 'v1', auth: getOAuth2Client() });
}

async function fetchAttachmentText(
  messageId: string,
  attachmentId: string,
  mimeType: string
): Promise<string> {
  try {
    const gmail = getGmail();
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    const b64 = res.data.data;
    if (!b64) return '';

    // Gmail uses URL-safe base64; convert to standard before creating a Buffer
    const standard = b64.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(standard, 'base64');

    if (mimeType.includes('pdf')) {
      const result = await pdfParse(buffer);
      return result.text ?? '';
    }

    if (
      mimeType.includes('msword') ||
      mimeType.includes('wordprocessingml.document')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? '';
    }

    if (mimeType.includes('text/plain')) {
      return buffer.toString('utf8');
    }

    return '';
  } catch (err) {
    console.error(`fetchAttachmentText error (attachmentId=${attachmentId}, mimeType=${mimeType}):`, err);
    return '';
  }
}

export async function watchInbox(): Promise<{ historyId: string; expiration: string }> {
  const gmail = getGmail();
  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: process.env.GMAIL_PUBSUB_TOPIC,
      labelIds: ['INBOX'],
    },
  });
  return {
    historyId: res.data.historyId ?? '',
    expiration: res.data.expiration ?? '',
  };
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  data: string;
  text: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  attachments: GmailAttachment[];
}

export async function getNewMessages(historyId: string): Promise<GmailMessage[]> {
  const gmail = getGmail();

  try {
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    });

    const history = historyRes.data.history ?? [];
    const messageIds = new Set<string>();

    for (const item of history) {
      for (const msg of item.messagesAdded ?? []) {
        if (msg.message?.id) messageIds.add(msg.message.id);
      }
    }

    const messages: GmailMessage[] = [];

    for (const msgId of messageIds) {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full',
        });

        const msg = msgRes.data;
        const headers = msg.payload?.headers ?? [];

        const from = headers.find((h) => h.name === 'From')?.value ?? '';
        const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';

        const { body, attachments } = extractBodyAndAttachments(msg.payload as MessagePart | null);

        // Fetch and extract text for document attachments
        for (const attachment of attachments) {
          const mt = attachment.mimeType.toLowerCase();
          if (
            mt.includes('pdf') ||
            mt.includes('word') ||
            mt.includes('document') ||
            mt.includes('text/plain')
          ) {
            attachment.text = await fetchAttachmentText(msgId, attachment.data, mt);
          }
        }

        messages.push({ id: msgId, threadId: msg.threadId ?? '', from, subject, body, attachments });
      } catch (err) {
        console.error(`Failed to fetch message ${msgId}:`, err);
      }
    }

    return messages;
  } catch (err) {
    console.error('getNewMessages error:', err);
    return [];
  }
}

interface MessagePart {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null } | null;
  parts?: MessagePart[] | null;
}

function extractBodyAndAttachments(
  payload: MessagePart | null | undefined
): { body: string; attachments: GmailAttachment[] } {
  let body = '';
  const attachments: GmailAttachment[] = [];

  function walk(part: MessagePart): void {
    if (!part) return;
    const mimeType = part.mimeType ?? '';

    if (mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf8');
    } else if (mimeType === 'text/html' && !body && part.body?.data) {
      const html = Buffer.from(part.body.data, 'base64').toString('utf8');
      body += html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType,
        data: part.body.attachmentId,
        text: '',
      });
    }

    for (const sub of part.parts ?? []) {
      walk(sub);
    }
  }

  if (payload) walk(payload as MessagePart);
  return { body, attachments };
}

export interface ParsedCandidate {
  name: string;
  email: string;
  phone: string | null;
  resumeText: string;
  rawEmail: string;
  positionHint: string | null;
}

export function parseCandidate(msg: GmailMessage): ParsedCandidate {
  const raw = `From: ${msg.from}\nSubject: ${msg.subject}\n\n${msg.body}`;

  // Extract email from From header
  const emailMatch = msg.from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : '';

  // Extract name from From header
  const nameMatch = msg.from.match(/^"?([^<"]+)"?\s*</);
  const name = nameMatch ? nameMatch[1].trim() : email.split('@')[0] ?? 'Unknown';

  // Extract phone from body
  const phoneMatch = msg.body.match(/(\+?1?\s*[\.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
  const rawPhone = phoneMatch ? phoneMatch[1] : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // Detect position from subject/body
  const combined = `${msg.subject} ${msg.body}`.toLowerCase();
  let positionHint: string | null = null;
  if (combined.includes('bookkeeper') || combined.includes('book keeper')) {
    positionHint = 'Bookkeeper';
  } else if (combined.includes('sales rep') || combined.includes('sales representative') || combined.includes('field sales')) {
    positionHint = 'Sales Rep';
  }

  const attachmentTexts = msg.attachments
    .filter((a) => a.text && a.text.length > 50)
    .map((a) => `\n\n--- Resume (${a.filename}) ---\n${a.text}`)
    .join('');
  const resumeText = msg.body + attachmentTexts;

  return {
    name,
    email,
    phone,
    resumeText,
    rawEmail: raw,
    positionHint,
  };
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const gmail = getGmail();

  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body,
  ];

  const message = messageParts.join('\n');
  const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
}
