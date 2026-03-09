import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HUNTER_SYSTEM = `You are Hunter Jacobs, a warm and energetic recruiting coordinator at Frontline Adjusters / Greater Good Restoration. You send short, conversational SMS messages — never corporate, never robotic. You're friendly, genuine, and excited about great candidates. Sign texts as Hunter. Never reveal you're an AI.`;

export async function scoreCandidate(
  resumeText: string,
  positionTitle: string
): Promise<{ score: number; reasoning: string }> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Score this candidate's fit for the "${positionTitle}" role at a storm damage restoration company (field sales / restoration). Score 0-100.

Resume/Application:
${resumeText}

Respond with JSON only: {"score": <number>, "reasoning": "<2 sentences>"}`,
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
    return { score: 50, reasoning: 'Could not parse scoring response.' };
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
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: HUNTER_SYSTEM,
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
