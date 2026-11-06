import { describe, expect, it } from 'bun:test';
import { SSEBroadcaster } from '../src/server/sse';
import { createApiServer, SSE_KEEP_ALIVE_MS } from '../src/server/api';

describe('receipt event stream', () => {
  it('publishes message status updates to subscribers', () => {
    const stream = new SSEBroadcaster();
    const seen: unknown[] = [];
    const stop = stream.subscribe((event) => seen.push(event));
    stream.broadcast('message_status', {
      chatId: 'contact@s.whatsapp.net', messageId: 'out-1', status: 'read'
    });
    expect(seen).toEqual([{
      event: 'message_status',
      data: { chatId: 'contact@s.whatsapp.net', messageId: 'out-1', status: 'read' }
    }]);
    stop();
    expect(stream.clientCount).toBe(0);
  });
});


describe('dashboard event stream reliability', () => {
  it('sends heartbeats before a 10-second idle timeout and keeps clients subscribed', async () => {
    expect(SSE_KEEP_ALIVE_MS).toBeGreaterThan(0);
    expect(SSE_KEEP_ALIVE_MS).toBeLessThan(10_000);

    const sse = new SSEBroadcaster();
    const app = createApiServer({
      memoryStore: {} as any,
      whatsappClient: {} as any,
      moderatorAgent: {} as any,
      sse,
      sseHeartbeatMs: 25
    });
    const controller = new AbortController();
    const response = await app.request('/api/events', { signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('event: connected');
      const second = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>(resolve => setTimeout(() => resolve({ done: true, value: undefined }), 250))
      ]);
      expect(second.done).toBe(false);
      expect(new TextDecoder().decode(second.value)).toContain('event: ping');
      expect(sse.clientCount).toBe(1);
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
});
