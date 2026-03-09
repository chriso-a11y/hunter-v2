import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth.js';
import webhooks from './routes/webhooks.js';
import candidatesRouter from './routes/candidates.js';
import positionsRouter from './routes/positions.js';
import settingsRouter from './routes/settings.js';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: ['http://localhost:5173', process.env.WEB_URL ?? '*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Health check (no auth)
app.get('/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

// Webhooks (no auth — validated by Twilio signature / Gmail pub/sub)
app.route('/api/webhook', webhooks);

// Protected API routes
app.use('/api/*', authMiddleware);
app.route('/api/candidates', candidatesRouter);
app.route('/api/positions', positionsRouter);
app.route('/api/settings', settingsRouter);

// 404 fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🎯 Hunter v2 API running on http://localhost:${info.port}`);
});

export default app;
