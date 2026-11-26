import { describe, expect, it } from 'bun:test';
import { SSEBroadcaster, type SSEMessage } from '../src/server/sse';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { createApiServer } from '../src/server/api';

describe('WA-019 SSE bounds', () => {
  it('rejects subscribers beyond maxClients and frees capacity on unsubscribe', () => {
    const sse = new SSEBroadcaster({ maxClients: 1 });
    const first = sse.subscribeStream(async () => {});
    expect(first).not.toBeNull();
    const second = sse.subscribeStream(async () => {});
    expect(second).toBeNull();
    if (!first) throw new Error('Expected unsubscribe function');
    first();
    const third = sse.subscribeStream(async () => {});
    expect(third).not.toBeNull();
  });

  it('disconnects a slow client when its pending queue exceeds the bound', async () => {
    const sse = new SSEBroadcaster({ maxClients: 4, maxQueuedPerClient: 4 });
    const stalled = Promise.withResolvers<void>();
    const disconnectReasons: string[] = [];
    sse.subscribeStream(() => stalled.promise, {
      onDisconnect: (reason) => { disconnectReasons.push(reason); }
    });
    for (let i = 0; i < 10; i++) {
      sse.broadcast('new_message', { i });
    }
    expect(disconnectReasons).toEqual(['overflow']);
    expect(sse.clientCount).toBe(0);
  });

  it('keeps fast clients receiving every event in order while a slow client is dropped', async () => {
    const sse = new SSEBroadcaster({ maxClients: 4, maxQueuedPerClient: 4 });
    const stalled = Promise.withResolvers<void>();
    sse.subscribeStream(() => stalled.promise);
    const received: SSEMessage[] = [];
    // A burst within one event-loop turn queues before drains resume; the
    // fast client gets headroom, the slow client is held to the tight bound.
    sse.subscribeStream(async (msg) => { received.push(msg); }, { maxQueueSize: 32 });
    for (let i = 0; i < 10; i++) {
      sse.broadcast('chat_updated', { i });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received.map((m) => {
      const { data } = m;
      if (typeof data !== 'object' || data === null || !('i' in data) || typeof data.i !== 'number') {
        throw new Error('Expected a numeric event index');
      }
      return data.i;
    })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sse.clientCount).toBe(1);
  });

  it('close() deterministically disconnects every stream subscriber', async () => {
    const sse = new SSEBroadcaster({ maxClients: 4 });
    const reasons: string[] = [];
    sse.subscribeStream(async () => {}, { onDisconnect: (reason) => { reasons.push(reason); } });
    sse.subscribeStream(async () => {}, { onDisconnect: (reason) => { reasons.push(reason); } });
    expect(sse.clientCount).toBe(2);
    sse.close();
    expect(reasons).toEqual(['closed', 'closed']);
    expect(sse.clientCount).toBe(0);
  });

  it('drops a stream subscriber whose writes fail', async () => {
    const sse = new SSEBroadcaster({ maxClients: 4 });
    const disconnectReasons: string[] = [];
    sse.subscribeStream(async () => { throw new Error('broken pipe'); }, {
      onDisconnect: (reason) => { disconnectReasons.push(reason); }
    });
    sse.broadcast('new_message', { id: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(disconnectReasons).toEqual(['write_error']);
    expect(sse.clientCount).toBe(0);
  });

  it('returns 503 from /api/events when the broadcaster is at capacity', async () => {
    const sse = new SSEBroadcaster({ maxClients: 1 });
    const memoryStore = new MemoryStore({ dataDir: ':memory:' });
    const gemini = new GeminiClient({ apiKey: 'test-key' });
    gemini.generateContent = async () => { throw new Error('Unexpected Gemini call'); };
    const app = createApiServer({
      memoryStore,
      moderatorAgent: new ModeratorAgent(gemini, memoryStore),
      sse,
      sseHeartbeatMs: 25
    });
    const controller = new AbortController();
    const first = await app.request('/api/events', { signal: controller.signal });
    try {
      expect(first.status).toBe(200);
      const second = await app.request('/api/events');
      expect(second.status).toBe(503);
    } finally {
      controller.abort();
      memoryStore.close();
      await first.body?.cancel();
    }
  });
});
