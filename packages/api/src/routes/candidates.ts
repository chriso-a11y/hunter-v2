import { Hono } from 'hono';
import { query, queryOne } from '../db/client.js';
import { Candidate, Message } from '../db/types.js';

const candidates = new Hono();

// GET /api/candidates
candidates.get('/', async (c) => {
  const state = c.req.query('state');
  let rows: Candidate[];

  if (state) {
    rows = await query<Candidate>(
      `SELECT c.*, p.title as position_title FROM candidates c
       LEFT JOIN positions p ON c.position_id = p.id
       WHERE c.state = $1 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC`,
      [state]
    );
  } else {
    rows = await query<Candidate>(
      `SELECT c.*, p.title as position_title FROM candidates c
       LEFT JOIN positions p ON c.position_id = p.id
       WHERE c.deleted_at IS NULL
       ORDER BY c.created_at DESC`
    );
  }

  return c.json(rows);
});

// GET /api/candidates/:id
candidates.get('/:id', async (c) => {
  const id = c.req.param('id');

  const candidate = await queryOne<Candidate & { position_title: string }>(
    `SELECT c.*, p.title as position_title FROM candidates c
     LEFT JOIN positions p ON c.position_id = p.id
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id]
  );

  if (!candidate) return c.json({ error: 'Not found' }, 404);

  const messages = await query<Message>(
    `SELECT * FROM messages WHERE candidate_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  return c.json({ ...candidate, messages });
});

// PATCH /api/candidates/:id
candidates.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<Candidate>>();

  const allowed = ['state', 'notes', 'fit_score', 'phone', 'position_id'];
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push((body as Record<string, unknown>)[key]);
    }
  }

  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);

  sets.push(`updated_at = now()`);
  values.push(id);

  const rows = await query<Candidate>(
    `UPDATE candidates SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
    values
  );

  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

// DELETE /api/candidates/:id (soft delete)
candidates.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await query(
    `UPDATE candidates SET deleted_at = now(), updated_at = now() WHERE id = $1`,
    [id]
  );
  return c.json({ ok: true });
});

export default candidates;
