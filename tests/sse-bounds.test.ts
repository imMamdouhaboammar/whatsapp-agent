import { describe, expect, it } from 'bun:test';
import { SSEBroadcaster, type SSEMessage } from '../src/server/sse';
import { createApiServer } from '../src/server/api';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('WA-019 SSE bounds', () => {
  it('rejects subscribers beyond maxClients and frees capacity on unsubscribe', () => {
    const sse = new SSEBroadcaster({ maxClients: 1 });
    const first = sse.subscribeStream(async () => {});
    expect(first).not.toBeNull();
    const second = sse.subscribeStream(async () => {});
    expect(second).toBeNull();
    first!();
    const third = sse.subscribeStream(async () => {});
    expect(third).not.toBeNull();
  });

  it('disconnects a slow client when its pending queue exceeds the bound', async () => {
    const sse = new SSEBroadcaster({ maxClients: 4, maxQueuedPerClient: 4 });
    const stalled = deferred();
    let disconnectReason: string | null = null;
    sse.subscribeStream(() => stalled.promise, {
      onDisconnect: (reason) => { disconnectReason = reason; }
    });
    for (let i = 0; i < 10; i++) {
      sse.broadcast('new_message', { i });
    }
    expect(disconnectReason as string | null).toBe('overflow');
    expect(sse.clientCount).toBe(0);
  });

  it('keeps fast clients receiving every event in order while a slow client is dropped', async () => {
    const sse = new SSEBroadcaster({ maxClients: 4, maxQueuedPerClient: 4 });
    const stalled = deferred();
    sse.subscribeStream(() => stalled.promise);
    const received: SSEMessage[] = [];
    // A burst within one event-loop turn queues before drains resume; the
    // fast client gets headroom, the slow client is held to the tight bound.
    sse.subscribeStream(async (msg) => { received.push(msg); }, { maxQueueSize: 32 });
    for (let i = 0; i < 10; i++) {
      sse.broadcast('chat_updated', { i });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received.map((m) => (m.data as { i: number }).i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
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
    let disconnectReason: string | null = null;
    sse.subscribeStream(async () => { throw new Error('broken pipe'); }, {
      onDisconnect: (reason) => { disconnectReason = reason; }
    });
    sse.broadcast('new_message', { id: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(disconnectReason as string | null).toBe('write_error');
    expect(sse.clientCount).toBe(0);
  });

  it('returns 503 from /api/events when the broadcaster is at capacity', async () => {
    const sse = new SSEBroadcaster({ maxClients: 1 });
    const app = createApiServer({
      memoryStore: {} as any,
      whatsappClient: {} as any,
      moderatorAgent: {} as any,
      sse,
      sseHeartbeatMs: 25
    });
    const controller = new AbortController();
    const first = await app.request('/api/events', { signal: controller.signal });
    expect(first.status).toBe(200);
    const second = await app.request('/api/events');
    expect(second.status).toBe(503);
    controller.abort();
    await first.body?.cancel().catch(() => {});
  });
});
