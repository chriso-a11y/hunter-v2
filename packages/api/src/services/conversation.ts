import { query, queryOne } from '../db/client.js';
import { Candidate, KnockoutQuestion, Position, CalendarSlot } from '../db/types.js';
import { logMessage } from './sms.js';
import { queueForApproval } from './approval.js';
import { detectIntent, generateKnockoutReply, generateUnsureResponse, generateCandidateSummary } from './ai.js';
import { getAvailableSlots, bookSlot } from './calendar.js';
import { notify, notifyWithCandidate } from './telegram.js';

async function updateCandidate(
  id: string,
  fields: Partial<Candidate>
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = $${i++}`);
    values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
  }

  sets.push(`updated_at = now()`);
  values.push(id);

  await query(
    `UPDATE candidates SET ${sets.join(', ')} WHERE id = $${i}`,
    values
  );
}

async function getPosition(positionId: string): Promise<Position | null> {
  return queryOne<Position>(`SELECT * FROM positions WHERE id = $1`, [positionId]);
}

/**
 * Queues a draft outbound SMS for Telegram approval before it is sent.
 * Builds conversation context from the last 3 logged messages.
 */
async function outbound(
  candidateId: string,
  phone: string,
  message: string,
  candidate: Candidate,
  positionTitle: string
): Promise<void> {
  const recentMessages = await query<{ direction: string; body: string; created_at: Date }>(
    `SELECT direction, body, created_at FROM messages WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [candidateId]
  );
  const context = recentMessages
    .reverse()
    .map((m) => `${m.direction === 'inbound' ? '👤' : '🤖'} ${m.body}`)
    .join('\n');

  await queueForApproval(candidateId, candidate.name, phone, positionTitle, context, message);
  // SMS is dispatched by the approval handler (approve action or auto-send cron) — not here.
}

export async function handleInboundSMS(from: string, body: string, candidate: Candidate): Promise<void> {
  const trimmed = body.trim();

  // Opt-out already handled before this function is called

  const position = candidate.position_id
    ? await getPosition(candidate.position_id)
    : null;

  const posTitle = position?.title ?? 'Unknown';

  // Route by state
  switch (candidate.state) {
    case 'sms_sent':
      await handleSMSSent(candidate, trimmed, position);
      break;

    case 'screening':
      await handleScreening(candidate, trimmed, position);
      break;

    case 'qualified':
      await handleQualified(candidate, trimmed, position);
      break;

    case 'scheduled':
      // Candidate replied after scheduling — just acknowledge
      await outbound(
        candidate.id,
        candidate.phone!,
        `Thanks ${candidate.name.split(' ')[0]}! We'll see you then. Feel free to reach out if you have any questions before the call 😊 — Hunter`,
        candidate,
        posTitle
      );
      break;

    default:
      // Don't engage in states where we shouldn't
      break;
  }
}

async function handleSMSSent(
  candidate: Candidate,
  body: string,
  position: Position | null
): Promise<void> {
  const posTitle = position?.title ?? 'Unknown';
  const { intent } = await detectIntent(body);

  // Only decline on an explicit "no" — anything else counts as engagement.
  // The initial SMS already asked question 0, so their reply IS the answer to it.
  if (intent === 'no') {
    await updateCandidate(candidate.id, { state: 'declined' });
    await outbound(
      candidate.id,
      candidate.phone!,
      `No worries at all, ${candidate.name.split(' ')[0]}! Best of luck with your search! — Hunter`,
      candidate,
      posTitle
    );
    return;
  }

  // Any other response (yes, unsure, question, other) = they engaged.
  // Transition to screening and treat this reply as the answer to question 0.
  await updateCandidate(candidate.id, { state: 'screening' });
  await handleScreening({ ...candidate, state: 'screening' }, body, position);
}

async function handleScreening(
  candidate: Candidate,
  body: string,
  position: Position | null
): Promise<void> {
  const posTitle = position?.title ?? 'Unknown';
  const questions: KnockoutQuestion[] = position?.knockout_questions ?? [];
  const responses = candidate.knockout_responses as Record<string, string>;

  // Figure out which question we're on
  const answeredCount = Object.keys(responses).length;
  const currentIndex = answeredCount;

  if (currentIndex >= questions.length) {
    // All questions already answered — shouldn't be here, but handle gracefully
    await moveToQualified(candidate, position);
    return;
  }

  const currentQuestion = questions[currentIndex];
  const { intent } = await detectIntent(body);

  // Handle unsure
  if (intent === 'unsure' || intent === 'other') {
    const clarify = await generateUnsureResponse(currentQuestion.question);
    await outbound(candidate.id, candidate.phone!, clarify, candidate, posTitle);
    return;
  }

  // Record response
  const newResponses = { ...responses, [currentIndex.toString()]: body };
  await updateCandidate(candidate.id, { knockout_responses: newResponses });

  // Check if disqualifying
  const isDisqualified =
    (intent === 'no' && currentQuestion.disqualify_on === 'no') ||
    (intent === 'yes' && currentQuestion.disqualify_on === 'yes');

  if (isDisqualified) {
    const declineMsg = await generateKnockoutReply(currentQuestion.question, body, false, false);
    await updateCandidate(candidate.id, { state: 'declined', knockout_pass: false });
    await outbound(candidate.id, candidate.phone!, declineMsg, candidate, posTitle);
    return;
  }

  const nextIndex = currentIndex + 1;
  const isLast = nextIndex >= questions.length;

  // Generate transition reply
  const transition = await generateKnockoutReply(currentQuestion.question, body, isLast, true);

  if (isLast) {
    // All questions passed
    await updateCandidate(candidate.id, { knockout_pass: true });
    await outbound(candidate.id, candidate.phone!, transition, candidate, posTitle);
    // Move to qualified and send slots
    await moveToQualified(candidate, position);
  } else {
    // Ask next question
    const nextQuestion = questions[nextIndex];
    const message = `${transition} ${nextQuestion.question}`;
    await outbound(candidate.id, candidate.phone!, message, candidate, posTitle);
  }
}

async function moveToQualified(candidate: Candidate, position: Position | null): Promise<void> {
  await updateCandidate(candidate.id, { state: 'qualified' });
  await sendSchedulingOptions(candidate, position);
}

// Store pending slots in the candidate notes as JSON temporarily
// (avoids a new table)
async function sendSchedulingOptions(
  candidate: Candidate,
  position: Position | null
): Promise<void> {
  const posTitle = position?.title ?? 'Unknown';
  let slots: CalendarSlot[] = [];
  try {
    slots = await getAvailableSlots(5, 3);
  } catch (err) {
    console.error('Calendar error, sending fallback:', err);
    // Fallback if calendar is not configured
    await outbound(
      candidate.id,
      candidate.phone!,
      `Amazing — you sound like a great fit! Our hiring manager Chris will be reaching out to schedule a quick call very soon. We'll be in touch! 🙌 — Hunter`,
      candidate,
      posTitle
    );
    return;
  }

  if (slots.length === 0) {
    await outbound(
      candidate.id,
      candidate.phone!,
      `Amazing — you sound like a great fit! Chris will reach out shortly to schedule a quick call. Stay tuned! 🙌 — Hunter`,
      candidate,
      posTitle
    );
    return;
  }

  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣'];
  const slotLines = slots
    .map((s, i) => `${numberEmojis[i]} ${s.label}`)
    .join('\n');

  const message = `Here are a few times that work for a quick call with Chris:\n\n${slotLines}\n\nJust reply with 1, 2, or 3 — or let me know if none of these work!`;

  // Save slots to notes field temporarily
  const slotData = slots.map((s) => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    label: s.label,
  }));

  await updateCandidate(candidate.id, {
    notes: JSON.stringify({ pending_slots: slotData, prev_notes: candidate.notes }),
  });

  await outbound(candidate.id, candidate.phone!, message, candidate, posTitle);
}

async function handleQualified(
  candidate: Candidate,
  body: string,
  position: Position | null
): Promise<void> {
  const posTitle = position?.title ?? 'Unknown';
  // Try to parse slot selection
  const trimmed = body.trim();
  const slotMatch = trimmed.match(/^[123]$/);

  let notesObj: { pending_slots?: Array<{ start: string; end: string; label: string }>; prev_notes?: string } = {};
  try {
    if (candidate.notes) notesObj = JSON.parse(candidate.notes) as typeof notesObj;
  } catch {
    notesObj = {};
  }

  const pendingSlots = notesObj.pending_slots ?? [];

  if (!slotMatch || pendingSlots.length === 0) {
    // They said something else — maybe "none of these work" or a question
    const { intent } = await detectIntent(body);
    if (intent === 'no' || trimmed.toLowerCase().includes('none') || trimmed.toLowerCase().includes("don't work")) {
      // Offer to find other times
      let newSlots: CalendarSlot[] = [];
      try {
        newSlots = await getAvailableSlots(10, 3);
      } catch {
        newSlots = [];
      }
      if (newSlots.length > 0) {
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣'];
        const slotLines = newSlots.map((s, i) => `${numberEmojis[i]} ${s.label}`).join('\n');
        const slotData = newSlots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), label: s.label }));
        await updateCandidate(candidate.id, { notes: JSON.stringify({ pending_slots: slotData, prev_notes: notesObj.prev_notes }) });
        await outbound(
          candidate.id,
          candidate.phone!,
          `No problem! Here are a few more options:\n\n${slotLines}\n\nJust reply 1, 2, or 3!`,
          candidate,
          posTitle
        );
      } else {
        await outbound(
          candidate.id,
          candidate.phone!,
          `Got it! Chris will reach out directly to find a time that works for you. Looking forward to connecting! — Hunter`,
          candidate,
          posTitle
        );
      }
    } else {
      await outbound(
        candidate.id,
        candidate.phone!,
        `Hey! Just reply with 1, 2, or 3 to pick a time for your call with Chris 😊`,
        candidate,
        posTitle
      );
    }
    return;
  }

  const slotIndex = parseInt(trimmed) - 1;
  const chosenSlot = pendingSlots[slotIndex];

  if (!chosenSlot) {
    await outbound(
      candidate.id,
      candidate.phone!,
      `Please reply with 1, 2, or 3 to pick your preferred time!`,
      candidate,
      posTitle
    );
    return;
  }

  const slot: CalendarSlot = {
    start: new Date(chosenSlot.start),
    end: new Date(chosenSlot.end),
    label: chosenSlot.label,
  };

  let eventId = '';
  try {
    eventId = await bookSlot(slot, candidate.name, candidate.email);
  } catch (err) {
    console.error('bookSlot error:', err);
  }

  await updateCandidate(candidate.id, {
    state: 'scheduled',
    interview_at: slot.start.toISOString(),
    calendar_event_id: eventId || null,
    notes: notesObj.prev_notes ?? null,
  });

  // Confirm to candidate
  await outbound(
    candidate.id,
    candidate.phone!,
    `You're all set! 🎉 Your call with Chris is confirmed for ${slot.label} CST. We'll send a reminder before. Looking forward to chatting! — Hunter`,
    candidate,
    posTitle
  );

  // Notify Chris via Telegram
  let summary = '';
  try {
    summary = await generateCandidateSummary(
      candidate.name,
      position?.title ?? 'Unknown',
      candidate.resume_text ?? candidate.raw_email ?? '',
      candidate.fit_score
    );
  } catch {
    summary = '';
  }

  const telegramMsg = `📞 *Interview Scheduled — ${candidate.name}*\nRole: ${position?.title ?? 'Unknown'}\nTime: ${slot.label} CST\nPhone: ${candidate.phone ?? 'N/A'}\nFit Score: ${candidate.fit_score}/100${summary ? `\n\n${summary}` : ''}`;

  await notify(telegramMsg);
}
