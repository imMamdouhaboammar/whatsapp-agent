import { describe, expect, it } from 'bun:test';
import { createApiServer } from '../../src/server/api';
import { MemoryStore } from '../../src/domain/memory-store';
import { ModeratorAgent } from '../../src/ai/moderator-agent';
import { SSEBroadcaster } from '../../src/server/sse';
import { FableFunnelEngine, FunnelRegistry } from '../../src/funnel';

describe('Funnel Engine REST API Endpoints', () => {
  const setupServer = () => {
    const memory = new MemoryStore({ dataDir: './data/test-funnel-api' });
    const mockGemini: any = { generateContent: async () => ({ text: '{}' }) };
    const agent = new ModeratorAgent(mockGemini, memory);
    const mockClient: any = {
      getState: () => ({ state: 'connected' }),
      disconnect: async () => {},
      start: async () => {}
    };
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

    const mockFetcher = async () => new Response(JSON.stringify({ available: 99 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    const engine = new FableFunnelEngine({ registry, fetcher: mockFetcher as any });

    const app = createApiServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent,
      sse,
      funnelEngine: engine
    });

    return { app, engine, registry };
  };

  it('GET /api/funnel/methods returns list of registered methods', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/funnel/methods');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.methods).toBeDefined();
    expect(json.methods.length).toBeGreaterThan(0);
    expect(json.methods.some((m: any) => m.method === 'STOCK_CHECK')).toBe(true);
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
    const receipt = await res.json();
    expect(receipt.method).toBe('STOCK_CHECK');
    expect(receipt.success).toBe(true);
    expect(receipt.results.length).toBe(1);
    expect(receipt.results[0].data.available).toBe(99);
  });

  it('GET /api/funnel/stats reports circuit breaker health', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/funnel/stats');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.circuitBreakers).toBeDefined();
    expect(json.activeMethodsCount).toBeGreaterThan(0);
  });
});
