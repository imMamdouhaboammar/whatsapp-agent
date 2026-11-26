import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { BaileysEventMap, WAMessage } from '@whiskeysockets/baileys';
import { FakeSocketEvents } from './fixtures/fake-socket-events';
import { WhatsAppSocketClient, classifyDisconnect, type WhatsAppSocketPort } from '../src/transport/whatsapp-socket';

interface FakeCreds {
  registered: boolean;
  me: { id: string };
}

const fixtures: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'wa-lifecycle-')); fixtures.push(d); return d; };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class FakeSocket implements WhatsAppSocketPort {
  readonly ev = new FakeSocketEvents();
  get removedEvents() { return this.ev.removedEvents; }
  ended = false;
  sent: Array<{ jid: string; content: unknown }> = [];
  user = { id: '201000000000:5@s.whatsapp.net', name: 'Test' };
  readonly authState: WhatsAppSocketPort['authState'];
  readonly presenceUpdates: Array<{ type: string; jid?: string }> = [];

  constructor(creds: FakeCreds) {
    this.authState = { creds };
  }

  async emitAndFlush<K extends keyof BaileysEventMap>(event: K, payload: BaileysEventMap[K]) {
    await this.ev.emit(event, payload);
    await sleep(5);
  }

  async end() { this.ended = true; }
  async sendMessage(jid: string, content: unknown): Promise<WAMessage> {
    this.sent.push({ jid, content });
    return { key: { id: 'fake-' + this.sent.length } };
  }
  async sendPresenceUpdate(type: string, jid?: string) { this.presenceUpdates.push({ type, jid }); }
  async requestPairingCode() { return '1234-5678'; }
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

const registeredCreds: FakeCreds = { registered: true, me: { id: '201000000000:5@s.whatsapp.net' } };

function makeClient(overrides: {
  sockets?: FakeSocket[];
  authFactory?: () => Promise<{
    state: { creds: FakeCreds; keys?: { get: () => Promise<Record<string, unknown>> } };
    saveCreds: () => Promise<void>;
  }>;
  delays?: { baseMs: number; maxMs: number };
} = {}) {
  const sockets: FakeSocket[] = overrides.sockets ?? [];
  const sessionDir = tmp();
  const client = new WhatsAppSocketClient({
    sessionDir,
    socketFactory: () => {
      const sock = new FakeSocket(registeredCreds);
      sockets.push(sock);
      return sock;
    },
    authStateFactory: overrides.authFactory ?? (async () => ({
      state: { creds: registeredCreds },
      saveCreds: async () => {}
    })),
    versionProvider: async () => ({ version: [2, 3000, 0] }),
    reconnectDelays: overrides.delays ?? { baseMs: 5, maxMs: 20 }
  });
  return { client, sockets, sessionDir };
}

const closeWith = (code: number): BaileysEventMap['connection.update'] => ({
  connection: 'close',
  lastDisconnect: {
    error: Object.assign(new Error('boom ' + code), { output: { statusCode: code } }),
    date: new Date()
  }
});

describe('WA-013 serialized lifecycle with generation fencing', () => {
  it('replaces a socket after asynchronous end rejects', async () => {
    const { client, sockets } = makeClient();
    await client.start();
    const socket = sockets[0];
    if (!socket) throw new Error('Expected initial socket');
    const failure = new Error('replacement teardown failed');
    const end = spyOn(socket, 'end').mockRejectedValueOnce(failure);
    const warn = spyOn(console, 'warn');
    try {
      await client.start(undefined, { refresh: true });
      expect(end).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[WhatsApp] Error during socket listener cleanup:', failure);
      expect(sockets).toHaveLength(2);
    } finally {
      warn.mockRestore();
      await client.disconnect();
    }
  });

  it('completes explicit disconnect after asynchronous end rejects', async () => {
    const { client, sockets } = makeClient();
    await client.start();
    const socket = sockets[0];
    if (!socket) throw new Error('Expected initial socket');
    const failure = new Error('explicit teardown failed');
    const end = spyOn(socket, 'end').mockRejectedValueOnce(failure);
    const warn = spyOn(console, 'warn');
    try {
      await client.disconnect();
      expect(end).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[WhatsApp] Error during socket disconnect:', failure);
      expect(client.getState().state).toBe('disconnected');
    } finally {
      warn.mockRestore();
    }
  });

  it('explicit disconnect wins while a timer-driven reconnect is ending the old socket', async () => {
    const { client, sockets } = makeClient();
    await client.start();
    const socket = sockets[0];
    if (!socket) throw new Error('Expected initial socket');
    const entered = deferred<void>();
    const teardown = deferred<void>();
    const end = spyOn(socket, 'end').mockImplementation(async () => {
      entered.resolve(undefined);
      await teardown.promise;
    });
    await socket.ev.emit('connection.update', closeWith(503));
    await entered.promise;
    try {
      await sleep(0);
      expect(sockets).toHaveLength(1);
      await client.disconnect();
      expect(client.getState().state).toBe('disconnected');
      expect(end).toHaveBeenCalledTimes(1);
      expect(sockets).toHaveLength(1);
    } finally {
      teardown.resolve(undefined);
    }
    await sleep(0);
    expect(sockets).toHaveLength(1);
    expect(client.getState().state).toBe('disconnected');
  });

  it('handles asynchronous credential save rejection and fences retired callbacks', async () => {
    const failure = new Error('credential write failed');
    let saves = 0;
    const { client, sockets } = makeClient({
      authFactory: async () => ({
        state: { creds: registeredCreds },
        saveCreds: async () => {
          saves++;
          throw failure;
        }
      })
    });
    await client.start();
    const socket = sockets[0];
    if (!socket) throw new Error('Expected initial socket');
    const callbacks = socket.ev.snapshot('creds.update');
    expect(callbacks).toHaveLength(1);
    const warn = spyOn(console, 'warn');
    try {
      await socket.ev.emit('creds.update', {});
      expect(warn).toHaveBeenCalledWith('[WhatsApp] Failed to save credentials:', failure);
      expect(saves).toBe(1);
      await client.disconnect();
      for (const callback of callbacks) await callback({});
      expect(saves).toBe(1);
      expect(client.getState().state).toBe('disconnected');
    } finally {
      warn.mockRestore();
    }
  });

  it('an explicit disconnect during startup wins: no socket is resurrected', async () => {
    const gate = deferred<void>();
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({
      sockets,
      authFactory: async () => {
        await gate.promise;
        return { state: { creds: registeredCreds }, saveCreds: async () => {} };
      }
    });
    const startPromise = client.start();
    await sleep(10);
    await client.disconnect();
    gate.resolve(undefined);
    await startPromise;
    await sleep(10);
    expect(sockets.length).toBe(0); // startup aborted after the await, before socket creation
    expect(client.getState().state).toBe('disconnected');
  });

  it('callbacks from a retired socket generation cannot mutate current state', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    expect(sockets.length).toBe(1);
    const oldSock = sockets[0];
    if (!oldSock) throw new Error('Expected initial socket');
    const retired = oldSock.ev.snapshot('connection.update');
    expect(retired.length).toBeGreaterThan(0);
    await client.start(undefined, { refresh: true });
    expect(sockets.length).toBe(2);
    const newSock = sockets[1];
    if (!newSock) throw new Error('Expected replacement socket');

    for (const callback of retired) await callback({ connection: 'open' });
    expect(client.getState().state).not.toBe('connected');

    await newSock.emitAndFlush('connection.update', { connection: 'open' });
    expect(client.getState().state).toBe('connected');
  });

  it('cleanup detaches the history listener too', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    await client.start(undefined, { refresh: true });
    const oldSock = sockets[0];
    if (!oldSock) throw new Error('Expected old socket');
    for (const event of ['connection.update', 'creds.update', 'messages.upsert',
                         'messages.update', 'message-receipt.update', 'messaging-history.set']) {
      expect(oldSock.removedEvents).toContain(event);
    }
  });

  it("ignores a reverse LID mapping that is not a phone number string", async () => {
    const { client } = makeClient({
      authFactory: async () => ({
        state: {
          creds: registeredCreds,
          keys: { get: async () => ({ "123_reverse": { invalid: true } }) }
        },
        saveCreds: async () => {}
      })
    });
    await client.start();
    try {
      expect(await client.canonicalizeJid("123@lid")).toBe("123@lid");
    } finally {
      await client.disconnect();
    }
  });

  it('a delayed send across a reconnect fails closed before the network', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    const firstSock = sockets[0];
    if (!firstSock) throw new Error('Expected first socket');
    await firstSock.emitAndFlush('connection.update', { connection: 'open' });

    const sendPromise = client.sendMessage('201111111111@s.whatsapp.net', 'hello', { simulatedDelayMs: 60 });
    await sleep(20);
    await client.start(undefined, { refresh: true }); // bumps the generation mid-delay
    const result = await sendPromise.then(
      () => { throw new Error('A retired socket accepted the delayed send'); },
      (error: unknown) => error
    );
    expect(result).toMatchObject({ code: 'WHATSAPP_NOT_CONNECTED' });
    expect(firstSock.sent.length).toBe(0);
  });
});

describe('WA-014 reconnect classification and bounded retry lifecycle', () => {
  it('classifies disconnect reasons into terminal, QR-cycle and transient', () => {
    expect(classifyDisconnect(401)).toBe('terminal');
    expect(classifyDisconnect(403)).toBe('terminal');
    expect(classifyDisconnect(440)).toBe('terminal');
    expect(classifyDisconnect(408)).toBe('qr_cycle');
    expect(classifyDisconnect(500)).toBe('qr_cycle');
    expect(classifyDisconnect(515)).toBe('qr_cycle');
    expect(classifyDisconnect(428)).toBe('transient');
    expect(classifyDisconnect(503)).toBe('transient');
    expect(classifyDisconnect(undefined)).toBe('transient');
  });

  it('transient failures retry with a bounded budget and then fail loudly', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    // Drive the retry loop: each new socket closes transiently.
    for (let i = 0; i < 12; i++) {
      const sock = sockets[sockets.length - 1];
      if (!sock) throw new Error('Expected socket');
      await sock.emitAndFlush('connection.update', closeWith(503));
      await sleep(30);
    }
    const state = client.getState();
    expect(state.state).toBe('failed');
    expect(state.error).toMatch(/reconnect|budget|owner/i);
    const created = sockets.length;
    await sleep(60);
    expect(sockets.length).toBe(created); // no further retries after exhaustion
  });

  it('terminal codes stop the lifecycle and request owner action', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    const sock = sockets[0];
    if (!sock) throw new Error('Expected socket');
    await sock.emitAndFlush('connection.update', closeWith(440));
    await sleep(40);
    const state = client.getState();
    expect(state.state).toBe('failed');
    expect(sockets.length).toBe(1); // no reconnect attempted
  });

  it('a manual start after exhaustion resets the retry budget', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    for (let i = 0; i < 12; i++) {
      const sock = sockets[sockets.length - 1];
      if (!sock) throw new Error('Expected socket');
      await sock.emitAndFlush('connection.update', closeWith(503));
      await sleep(30);
    }
    expect(client.getState().state).toBe('failed');
    await client.start();
    const sock = sockets[sockets.length - 1];
    if (!sock) throw new Error('Expected socket');
    await sock.emitAndFlush('connection.update', { connection: 'open' });
    expect(client.getState().state).toBe('connected');
  });
});

function makeFixture(version: string, validator: string): string {
  const dir = tmp();
  const libDir = join(dir, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils');
  mkdirSync(libDir, { recursive: true });
  writeFileSync(join(dir, 'node_modules', '@whiskeysockets', 'baileys', 'package.json'),
    JSON.stringify({ name: '@whiskeysockets/baileys', version }));
  writeFileSync(join(libDir, 'validate-connection.js'), validator);
  return dir;
}

describe('WA-014 patch-baileys compatibility guard', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
  // Repo root derived from this file's location (worktree-agnostic).

  const UNPATCHED = 'const x = {\n        passive: true, pull: true,\n        lidDbMigrated: false\n};';

  async function runPatch(cwd: string) {
    const proc = Bun.spawn(['bun', join(REPO, 'patch-baileys.mjs')], {
      cwd, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, BAILEYS_ROOT: cwd }
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    return { code, out, err };
  }

  it('is idempotent across two runs on a supported version', async () => {
    const dir = makeFixture('7.0.0-rc14', UNPATCHED);
    const first = await runPatch(dir);
    expect(first.code).toBe(0);
    const second = await runPatch(dir);
    expect(second.code).toBe(0);
    expect(second.out + second.err).toMatch(/already patched/);
    const patched = readFileSync(join(dir, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'validate-connection.js'), 'utf8');
    expect(patched).toContain('passive: false');
  });

  it('fails loudly on an unsupported baileys version', async () => {
    const dir = makeFixture('6.9.9', UNPATCHED);
    const result = await runPatch(dir);
    expect(result.code).not.toBe(0);
    expect(result.out + result.err).toMatch(/unsupported|version/i);
  });

  it('fails loudly when the patch target is missing', async () => {
    const dir = makeFixture('7.0.0-rc14', 'const x = { unrelated: true };');
    const result = await runPatch(dir);
    expect(result.code).not.toBe(0);
  });
});
