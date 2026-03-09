import { google } from 'googleapis';
import { CalendarSlot } from '../db/types.js';

/**
 * Calendar auth uses the same OAuth2 credentials as Gmail.
 * No service account needed — just CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN.
 */
function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? 'primary';

// CST = UTC-6, CDT = UTC-5. Using -6 conservatively; adjust to -5 in summer.
const CST_OFFSET_MINUTES = -6 * 60;

/** Convert UTC Date → wall-clock CST Date (for display/logic) */
function toCST(utc: Date): Date {
  return new Date(utc.getTime() + CST_OFFSET_MINUTES * 60 * 1000);
}

function formatSlotLabel(utcDate: Date): string {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const cst = toCST(utcDate);
  const hours = cst.getUTCHours();
  const minutes = cst.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const minStr = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`;

  return `${DAYS[cst.getUTCDay()]} ${MONTHS[cst.getUTCMonth()]} ${cst.getUTCDate()} at ${h12}${minStr} ${ampm}`;
}

export async function getAvailableSlots(daysAhead = 5, count = 3): Promise<CalendarSlot[]> {
  const calendar = getCalendarClient();

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  // Fetch busy windows and existing events in parallel
  const [freeBusyRes, eventsRes] = await Promise.all([
    calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: CALENDAR_ID }],
      },
    }),
    calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    }),
  ]);

  const busyTimes = freeBusyRes.data.calendars?.[CALENDAR_ID]?.busy ?? [];

  // Count existing events per calendar date (CST)
  const eventsByDay: Record<string, number> = {};
  for (const event of eventsRes.data.items ?? []) {
    const start = event.start?.dateTime ?? event.start?.date;
    if (start) {
      // Convert event start to CST date key
      const cstDate = toCST(new Date(start));
      const dateKey = `${cstDate.getUTCFullYear()}-${cstDate.getUTCMonth()}-${cstDate.getUTCDate()}`;
      eventsByDay[dateKey] = (eventsByDay[dateKey] ?? 0) + 1;
    }
  }

  const slots: CalendarSlot[] = [];

  // Walk forward hour by hour until we have enough slots
  const cursor = new Date(now);
  cursor.setMinutes(0, 0, 0);
  cursor.setTime(cursor.getTime() + 60 * 60 * 1000); // start next full hour

  const maxMs = new Date(timeMax).getTime();

  while (slots.length < count && cursor.getTime() < maxMs) {
    const cst = toCST(cursor);
    const dow = cst.getUTCDay(); // 0=Sun, 6=Sat
    const hour = cst.getUTCHours();
    const dateKey = `${cst.getUTCFullYear()}-${cst.getUTCMonth()}-${cst.getUTCDate()}`;

    // Skip weekends
    if (dow === 0 || dow === 6) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }

    // Business hours: 9 AM–4 PM CST (last slot starts at 4 PM = ends 5 PM)
    if (hour < 9 || hour >= 16) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }

    // Skip days with 3+ existing events
    if ((eventsByDay[dateKey] ?? 0) >= 3) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }

    // Check against busy windows
    const slotEnd = new Date(cursor.getTime() + 60 * 60 * 1000);
    const isBusy = busyTimes.some((b) => {
      const bs = new Date(b.start ?? 0).getTime();
      const be = new Date(b.end ?? 0).getTime();
      return cursor.getTime() < be && slotEnd.getTime() > bs;
    });

    if (!isBusy) {
      slots.push({
        start: new Date(cursor),
        end: slotEnd,
        label: formatSlotLabel(cursor),
      });
    }

    cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
  }

  return slots;
}

export async function bookSlot(
  slot: CalendarSlot,
  candidateName: string,
  candidateEmail: string
): Promise<string> {
  const calendar = getCalendarClient();

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: `Interview: ${candidateName}`,
      description: 'Candidate interview scheduled via Hunter recruiting system.',
      start: { dateTime: slot.start.toISOString(), timeZone: 'America/Chicago' },
      end: { dateTime: slot.end.toISOString(), timeZone: 'America/Chicago' },
      attendees: [{ email: candidateEmail }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'email', minutes: 1440 },
        ],
      },
    },
  });

  return event.data.id ?? '';
}
