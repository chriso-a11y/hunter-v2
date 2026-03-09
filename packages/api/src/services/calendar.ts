import { google } from 'googleapis';
import { CalendarSlot } from '../db/types.js';

function getCalendarClient() {
  // Support both service account (JSON) and OAuth
  const serviceAccountJson = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT;
  if (serviceAccountJson && serviceAccountJson !== '{}') {
    const sa = JSON.parse(serviceAccountJson) as Record<string, string>;
    const auth = new google.auth.GoogleAuth({
      credentials: sa,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    return google.calendar({ version: 'v3', auth });
  }

  // Fall back to OAuth (same credentials as Gmail)
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
const CST_OFFSET = -6 * 60; // UTC-6 (CST) — adjust for CDT as needed

function toCST(date: Date): Date {
  const offset = CST_OFFSET * 60 * 1000;
  return new Date(date.getTime() + offset);
}

function formatSlotLabel(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Convert UTC to CST for display
  const cst = new Date(date.getTime() + CST_OFFSET * 60 * 1000);
  const hours = cst.getUTCHours();
  const minutes = cst.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  const displayMinutes = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`;

  return `${days[cst.getUTCDay()]} ${months[cst.getUTCMonth()]} ${cst.getUTCDate()} at ${displayHour}${displayMinutes} ${ampm}`;
}

export async function getAvailableSlots(daysAhead = 5, count = 3): Promise<CalendarSlot[]> {
  const calendar = getCalendarClient();

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  // Get busy times
  const freeBusyRes = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busyTimes = freeBusyRes.data.calendars?.[CALENDAR_ID]?.busy ?? [];

  // Also get events to count per day
  const eventsRes = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = eventsRes.data.items ?? [];

  // Count events per day
  const eventsByDay: Record<string, number> = {};
  for (const event of events) {
    const start = event.start?.dateTime ?? event.start?.date;
    if (start) {
      const day = start.substring(0, 10);
      eventsByDay[day] = (eventsByDay[day] ?? 0) + 1;
    }
  }

  const slots: CalendarSlot[] = [];

  // Iterate through candidate slots: Mon-Fri, 9am-4pm CST, hourly
  const cursor = new Date(now);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1); // start from next hour

  while (slots.length < count && cursor < new Date(timeMax)) {
    const cst = new Date(cursor.getTime() + CST_OFFSET * 60 * 1000);
    const dayOfWeek = cst.getUTCDay(); // 0=Sun, 6=Sat
    const hour = cst.getUTCHours();
    const dateKey = cst.toISOString().substring(0, 10);

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }

    // Business hours: 9am-4pm CST (so slots start by 4pm)
    if (hour < 9 || hour >= 16) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }

    // Skip if day has 3+ existing events
    if ((eventsByDay[dateKey] ?? 0) >= 3) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }

    // Check not busy
    const slotEnd = new Date(cursor.getTime() + 60 * 60 * 1000);
    const isBusy = busyTimes.some((busy) => {
      const busyStart = new Date(busy.start ?? 0);
      const busyEnd = new Date(busy.end ?? 0);
      return cursor < busyEnd && slotEnd > busyStart;
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
      description: `Candidate interview scheduled via Hunter recruiting system.`,
      start: { dateTime: slot.start.toISOString() },
      end: { dateTime: slot.end.toISOString() },
      attendees: [{ email: candidateEmail }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'email', minutes: 1440 }, // 1 day before
        ],
      },
    },
  });

  return event.data.id ?? '';
}
