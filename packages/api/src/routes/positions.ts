import { Hono } from 'hono';
import { query, queryOne } from '../db/client.js';
import { Position } from '../db/types.js';

const positions = new Hono();

// GET /api/positions
positions.get('/', async (c) => {
  const rows = await query<Position>(
    `SELECT * FROM positions ORDER BY created_at ASC`
  );
  return c.json(rows);
});

// POST /api/positions
positions.post('/', async (c) => {
  const body = await c.req.json<Partial<Position>>();

  if (!body.title || !body.department) {
    return c.json({ error: 'title and department are required' }, 400);
  }

  const rows = await query<Position>(
    `INSERT INTO positions (title, department, description, knockout_questions, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      body.title,
      body.department,
      body.description ?? null,
      JSON.stringify(body.knockout_questions ?? []),
      body.status ?? 'active',
    ]
  );

  return c.json(rows[0], 201);
});

// PATCH /api/positions/:id
positions.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<Position>>();

  const allowed = ['title', 'department', 'description', 'knockout_questions', 'status'];
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      const val = (body as Record<string, unknown>)[key];
      values.push(key === 'knockout_questions' ? JSON.stringify(val) : val);
    }
  }

  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);

  sets.push(`updated_at = now()`);
  values.push(id);

  const rows = await query<Position>(
    `UPDATE positions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );

  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

export default positions;
