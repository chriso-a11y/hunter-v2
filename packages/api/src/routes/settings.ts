import { Hono } from 'hono';
import { query } from '../db/client.js';

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

export default settings;
