import { describe, expect, it } from 'bun:test';
import { createApiServer } from '../src/server/api';
import { MemoryStore } from '../src/domain/memory-store';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { SSEBroadcaster } from '../src/server/sse';

function setupServer() {
  const memory = new MemoryStore({ dataDir: './data/test-sticker-api' });
  const mockClient = new WhatsAppSocketClient();
  mockClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });
  mockClient.disconnect = async () => {};
  mockClient.start = async () => {};
  const mockAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memory);
  const sse = new SSEBroadcaster();

  const app = createApiServer({
    memoryStore: memory,
    whatsappClient: mockClient,
    moderatorAgent: mockAgent,
    sse
  });

  return { app };
}

describe('Sticker Studio API (/api/media/sticker)', () => {

  it('rejects request with missing or empty imageBase64', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/media/sticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(400);
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json === null || !('error' in json) || typeof json.error !== 'string') {
      throw new Error('Expected an error message in the sticker response');
    }
    expect(json.error).toContain('imageBase64 is required');
  });

  it('rejects request exceeding size limit', async () => {
    const { app } = setupServer();
    const res = await app.request('/api/media/sticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: 'a'.repeat(16 * 1024 * 1024) })
    });
    expect(res.status).toBe(413);
  });

  it('converts a valid image to a WebP sticker conforming to 100 KB limit', async () => {
    if (!Bun.which('cwebp')) {
      console.warn('Skipping sticker conversion test: cwebp is not installed on this system');
      return;
    }
    const { app } = setupServer();
    // 1x1 transparent PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await app.request('/api/media/sticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: pngBase64,
        mimeType: 'image/png'
      })
    });

    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    if (typeof json !== 'object' || json === null
      || !('success' in json) || !('mimeType' in json)
      || !('stickerBase64' in json) || typeof json.stickerBase64 !== 'string'
      || !('bytes' in json) || typeof json.bytes !== 'number') {
      throw new Error('Expected a sticker payload with a byte count');
    }
    expect(json.success).toBe(true);
    expect(json.mimeType).toBe('image/webp');
    expect(typeof json.stickerBase64).toBe('string');
    expect(json.bytes).toBeGreaterThan(0);
    expect(json.bytes).toBeLessThanOrEqual(101888);

    const buffer = Buffer.from(json.stickerBase64, 'base64');
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });
});
