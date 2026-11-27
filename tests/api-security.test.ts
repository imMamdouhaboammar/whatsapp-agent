import assert from 'node:assert/strict';
import { afterEach, expect, test } from 'bun:test';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

const stores: MemoryStore[] = [];

function createTestDeps(options: { onDisconnect?: () => void } = {}) {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  stores.push(memoryStore);
  const whatsappClient = new WhatsAppSocketClient();
  if (options.onDisconnect) {
    const onDisconnect = options.onDisconnect;
    whatsappClient.disconnect = async () => {
      onDisconnect();
    };
  }
  const moderatorAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memoryStore);
  const sse = new SSEBroadcaster();
  return { memoryStore, whatsappClient, moderatorAgent, sse };
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

test('S02 browser cross-origin mutation from untrusted origin is rejected before any socket operation', async () => {
  let disconnects = 0;
  const app = createApiServer(createTestDeps({ onDisconnect: () => { disconnects++; } }));
  const evil = await app.request('/api/disconnect', { method: 'POST', headers: { origin: 'https://malicious.example' } });
  expect(evil.status).toBe(403);
  expect(disconnects).toBe(0);
  const safe = await app.request('/api/disconnect', { method: 'POST', headers: { origin: 'http://localhost:5173' } });
  expect(safe.status).toBe(200);
  expect(disconnects).toBe(1);
});

test('S02 dashboard mutations accept their actual same-origin host and port', async () => {
  let disconnects = 0;
  const app = createApiServer(createTestDeps({ onDisconnect: () => { disconnects++; } }));
  const sameOrigin = await app.request('http://127.0.0.1:4305/api/disconnect', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:4305' }
  });
  expect(sameOrigin.status).toBe(200);
  expect(disconnects).toBe(1);
  const foreignOrigin = await app.request('http://127.0.0.1:4305/api/disconnect', {
    method: 'POST',
    headers: { origin: 'https://unknown.example' }
  });
  expect(foreignOrigin.status).toBe(403);
  expect(disconnects).toBe(1);
});

test('GET /api/funnel/methods does not leak target credentials', async () => {
  const { FableFunnelEngine } = await import('../src/funnel/engine');
  const { FunnelRegistry } = await import('../src/funnel/registry');
  const registry = new FunnelRegistry();
  registry.registerMethod({
    method: 'm',
    description: 'test',
    mode: 'FIRST_SUCCESS',
    timeoutMs: 5000,
    targets: [{ id: 't', name: 't', url: 'https://x.example', authHeader: 'Bearer SECRET-TOKEN', headers: { 'x-key': 'SECRET-HDR' }, enabled: true }]
  });
  const app = createApiServer({
    ...createTestDeps(),
    funnelEngine: new FableFunnelEngine({ registry }),
    dashboardToken: 'owner-token-owner-token-1234'
  });
  const res = await app.request('/api/funnel/methods');
  const text = await res.text();
  expect(res.status).toBe(200);
  expect(text).not.toContain('SECRET-TOKEN');
  expect(text).not.toContain('SECRET-HDR');
  expect(JSON.parse(text).methods[0].targets[0].hasAuthHeader).toBe(true);
});

test('GET /api/funnel/methods tolerates a method registered without targets', async () => {
  const { FableFunnelEngine } = await import('../src/funnel/engine');
  const { FunnelRegistry } = await import('../src/funnel/registry');
  const registry = new FunnelRegistry();
  registry.registerMethod({
    method: 'bare',
    description: '',
    mode: 'FIRST_SUCCESS',
    timeoutMs: 1000,
    targets: []
  });
  const bareMethod = registry.getMethod('bare');
  assert(bareMethod);
  assert(Reflect.deleteProperty(bareMethod, 'targets'));
  const app = createApiServer({
    ...createTestDeps(),
    funnelEngine: new FableFunnelEngine({ registry })
  });
  const res = await app.request('/api/funnel/methods');
  expect(res.status).toBe(200);
  expect(JSON.parse(await res.text()).methods[0].targets).toEqual([]);
});

test('fold listing rejects unsupported tier values instead of querying an invalid tier', async () => {
  const app = createApiServer(createTestDeps());
  for (const tier of ['0', '4', 'NaN', '1.5']) {
    expect((await app.request('/api/chats/contact/folds?tier=' + tier)).status).toBe(400);
  }
  expect((await app.request('/api/chats/contact/folds?tier=1')).status).toBe(200);
});

test('conversation style rejects unsupported values without mutating saved preference', async () => {
  const deps = createTestDeps();
  const app = createApiServer(deps);
  const request = (style: unknown) => app.request('/api/chats/contact/style', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ style })
  });
  expect((await request('playful')).status).toBe(200);
  for (const style of ['unsupported', 123, { value: 'casual' }]) {
    expect((await request(style)).status).toBe(400);
    expect(deps.memoryStore.getChatStyle('contact')).toBe('playful');
  }
});

test('persona update validates the whole request before applying any configuration', async () => {
  const deps = createTestDeps();
  const app = createApiServer(deps);
  const before = deps.moderatorAgent.getPersona();
  const res = await app.request('/api/persona', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({persona:{name:'Changed',minConfidence:2},policy:{minConfidence:0.5}})});
  expect(res.status).toBe(400);
  expect(deps.moderatorAgent.getPersona()).toEqual(before);
});

test('persona settings survive recreation of the moderator', async () => {
  const deps = createTestDeps();
  const app = createApiServer(deps);
  const res = await app.request('/api/persona',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({persona:{name:'Support assistant',language:'en',minConfidence:0.95,rules:['Confirm stock before promising']}})});
  expect(res.status).toBe(200);
  const recreated = new ModeratorAgent(new GeminiClient({apiKey:'test-key'}),deps.memoryStore);
  expect(recreated.getPersona()).toMatchObject({name:'Support assistant',language:'en',minConfidence:0.95,rules:['Confirm stock before promising']});
});
