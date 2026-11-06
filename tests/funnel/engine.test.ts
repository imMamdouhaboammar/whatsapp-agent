import { describe, expect, it } from 'bun:test';
import { FableFunnelEngine } from '../../src/funnel/engine';
import { FunnelRegistry } from '../../src/funnel/registry';
import type { FunnelMethodConfig } from '../../src/funnel/types';

describe('FableFunnelEngine (Scatter-Gather & Hedged Race)', () => {
  it('executes ALL_SETTLED scatter-gather across multiple targets in parallel', async () => {
    const registry = new FunnelRegistry();
    const config: FunnelMethodConfig = {
      method: 'MULTI_WH_CHECK',
      description: 'Check stock in 3 warehouses',
      mode: 'ALL_SETTLED',
      timeoutMs: 1000,
      targets: [
        { id: 'wh-1', name: 'Warehouse 1', url: 'http://wh1.internal/stock', enabled: true },
        { id: 'wh-2', name: 'Warehouse 2', url: 'http://wh2.internal/stock', enabled: true },
        { id: 'wh-3', name: 'Warehouse 3', url: 'http://wh3.internal/stock', enabled: true }
      ]
    };
    registry.registerMethod(config);

    // Mock fetcher returning responses
    const mockFetcher = async (url: string) => {
      if (url.includes('wh1')) {
        return new Response(JSON.stringify({ stock: 15 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('wh2')) {
        return new Response(JSON.stringify({ stock: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    };

    const engine = new FableFunnelEngine({ registry, fetcher: mockFetcher as any });

    const receipt = await engine.dispatch({
      method: 'MULTI_WH_CHECK',
      payload: { sku: 'SKU-42' }
    });

    expect(receipt.method).toBe('MULTI_WH_CHECK');
    expect(receipt.mode).toBe('ALL_SETTLED');
    expect(receipt.results.length).toBe(3);
    expect(receipt.successfulCount).toBe(2);
    expect(receipt.failedCount).toBe(1);
    expect(receipt.success).toBe(true);

    const r1 = receipt.results.find((r) => r.targetId === 'wh-1');
    expect(r1?.statusCode).toBe(200);
    expect((r1?.data as any)?.stock).toBe(15);
  });

  it('executes FIRST_SUCCESS hedged race and aborts slower targets', async () => {
    const registry = new FunnelRegistry();
    const config: FunnelMethodConfig = {
      method: 'LLM_HEDGED_PROMPT',
      description: 'Race Gemini primary vs backup',
      mode: 'FIRST_SUCCESS',
      timeoutMs: 2000,
      targets: [
        { id: 'model-slow', name: 'Slow LLM', url: 'http://slow.internal/v1', enabled: true },
        { id: 'model-fast', name: 'Fast LLM', url: 'http://fast.internal/v1', enabled: true }
      ]
    };
    registry.registerMethod(config);

    const mockFetcher = async (url: string, init?: RequestInit) => {
      if (url.includes('slow')) {
        // Simulates 150ms delay
        await new Promise((r) => setTimeout(r, 150));
        if (init?.signal?.aborted) throw new Error('Aborted');
        return new Response(JSON.stringify({ text: 'slow response' }), { status: 200 });
      }
      // Fast finishes in 10ms
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ text: 'fast winner' }), { status: 200 });
    };

    const engine = new FableFunnelEngine({ registry, fetcher: mockFetcher as any });

    const receipt = await engine.dispatch({
      method: 'LLM_HEDGED_PROMPT',
      payload: { prompt: 'Translate this' }
    });

    expect(receipt.success).toBe(true);
    expect(receipt.winningTargetId).toBe('model-fast');
    expect((receipt.results.find((r) => r.targetId === 'model-fast')?.data as any)?.text).toBe('fast winner');
  });

  it('trips circuit breaker and fast-fails target after repeated errors', async () => {
    const registry = new FunnelRegistry();
    registry.registerMethod({
      method: 'UNSTABLE_API',
      description: 'Api that fails repeatedly',
      mode: 'ALL_SETTLED',
      timeoutMs: 500,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 5000,
      targets: [
        { id: 'unstable-1', name: 'Broken Target', url: 'http://broken.internal', enabled: true }
      ]
    });

    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      throw new Error('Connection refused');
    };

    const engine = new FableFunnelEngine({ registry, fetcher: mockFetcher as any });

    // Call 1 -> Fail
    await engine.dispatch({ method: 'UNSTABLE_API' });
    // Call 2 -> Fail -> Trips breaker
    await engine.dispatch({ method: 'UNSTABLE_API' });

    expect(callCount).toBe(2);

    // Call 3 -> Should fast-fail via Circuit Breaker without calling fetcher!
    const receipt3 = await engine.dispatch({ method: 'UNSTABLE_API' });
    expect(receipt3.results[0].statusCode).toBe(503);
    expect(receipt3.results[0].error).toContain('Circuit breaker OPEN');
    expect(callCount).toBe(2); // Verify fetcher was NOT called again
  });

  it('enforces QUORUM execution mode', async () => {
    const registry = new FunnelRegistry();
    registry.registerMethod({
      method: 'CONSENSUS_VOTE',
      description: 'Requires 2 of 3 votes',
      mode: 'QUORUM',
      quorumCount: 2,
      timeoutMs: 500,
      targets: [
        { id: 'node-1', name: 'Node 1', url: 'http://node1.internal', enabled: true },
        { id: 'node-2', name: 'Node 2', url: 'http://node2.internal', enabled: true },
        { id: 'node-3', name: 'Node 3', url: 'http://node3.internal', enabled: true }
      ]
    });

    // 1 succeeds, 2 fail -> Quorum of 2 NOT met
    const mockFetcher = async (url: string) => {
      if (url.includes('node1')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('Error', { status: 500 });
    };

    const engine = new FableFunnelEngine({ registry, fetcher: mockFetcher as any });

    const receipt = await engine.dispatch({ method: 'CONSENSUS_VOTE' });
    expect(receipt.successfulCount).toBe(1);
    expect(receipt.failedCount).toBe(2);
    expect(receipt.success).toBe(false); // Quorum failed
  });
});
