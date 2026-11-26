import { rejects } from 'node:assert/strict';
import { describe, expect, it } from 'bun:test';
import { createApiServer } from '../../src/server/api';
import { MemoryStore } from '../../src/domain/memory-store';
import { ModeratorAgent } from '../../src/ai/moderator-agent';
import { GeminiClient } from '../../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../../src/transport/whatsapp-socket';
import { SSEBroadcaster } from '../../src/server/sse';
import { FableFunnelEngine, FunnelRegistry } from '../../src/funnel';

const mockFetcher: typeof fetch = async () => new Response(JSON.stringify({ available: 99 }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
});

function setupServer() {
  const memory = new MemoryStore({ dataDir: './data/test-funnel-api' });
  const mockGemini = new GeminiClient({ apiKey: 'test-key' });
  mockGemini.generateContent = async () => ({ text: '{}' });
  const agent = new ModeratorAgent(mockGemini, memory);
  const mockClient = new WhatsAppSocketClient();
  mockClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });
  mockClient.disconnect = async () => {};
  mockClient.start = async () => {};
  const sse = new SSEBroadcaster();
  const registry = new FunnelRegistry({ apiKeys: ['test-api-key'] });

  registry.registerMethod({
    method: 'STOCK_CHECK',
    description: 'Check stock in internal WH',
    mode: 'ALL_SETTLED',
    timeoutMs: 1000,
    targets: [
      { id: 'wh-main', name: 'Main WH', url: 'http://127.0.0.1:3000/api/mock/stock', enabled: true }
    ]
  });

  const engine = new FableFunnelEngine({ registry, fetcher: mockFetcher });

  const app = createApiServer({
    memoryStore: memory,
    whatsappClient: mockClient,
    moderatorAgent: agent,
    sse,
    funnelEngine: engine
  });

  return { app, engine, registry };
}

async function readMethods(response: Response) {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('methods' in body) || !Array.isArray(body.methods)) {
    throw new TypeError('Expected an array of funnel methods');
  }
  const methods: unknown[] = body.methods;
  if (!methods.every((entry) =>
    typeof entry === 'object' && entry !== null && 'method' in entry && typeof entry.method === 'string'
  )) {
    throw new TypeError('Expected a string method name in every funnel method');
  }
  return { methods };
}

describe('Funnel Engine REST API Endpoints', () => {
  it('rejects malformed method lists at the response boundary', async () => {
    for (const payload of [{ methods: 'STOCK_CHECK' }, { methods: [{ method: 42 }] }]) {
      await rejects(readMethods(Response.json(payload)), TypeError);
    }
  });

  it('GET /api/funnel/methods returns list of registered methods', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/funnel/methods');
    expect(res.status).toBe(200);
    const json = await readMethods(res);
    expect(json.methods).toBeDefined();
    expect(json.methods.length).toBeGreaterThan(0);
    expect(json.methods).toContainEqual(expect.objectContaining({ method: 'STOCK_CHECK' }));
  });

  it('POST /api/funnel/dispatch rejects unauthorized caller', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/funnel/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'STOCK_CHECK' })
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/funnel/dispatch executes scatter-gather with valid API key', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/funnel/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-api-key'
      },
      body: JSON.stringify({
        method: 'STOCK_CHECK',
        payload: { sku: 'ITEM-1' }
      })
    });

    expect(res.status).toBe(200);
    const receipt: unknown = await res.json();
    expect(receipt).toEqual(expect.objectContaining({
      method: 'STOCK_CHECK',
      success: true,
      results: [expect.objectContaining({ data: expect.objectContaining({ available: 99 }) })]
    }));
  });

  it('GET /api/funnel/stats reports circuit breaker health', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/funnel/stats');
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json === null ||
        !('circuitBreakers' in json) || !('activeMethodsCount' in json) ||
        typeof json.activeMethodsCount !== 'number') {
      throw new TypeError('Expected circuit breaker stats and an active method count');
    }
    expect(json.circuitBreakers).toBeDefined();
    expect(json.activeMethodsCount).toBeGreaterThan(0);
  });
});
