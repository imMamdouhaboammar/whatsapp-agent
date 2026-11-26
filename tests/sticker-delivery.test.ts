import { expect, test } from 'bun:test';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { SSEBroadcaster } from '../src/server/sse';
import { createApiServer } from '../src/server/api';

// Actual tiny RIFF/WebP fixture, never sent to a live WhatsApp account.
const webp = 'UklGRlgAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAf1ZQOCAwAAAAEAIAnQEqAQABAAIANCWgAnS6AfgB+AADyAD+5mnf+1oDg1X+Z//774UR26/zFAAA';
const chatId = '201111111111@s.whatsapp.net';

test('sticker API persists one intent and sends binary WebP, not a placeholder text', async () => {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  const client = new WhatsAppSocketClient();
  const sent: Uint8Array[] = [];
  client.sendSticker = async (_chatId, bytes) => { sent.push(bytes); return { messageId: 'sticker-native' }; };
  client.sendMessage = async () => { throw new Error('Text must not be sent for a sticker'); };
  const app = createApiServer({ memoryStore: memory, whatsappClient: client, moderatorAgent: new ModeratorAgent(new GeminiClient({ apiKey: ['test', 'key'].join('-') }), memory), sse: new SSEBroadcaster() });
  const request = (stickerBase64: string, clientMutationId = 'sticker-1') => app.request('/api/chats/' + encodeURIComponent(chatId) + '/stickers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stickerBase64, clientMutationId })
  });
  try {
    const bad = await request('not-a-webp');
    expect(bad.status).toBe(400);
    expect(sent).toHaveLength(0);
    const first = await request(webp);
    const repeated = await request(webp);
    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(Buffer.from(sent[0] ?? []).toString('base64')).toBe(webp);
    const intent = memory.getSendLedger().getBySource({ sourceKind: 'ui', sourceId: 'sticker-1', sourceRevision: 1, actionKind: 'sticker' });
    expect(intent?.state).toBe('accepted');
    expect(memory.getMessages(chatId, 10)[0]?.text).toBe('[Sticker]');
  } finally { memory.close(); }
});
