import { MiddlewareHandler } from 'hono';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const password = process.env.AUTH_PASSWORD;

  if (!password) {
    // No password configured — allow all
    return next();
  }

  if (!authHeader) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Support Bearer token or Basic auth
  let provided = '';
  if (authHeader.startsWith('Bearer ')) {
    provided = authHeader.slice(7);
  } else if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    provided = decoded.split(':')[1] ?? '';
  }

  if (provided !== password) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
};
