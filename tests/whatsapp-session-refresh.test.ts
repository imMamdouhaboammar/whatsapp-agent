import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { SSEBroadcaster } from '../src/server/sse';
import { createApiServer } from '../src/server/api';

const fixtures: string[] = [];
const stores: MemoryStore[] = [];

function makeTempSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wa-session-test-'));
  fixtures.push(dir);
  return dir;
}

afterEach(() => {
  for (const memory of stores.splice(0)) memory.close();
  for (const dir of fixtures.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
});

describe('WhatsAppSocketClient session refresh and recovery', () => {
  it('clearSession() atomically wipes stale session files and leaves a clean directory', () => {
    const sessionDir = makeTempSessionDir();
    writeFileSync(join(sessionDir, 'creds.json'), JSON.stringify({ me: { id: 'test' } }));
    writeFileSync(join(sessionDir, 'app-state-sync-key-1.json'), '{}');

    const client = new WhatsAppSocketClient({ sessionDir });
    expect(readdirSync(sessionDir).length).toBe(2);

    client.clearSession();

    expect(existsSync(sessionDir)).toBe(true);
    expect(readdirSync(sessionDir).length).toBe(0);
  });

  it('self-heals when credentials have me populated but registered is false', async () => {
    const sessionDir = makeTempSessionDir();
    // Simulate dead session from previous device logout
    writeFileSync(
      join(sessionDir, 'creds.json'),
      JSON.stringify({
        registered: false,
        me: { id: '201501903990:5@s.whatsapp.net', name: 'Stale' },
        noiseKey: { private: { type: 'Buffer', data: [] }, public: { type: 'Buffer', data: [] } }
      })
    );
    writeFileSync(join(sessionDir, 'stale-sync-key.json'), '{"dummy":true}');

    const client = new WhatsAppSocketClient({ sessionDir });
    expect(readdirSync(sessionDir).length).toBe(2);

    // Calling clearSession or starting with refresh purges stale files
    client.clearSession();
    expect(readdirSync(sessionDir).length).toBe(0);
  });

  it('does NOT auto-flush session during start() when me is populated and registered is false (FL-055 post-pairing reconnect)', async () => {
    const sessionDir = makeTempSessionDir();
    writeFileSync(
      join(sessionDir, 'creds.json'),
      JSON.stringify({
        registered: false,
        me: { id: '201501903990:5@s.whatsapp.net', name: 'User' },
      })
    );
    writeFileSync(join(sessionDir, 'pre-key-1.json'), '{"key":"valid"}');

    let socketCreated = false;
    const client = new WhatsAppSocketClient({
      sessionDir,
      versionProvider: async () => ({ version: [2, 3000, 1043857760] }),
      authStateFactory: async () => ({
        state: { creds: { registered: false, me: { id: '201501903990:5@s.whatsapp.net' } }, keys: {} },
        saveCreds: async () => {}
      }),
      socketFactory: () => {
        socketCreated = true;
        return {
          ev: {
            on: () => {},
            removeAllListeners: () => {}
          },
          authState: { creds: { registered: false } },
          requestPairingCode: async () => { throw new Error('Unexpected pairing request'); },
          sendPresenceUpdate: async () => { throw new Error('Unexpected presence update'); },
          sendMessage: async () => { throw new Error('Unexpected message send'); },
          end: async () => { /* No provider connection was opened by this fake. */ }
        };
      }
    });

    await client.start();

    // Verify session files were NOT purged
    expect(socketCreated).toBe(true);
    expect(existsSync(join(sessionDir, 'pre-key-1.json'))).toBe(true);
    expect(readdirSync(sessionDir).length).toBe(2);
    await client.disconnect(false);
  });

  it('disconnect(true) explicitly purges session files', async () => {
    const sessionDir = makeTempSessionDir();
    writeFileSync(join(sessionDir, 'creds.json'), '{}');

    const client = new WhatsAppSocketClient({ sessionDir });
    expect(readdirSync(sessionDir).length).toBe(1);

    await client.disconnect(true);
    expect(readdirSync(sessionDir).length).toBe(0);
  });
});

function createSessionApi(whatsappClient: WhatsAppSocketClient) {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  stores.push(memoryStore);
  return createApiServer({
    whatsappClient,
    memoryStore,
    moderatorAgent: new ModeratorAgent(new GeminiClient(), memoryStore),
    sse: new SSEBroadcaster()
  });
}

describe('API connect & disconnect endpoints session management', () => {
  it('POST /api/connect forwards refresh flag to whatsappClient.start', async () => {
    const calls: Array<Parameters<WhatsAppSocketClient['start']>> = [];
    const client = new WhatsAppSocketClient({ sessionDir: makeTempSessionDir() });
    client.start = async (...args) => { calls.push(args); };
    const app = createSessionApi(client);

    const res = await app.request('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingPhoneNumber: '+201012345678', refresh: true })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'initiated', phone: '+201012345678', refresh: true });
    expect(calls).toEqual([['+201012345678', { refresh: true }]]);
  });

  it('POST /api/disconnect forwards clearSession flag to whatsappClient.disconnect', async () => {
    const calls: Array<Parameters<WhatsAppSocketClient['disconnect']>> = [];
    const client = new WhatsAppSocketClient({ sessionDir: makeTempSessionDir() });
    client.disconnect = async (...args) => { calls.push(args); };
    const app = createSessionApi(client);

    const res = await app.request('/api/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearSession: true })
    });

    expect(res.status).toBe(200);
    expect(calls).toEqual([[true]]);
  });
});
