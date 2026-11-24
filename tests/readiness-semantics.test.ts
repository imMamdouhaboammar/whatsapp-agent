import { describe, expect, it } from 'bun:test';
import { createApiServer } from '../src/server/api';
import { MemoryStore } from '../src/domain/memory-store';
import { SSEBroadcaster } from '../src/server/sse';
import { DiagnosticsCore } from '../src/observability/diagnostics-core';

function appWith(state: string, transportMode?: 'baileys' | 'meta-cloud') {
  return createApiServer({
    memoryStore: new MemoryStore({ dataDir: ':memory:' }),
    whatsappClient: transportMode === 'meta-cloud'
      ? undefined
      : ({ getState: () => ({ state, updatedAt: Date.now() }), disconnect: async () => {} } as any),
    moderatorAgent: {
      getContextFoldEngine: () => undefined,
      getPolicy: () => ({ version: 1 }),
      getPersona: () => ({ name: 'Test' })
    } as any,
    sse: new SSEBroadcaster(),
    diagnostics: new DiagnosticsCore(),
    transportMode
  });
}

describe('WA-010 readiness semantics', () => {
  it('a disconnected Baileys channel with a healthy database is NOT ready', async () => {
    const res = await appWith('disconnected').request('/readyz');
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe('unready');
    expect(body.checks.database).toBe('healthy');
    expect(body.checks.transport.state).toBe('disconnected');
    expect(body.checks.transport.ready).toBe(false);
  });

  it('a failed Baileys channel is NOT ready', async () => {
    const res = await appWith('failed').request('/readyz');
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe('unready');
  });

  it('a connecting Baileys channel is NOT ready yet', async () => {
    const res = await appWith('connecting').request('/readyz');
    expect(res.status).toBe(503);
  });

  it('a connected Baileys channel with a healthy database IS ready', async () => {
    const res = await appWith('connected').request('/readyz');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ready');
    expect(body.checks.transport.ready).toBe(true);
  });

  it('meta-cloud mode has no persistent socket; readiness reflects the datastore and reports the mode', async () => {
    const res = await appWith('unused', 'meta-cloud').request('/readyz');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.checks.transport.mode).toBe('meta-cloud');
  });
});
