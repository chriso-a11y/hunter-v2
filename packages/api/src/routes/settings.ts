import { Hono } from 'hono';
import { query } from '../db/client.js';
import { saveCookies, IndeedCookie } from '../services/indeed.js';

const settings = new Hono();

// GET /api/settings
settings.get('/', async (c) => {
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings ORDER BY key`
  );
  const obj: Record<string, unknown> = {};
  for (const row of rows) {
    obj[row.key] = row.value;
  }
  return c.json(obj);
});

// PATCH /api/settings
settings.patch('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  for (const [key, value] of Object.entries(body)) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }

  return c.json({ ok: true });
});

// POST /api/settings/indeed/refresh-cookies
// Body: { cookies: IndeedCookie[] }
// Updates the indeed-session.json (or the env-var file path) with fresh cookies.
settings.post('/indeed/refresh-cookies', async (c) => {
  const body = await c.req.json<{ cookies?: IndeedCookie[] }>();
  if (!body?.cookies || !Array.isArray(body.cookies)) {
    return c.json({ error: 'Missing or invalid cookies array' }, 400);
  }
  saveCookies(body.cookies);
  return c.json({ ok: true, count: body.cookies.length });
});

export default settings;
