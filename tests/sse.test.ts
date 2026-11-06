import { describe, expect, it } from 'bun:test';
import { SSEBroadcaster } from '../src/server/sse';

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
