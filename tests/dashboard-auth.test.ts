import { describe, expect, test } from 'bun:test';
import { createApiServer } from '../src/server/api';
import { assertSafeDashboardBind } from '../src/server/dashboard-auth';

const DASHBOARD_TOKEN = 'test-owner-token-with-adequate-entropy-123456';

function appWithDashboardAuth() {
  let disconnects = 0;
  const app = createApiServer({
    dashboardToken: DASHBOARD_TOKEN,
    memoryStore: {
      getPendingDrafts: () => [],
      listChats: () => [{ id: 'private-customer', name: 'Private customer' }]
    } as any,
    whatsappClient: {
      getState: () => ({ state: 'disconnected' }),
      disconnect: async () => { disconnects++; }
    } as any,
    moderatorAgent: {} as any,
    sse: { broadcast: () => {} } as any
  });
  return { app, getDisconnects: () => disconnects };
}

describe('Self-hosted dashboard access', () => {
  test('blocks chat data, commands and event streaming without owner authentication', async () => {
    const { app, getDisconnects } = appWithDashboardAuth();
    expect((await app.request('/api/chats')).status).toBe(401);
    expect((await app.request('/api/events')).status).toBe(401);
    expect((await app.request('/api/disconnect', { method: 'POST' })).status).toBe(401);
    expect(getDisconnects()).toBe(0);
    const status = await app.request('/api/auth/status');
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ required: true, authenticated: false });
  });

  test('owner login sets a private same-site cookie, supports requests, and logout invalidates it', async () => {
    const { app } = appWithDashboardAuth();
    const invalid = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'incorrect-token' })
    });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('set-cookie')).toBeNull();

    const login = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: DASHBOARD_TOKEN })
    });
    expect(login.status).toBe(200);
    const cookieHeader = login.headers.get('set-cookie') ?? '';
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('Path=/api');
    expect(cookieHeader).not.toContain(DASHBOARD_TOKEN);

    const cookie = cookieHeader.split(';')[0];
    expect((await app.request('/api/chats', { headers: { cookie } })).status).toBe(200);
    expect((await (await app.request('/api/auth/status', { headers: { cookie } })).json() as any).authenticated).toBe(true);
    const logout = await app.request('/api/auth/session', { method: 'DELETE', headers: { cookie } });
    expect(logout.status).toBe(200);
    expect((await app.request('/api/chats', { headers: { cookie } })).status).toBe(401);
  });

  test('CLI service access uses an authenticated header and never needs browser cookies', async () => {
    const { app } = appWithDashboardAuth();
    expect((await app.request('/api/chats', {
      headers: { authorization: 'Bearer ' + DASHBOARD_TOKEN }
    })).status).toBe(200);
    expect((await app.request('/api/chats', {
      headers: { authorization: 'Bearer not-the-owner-token' }
    })).status).toBe(401);
  });

  test('loopback stays usable without a dashboard token, exposed listeners require one', () => {
    expect(() => assertSafeDashboardBind('127.0.0.1', '')).not.toThrow();
    expect(() => assertSafeDashboardBind('localhost', '')).not.toThrow();
    expect(() => assertSafeDashboardBind('::1', '')).not.toThrow();
    expect(() => assertSafeDashboardBind('0.0.0.0', '')).toThrow(/AGENT_DASHBOARD_TOKEN/);
    expect(() => assertSafeDashboardBind('192.168.1.5', '')).toThrow(/AGENT_DASHBOARD_TOKEN/);
    expect(() => assertSafeDashboardBind('0.0.0.0', DASHBOARD_TOKEN)).not.toThrow();
  });
});
