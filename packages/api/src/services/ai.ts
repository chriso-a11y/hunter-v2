import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';
import { FeedbackLog } from '../db/types.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HUNTER_SYSTEM = `You are Hunter Jacobs, recruiting coordinator at Greater Good Restoration / Frontline Adjusters in Glen Ellyn, IL. You communicate with job candidates via SMS.

Your personality: warm, direct, honest, concise. You write like a real person — not a corporate template. You adapt your tone to match each candidate. You're genuinely trying to find good people and help them figure out if this role is right for them.

About the company: Greater Good Restoration / Frontline Adjusters is a storm damage restoration and public adjusting company in Glen Ellyn, IL (western Chicago suburbs, DuPage County). They do roofing, siding, gutters, and storm damage repair, working with insurance companies on behalf of homeowners.

Rules:
- Never lie about the role, compensation, or company
- Never pressure candidates
- Be upfront that sales is commission-only — no base salary
- Keep texts short — 1-3 sentences max
- Write like a real human texting, not a corporate template
- Sign texts as Hunter
- Never reveal you are an AI
- You screen and schedule. Chris Owens interviews and hires. You don't make hiring decisions.`;

const SALES_REP_RUBRIC = `
SALES REP RUBRIC (score 0-100):

ROLE CONTEXT: Field sales reps knock doors in DuPage and Cook counties after storm events. Commission-only — no base salary. Top performers earn $80–150K+/year; average $50–80K. Peaks in spring/summer storm season, but year-round work. No prior sales experience required — attitude beats resume. Score for hustle, thick skin, comfort outdoors, resilience to rejection.

STRONG POSITIVE (each +15-20pts):
- Field sales experience (door-to-door, canvassing, outside sales)
- Insurance / roofing / restoration / construction industry background
- Commission-only or commission-primary experience

MODERATE POSITIVE (each +8-12pts):
- Mentions owning a vehicle or having a valid driver's license
- Chicagoland / DuPage / Cook / Will / Kane County location
- Hungry, motivated language ("driven", "goal-oriented", "competitive", "grind", "hustle")
- Any B2C sales experience
- Language indicating thick skin or resilience ("don't take no for an answer", "love the challenge")

NEUTRAL (0pts):
- Retail sales only
- No prior sales experience but shows hustle indicators
- Recent graduate willing to work hard

NEGATIVE (each -10-20pts):
- Only remote/desk/call center jobs with no field interest
- Passive application language ("seeking opportunities", "open to roles") with no energy
- No mention of vehicle or driving
- Explicitly requires base salary or fixed compensation
`.trim();

const BOOKKEEPER_RUBRIC = `
BOOKKEEPER RUBRIC (score 0-100):

ROLE CONTEXT: Full-time, on-site in Glen Ellyn, IL. $70,000–$75,000/year. Supports a small but fast-growing contractor business — QuickBooks Online, job costing, subcontractor payments, AP/AR. Must be able to work on-site; remote-only is disqualifying.

STRONG POSITIVE (each +15-20pts):
- QuickBooks Online experience (explicit — QBO specifically, not just "QuickBooks")
- Contractor / construction / trade business accounting
- AP/AR experience

MODERATE POSITIVE (each +8-12pts):
- Small business accounting background
- Job costing or project billing experience
- Glen Ellyn / DuPage County / Chicagoland location

NEGATIVE (each -10-20pts):
- Only large corporate accounting (Fortune 500 / enterprise)
- Only QuickBooks Desktop — not Online
- Remote-only preference mentioned
- Part-time availability only (this is a full-time role)
- Salary expectation explicitly $90K+ (role pays $70–75K)
`.trim();

const COMPANY_CONTEXT = `Greater Good Restoration / Frontline Adjusters is a storm damage restoration and public adjusting company in Glen Ellyn, IL (DuPage County, western Chicago suburbs). They do roofing, siding, gutters, and storm damage repair, working with insurance companies on behalf of homeowners.

Sales reps knock doors in DuPage and Cook counties meeting homeowners after storm events. Commission-only — no base salary. Top reps earn $80–150K+/year, average $50–80K. No prior experience required; attitude and hustle matter most.

The bookkeeper role is full-time, on-site in Glen Ellyn at $70,000–$75,000/year. It supports a fast-growing contractor business — QuickBooks Online, job costing, subcontractor payments, AP/AR.

Score based on realistic fit for THESE specific roles. If a candidate applied for one role but clearly fits the other better, flag that in the reasoning field.`;

/**
 * Pulls the 10 most recent feedback_log rows and formats them as few-shot
 * examples showing how Chris improved Hunter's drafts. Returns an empty
 * string if there are no rows yet (cold start).
 */
export async function getFeedbackExamples(): Promise<string> {
  try {
    const rows = await query<FeedbackLog>(
      `SELECT position_title, conversation_context, hunter_draft, chris_edit
       FROM feedback_log
       ORDER BY created_at DESC
       LIMIT 10`
    );
    if (rows.length === 0) return '';

    const examples = rows
      .map((r, i) => {
        const ctx = r.conversation_context ? `\nContext:\n${r.conversation_context}` : '';
        return `Example ${i + 1} (${r.position_title ?? 'Unknown role'}):${ctx}\nHunter draft: "${r.hunter_draft}"\nChris sent instead: "${r.chris_edit}"`;
      })
      .join('\n\n');

    return `\n\n---\nLEARNED FROM CHRIS'S EDITS (use these to calibrate your tone and style — prefer Chris's phrasing patterns over Hunter's drafts):\n${examples}\n---`;
  } catch {
    return '';
  }
}

export async function scoreCandidate(
  resumeText: string,
  positionTitle: string
): Promise<{ score: number; reasoning: string }> {
  const isBookkeeper = /bookkeeper|bookkeeping/i.test(positionTitle);
  const rubric = isBookkeeper ? BOOKKEEPER_RUBRIC : SALES_REP_RUBRIC;
  const roleLabel = isBookkeeper ? 'Bookkeeper' : 'Sales Rep';

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `${COMPANY_CONTEXT}

Score this candidate's fit for the "${roleLabel}" role using the rubric below. Apply each criterion explicitly and tally a final score from 0-100.

${rubric}

Resume/Application:
${resumeText}

Apply the rubric step by step (internally), then respond with JSON only:
{"score": <number 0-100>, "reasoning": "<2-3 sentences: key scoring factors, and if the candidate appears to be a strong fit for the OTHER role instead, flag that explicitly>"}`,
      },
    ],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]) as { score: number; reasoning: string };
    return { score: Math.min(100, Math.max(0, parsed.score)), reasoning: parsed.reasoning };
  } catch {
    return { score: 0, reasoning: 'Scoring failed — skipping to avoid false positives' };
  }
}

export async function extractContactInfo(
  emailText: string
): Promise<{ name: string; email: string; phone: string | null }> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Extract contact info from this email. Return JSON only: {"name": "<full name>", "email": "<email>", "phone": "<phone or null>"}

Email:
${emailText.slice(0, 3000)}`,
      },
    ],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    return JSON.parse(jsonMatch[0]) as { name: string; email: string; phone: string | null };
  } catch {
    return { name: 'Unknown', email: '', phone: null };
  }
}

export async function generateKnockoutReply(
  question: string,
  answer: string,
  isLast: boolean,
  pass: boolean
): Promise<string> {
  const feedbackExamples = await getFeedbackExamples();
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: HUNTER_SYSTEM + feedbackExamples,
    messages: [
      {
        role: 'user',
        content: pass
          ? isLast
            ? `The candidate just answered the last knockout question with: "${answer}". They passed all questions. Generate a warm, excited 1-2 sentence SMS response telling them they sound like a great fit and you're going to grab some interview times. Don't ask another question yet.`
            : `The candidate answered "${answer}" to the question "${question}" and passed. Generate a brief, warm 1-sentence SMS acknowledgment that flows naturally into asking the next question. The next question will be appended separately — just end your sentence naturally so the next question follows.`
          : `The candidate answered "${answer}" to the question "${question}" and unfortunately this is a disqualifying answer. Generate a warm, brief 1-2 sentence SMS saying unfortunately it's not the right fit, wishing them luck. Don't be robotic. Sign off as Hunter.`,
      },
    ],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
}

export async function detectIntent(
  message: string
): Promise<{ intent: 'yes' | 'no' | 'unsure' | 'question' | 'other'; confidence: number }> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `Classify the intent of this SMS message. Options: yes, no, unsure, question, other.
"yes" = affirmative, agreement, "yeah", "yep", "absolutely", "sure", "i do", "yes i can", etc.
"no" = negative, disagreement, "nope", "i don't", "can't", "not really", etc.
"unsure" = hedging, "maybe", "not sure", "i think so", etc.
"question" = they're asking something.
"other" = none of the above.

Message: "${message}"

Respond with JSON only: {"intent": "<one of the options>", "confidence": <0.0-1.0>}`,
      },
    ],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    return JSON.parse(jsonMatch[0]) as { intent: 'yes' | 'no' | 'unsure' | 'question' | 'other'; confidence: number };
  } catch {
    return { intent: 'other', confidence: 0.5 };
  }
}

export async function generateCandidateSummary(
  name: string,
  positionTitle: string,
  resumeText: string,
  fitScore: number
): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: `Write a 2-sentence summary of why ${name} (fit score: ${fitScore}/100) is a good fit for the ${positionTitle} role. Be specific. Base it on: ${resumeText.slice(0, 1000)}`,
      },
    ],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
}

export async function generateInitialSMS(
  name: string,
  positionTitle: string,
  resumeText: string,
  firstKnockoutQuestion?: string
): Promise<string> {
  const firstName = name.split(' ')[0];

  const questionInstruction = firstKnockoutQuestion
    ? `End the message by asking this knockout question conversationally (not as a checkbox): "${firstKnockoutQuestion}"`
    : `End with a warm, open-ended invitation to chat — something like "Would love to connect if you're still interested!" or similar.`;

  const feedbackExamples = await getFeedbackExamples();

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: HUNTER_SYSTEM + feedbackExamples,
    messages: [
      {
        role: 'user',
        content: `Write a personalized initial SMS from Hunter to ${firstName}, who applied for the ${positionTitle} role at Greater Good Restoration / Frontline Adjusters.

Rules:
- 2-3 sentences total — keep it tight
- Reference something SPECIFIC from their application or resume: a real previous employer, a skill, their city, a credential — something that proves you actually read it. Do NOT make things up — only reference what's there.
- Do NOT include a "Reply YES to continue" gate or any opt-in prompt — skip it entirely
- Do NOT say "Super excited" or use corporate filler
- ${questionInstruction}
- Write like a real human texting from their phone, not a corporate template
- Sign as Hunter

Resume/Application:
${resumeText.slice(0, 2000)}

Target style: "Hey Marcus! Hunter here from Frontline Adjusters — noticed you've got door-to-door experience at Vivint, that's exactly the kind of hustle we're looking for. Do you have a valid driver's license?"

Write the SMS now (just the message text, nothing else):`,
      },
    ],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
  if (text) return text;

  // Fallback: generic but still skips the gate
  const fallbackQ = firstKnockoutQuestion ? ` Quick question — ${firstKnockoutQuestion}` : '';
  return `Hey ${firstName}! Hunter here from Frontline Adjusters — saw your application for the ${positionTitle} role.${fallbackQ}`;
}

export async function generateUnsureResponse(question: string): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    system: HUNTER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `The candidate gave an unclear answer to the question: "${question}". Generate a friendly 1-sentence SMS asking them to clarify with a yes or no. Keep it casual.`,
      },
    ],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : `Just to clarify — ${question} Is that a yes or no? 😊`;
}
