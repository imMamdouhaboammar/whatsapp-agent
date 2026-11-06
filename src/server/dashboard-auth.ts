import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const SESSION_COOKIE = 'wa_owner_session';
const SESSION_SECONDS = 12 * 60 * 60;

function matchesToken(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(provided), hash(expected));
}

function isLoopback(host: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
}

export function assertSafeDashboardBind(host: string, ownerToken: string): void {
  if (!isLoopback(host) && ownerToken.length < 24) {
    throw new Error('AGENT_DASHBOARD_TOKEN of at least 24 characters is required for a non-loopback HOST');
  }
}

export function registerDashboardAuth(app: Hono, token: string): void {
  const sessions = new Map<string, number>();

  function sessionAuthenticated(cookie: string | undefined): boolean {
    if (!cookie) return false;
    const expiry = sessions.get(cookie);
    if (!expiry) return false;
    if (expiry <= Date.now()) {
      sessions.delete(cookie);
      return false;
    }
    return true;
  }

  function authenticated(headers: { authorization?: string; cookie?: string }): boolean {
    const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? '');
    return (bearer !== null && matchesToken(bearer[1], token)) ||
      sessionAuthenticated(headers.cookie);
  }

  app.get('/api/auth/status', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      required: Boolean(token),
      authenticated: !token || authenticated({
        authorization: c.req.header('authorization'),
        cookie: getCookie(c, SESSION_COOKIE)
      })
    });
  });

  app.post('/api/auth/session', async (c) => {
    if (!token) return c.json({ authenticated: true });
    const payload = await c.req.json().catch(() => null);
    if (!payload || typeof payload.token !== 'string' || payload.token.length > 512 ||
        !matchesToken(payload.token, token)) {
      return c.json({ error: 'Invalid owner access token' }, 401);
    }

    for (const [id, expires] of sessions) {
      if (expires <= Date.now()) sessions.delete(id);
    }
    if (sessions.size >= 64) sessions.delete(sessions.keys().next().value!);

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, Date.now() + SESSION_SECONDS * 1000);
    const hostname = new URL(c.req.url).hostname;
    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: !isLoopback(hostname),
      path: '/api',
      maxAge: SESSION_SECONDS
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ authenticated: true });
  });

  app.delete('/api/auth/session', (c) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) sessions.delete(cookie);
    deleteCookie(c, SESSION_COOKIE, { path: '/api' });
    c.header('Cache-Control', 'no-store');
    return c.json({ authenticated: false });
  });

  app.use('/api/*', async (c, next) => {
    if (!token) return next();
    if (!authenticated({
      authorization: c.req.header('authorization'),
      cookie: getCookie(c, SESSION_COOKIE)
    })) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'Owner authentication required' }, 401);
    }
    return next();
  });
}
