import assert from 'node:assert/strict';
import { expect, test } from 'bun:test';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { api } from '../ui/src/api/client';
import { responseContracts } from '../ui/src/api/response-contracts';

test('UI response contracts accept real local API responses in both transport modes', async () => {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  const moderatorAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'local-test' }), memoryStore);
  const deps = { memoryStore, moderatorAgent, sse: new SSEBroadcaster() };
  try {
    for (const whatsappClient of [undefined, new WhatsAppSocketClient()]) {
      const app = createApiServer({ ...deps, whatsappClient });
      const cases = [
        ['/api/status', responseContracts.systemStatus],
        ['/api/workspace/stats', responseContracts.workspaceStats],
        ['/api/persona', responseContracts.persona],
        ['/api/chats', responseContracts.chats],
        ['/api/chats/local-contact/messages', responseContracts.chatMessages],
        ['/api/funnel/methods', responseContracts.funnelMethods],
        ['/api/funnel/stats', responseContracts.funnelStats],
      ] as const;
      for (const [path, accepts] of cases) {
        const response = await app.request(path);
        expect(response.status).toBe(200);
        const payload: unknown = await response.json();
        assert.ok(accepts(payload), 'UI rejected the real response for ' + path);
      }
    }
  } finally {
    memoryStore.close();
  }
});

test('malformed HTTP success and error payloads are rejected safely', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = Object.assign(async () => Response.json({ state: 'connected', pendingDraftsCount: 'broken', updatedAt: 1 }), original);
    await assert.rejects(api.getStatus(), /invalid response body/);
    globalThis.fetch = Object.assign(async () => Response.json({ error: { private: 'detail' }, message: 5 }, { status: 503 }), original);
    await assert.rejects(api.getStatus(), /Failed to fetch status/);
  } finally {
    globalThis.fetch = original;
  }
});

test('UI simulation accepts the supported act decision without inventing a reply', () => {
  expect(responseContracts.simulation({
    success: true,
    simulatedMessage: { id: 'local', chatId: 'local', sender: 'local', text: 'test', timestamp: 1, isFromMe: false, type: 'text' },
    decision: { action: 'act', intent: 'tool', reasoning: 'tool action', confidence: 1, simulatedDelayMs: 0 },
    shouldSendImmediately: false
  })).toBe(true);
});
