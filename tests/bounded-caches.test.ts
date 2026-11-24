import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

class FakeSocket {
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  sent: Array<{ jid: string; content: any; opts: any }> = [];
  user = { id: '201000000000:5@s.whatsapp.net', name: 'Test' };
  authState: any;
  ev: any;
  constructor(creds: any) {
    this.authState = { creds };
    this.ev = {
      on: (event: string, cb: (...args: any[]) => void) => {
        const list = this.handlers.get(event) ?? [];
        list.push(cb);
        this.handlers.set(event, list);
      },
      removeAllListeners: (event: string) => { this.handlers.delete(event); }
    };
  }
  emit(event: string, payload: any) {
    for (const cb of this.handlers.get(event) ?? []) void cb(payload);
  }
  async sendMessage(jid: string, content: any, opts?: any) {
    this.sent.push({ jid, content, opts });
    return { key: { id: 'out-' + this.sent.length }, message: { conversation: 'x' } };
  }
  async sendPresenceUpdate() {}
  end() {}
}

const registeredCreds = { registered: true, me: { id: '201000000000:5@s.whatsapp.net' } };

function makeClient(lidMappings: Record<string, string> = {}) {
  const sockets: FakeSocket[] = [];
  const sessionDir = mkdtempSync(join(tmpdir(), 'wa-caches-'));
  const client = new WhatsAppSocketClient({
    sessionDir,
    socketFactory: () => {
      const sock = new FakeSocket(registeredCreds);
      sockets.push(sock);
      return sock as any;
    },
    authStateFactory: async () => ({
      state: {
        creds: registeredCreds,
        keys: {
          get: async (_category: string, ids: string[]) => {
            const out: Record<string, string> = {};
            for (const id of ids) if (lidMappings[id]) out[id] = lidMappings[id];
            return out;
          }
        }
      },
      saveCreds: async () => {}
    }),
    versionProvider: async () => ({ version: [2, 3000, 0] as any }),
    reconnectDelays: { baseMs: 5, maxMs: 20 }
  });
  return { client, sockets, cleanup: () => rmSync(sessionDir, { recursive: true, force: true }) };
}

async function startedClient(lidMappings: Record<string, string> = {}) {
  const ctx = makeClient(lidMappings);
  await ctx.client.start();
  const sock = ctx.sockets[0];
  await sock.emit('connection.update', { connection: 'open' });
  return { ...ctx, sock };
}

describe('WA-016 bounded raw message quote cache', () => {
  it('bounds outbound-only insertions: oldest outbound quote is evicted beyond capacity', async () => {
    const { client, sock, cleanup } = await startedClient();
    try {
      const chat = '201000000001@s.whatsapp.net';
      // 600 outbound sends: every send inserts into the quote cache
      for (let i = 0; i < 600; i++) {
        await client.sendMessage(chat, `msg ${i}`, { simulatedDelayMs: 0 });
      }
      // Replying to the very first outbound message must no longer resolve a quote
      await client.sendMessage(chat, 'reply to first', { replyToMessageId: 'out-1', simulatedDelayMs: 0 });
      expect(sock.sent[sock.sent.length - 1].opts?.quoted).toBeUndefined();
      // Replying to a recent outbound message still resolves
      await client.sendMessage(chat, 'reply to recent', { replyToMessageId: 'out-600', simulatedDelayMs: 0 });
      expect(sock.sent[sock.sent.length - 1].opts?.quoted).toBeDefined();
    } finally {
      await client.disconnect();
      cleanup();
    }
  });

  it('never resolves a quote across contacts (composite identity)', async () => {
    const { client, sock, cleanup } = await startedClient();
    try {
      const chatA = '201000000001@s.whatsapp.net';
      const chatB = '201000000002@s.whatsapp.net';
      // inbound message in chat A
      sock.emit('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { id: 'shared-id', remoteJid: chatA, fromMe: false },
          message: { conversation: 'hello from A' },
          messageTimestamp: 1_700_000_000
        }]
      });
      await new Promise((r) => setTimeout(r, 5));
      // quote from chat A resolves
      await client.sendMessage(chatA, 'reply in A', { replyToMessageId: 'shared-id', simulatedDelayMs: 0 });
      expect(sock.sent[sock.sent.length - 1].opts?.quoted).toBeDefined();
      // same id referenced from chat B must NOT reuse chat A's message
      await client.sendMessage(chatB, 'reply in B', { replyToMessageId: 'shared-id', simulatedDelayMs: 0 });
      expect(sock.sent[sock.sent.length - 1].opts?.quoted).toBeUndefined();
    } finally {
      await client.disconnect();
      cleanup();
    }
  });
});

describe('WA-016 bounded transport identity map', () => {
  it('evicts oldest reverse LID mappings beyond capacity on every insert path', async () => {
    // 600 distinct LID mappings => 1200 entries if unbounded
    const mappings: Record<string, string> = {};
    for (let i = 0; i < 600; i++) mappings[`lid${i}_reverse`] = `20100000${String(1000 + i)}`;
    const { client, sock, cleanup } = await startedClient(mappings);
    try {
      for (let i = 0; i < 600; i++) {
        await client.canonicalizeJid(`lid${i}@lid`);
      }
      // The first mapping must have been evicted by the bound: sending to its phone
      // now routes directly (no cached transport JID) instead of to the LID.
      await client.sendMessage('201000001000@s.whatsapp.net', 'ping', { simulatedDelayMs: 0 });
      expect(sock.sent[sock.sent.length - 1].jid).toBe('201000001000@s.whatsapp.net');
      // A recent mapping still routes through the cached transport identity.
      await client.sendMessage('201000001599@s.whatsapp.net', 'ping', { simulatedDelayMs: 0 });
      expect(sock.sent[sock.sent.length - 1].jid).toBe('lid599@lid');
    } finally {
      await client.disconnect();
      cleanup();
    }
  });
});
