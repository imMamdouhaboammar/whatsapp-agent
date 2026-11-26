import { describe, expect, it } from 'bun:test';
import { createApiServer } from '../src/server/api';
import { MemoryStore } from '../src/domain/memory-store';
import { SSEBroadcaster } from '../src/server/sse';
import { DiagnosticsCore } from '../src/observability/diagnostics-core';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import type { PairingState } from '../src/domain/types';

function appWith(state: PairingState['state'], transportMode?: 'baileys' | 'meta-cloud') {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  const whatsappClient = transportMode === 'meta-cloud' ? undefined : new WhatsAppSocketClient();
  if (whatsappClient) {
    whatsappClient.getState = () => ({ state, updatedAt: Date.now() });
    whatsappClient.disconnect = async () => {};
  }
  const moderatorAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memoryStore);
  return createApiServer({
    memoryStore,
    whatsappClient,
    moderatorAgent,
    sse: new SSEBroadcaster(),
    diagnostics: new DiagnosticsCore(),
    transportMode
  });
}

describe('WA-010 readiness semantics', () => {
  it('a disconnected Baileys channel with a healthy database is NOT ready', async () => {
    const res = await appWith('disconnected').request('/readyz');
    expect(res.status).toBe(503);
    const body: unknown = await res.json();
    expect(body).toMatchObject({
      status: 'unready',
      checks: { database: 'healthy', transport: { state: 'disconnected', ready: false } }
    });
  });

  it('a failed Baileys channel is NOT ready', async () => {
    const res = await appWith('failed').request('/readyz');
    expect(res.status).toBe(503);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ status: 'unready' });
  });

  it('a connecting Baileys channel is NOT ready yet', async () => {
    const res = await appWith('connecting').request('/readyz');
    expect(res.status).toBe(503);
  });

  it('a connected Baileys channel with a healthy database IS ready', async () => {
    const res = await appWith('connected').request('/readyz');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ status: 'ready', checks: { transport: { ready: true } } });
  });

  it('meta-cloud mode has no persistent socket; readiness reflects the datastore and reports the mode', async () => {
    const res = await appWith('disconnected', 'meta-cloud').request('/readyz');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ checks: { transport: { mode: 'meta-cloud' } } });
  });
});
