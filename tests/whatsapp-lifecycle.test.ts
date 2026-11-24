import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { WhatsAppSocketClient, classifyDisconnect } from '../src/transport/whatsapp-socket';

const fixtures: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'wa-lifecycle-')); fixtures.push(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class FakeSocket {
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  removedEvents: string[] = [];
  ended = false;
  sent: Array<{ jid: string; content: any }> = [];
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
      removeAllListeners: (event: string) => {
        this.removedEvents.push(event);
        this.handlers.delete(event);
      }
    };
  }
  emit(event: string, payload: any) {
    for (const cb of this.handlers.get(event) ?? []) void cb(payload);
  }
  async emitAndFlush(event: string, payload: any) {
    for (const cb of this.handlers.get(event) ?? []) await cb(payload);
    await sleep(5);
  }
  end() { this.ended = true; }
  async sendMessage(jid: string, content: any) {
    this.sent.push({ jid, content });
    return { key: { id: 'fake-' + this.sent.length } };
  }
  async requestPairingCode() { return '1234-5678'; }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const registeredCreds = { registered: true, me: { id: '201000000000:5@s.whatsapp.net' } };

function makeClient(overrides: {
  sockets?: FakeSocket[];
  authFactory?: () => Promise<any>;
  delays?: { baseMs: number; maxMs: number };
} = {}) {
  const sockets: FakeSocket[] = overrides.sockets ?? [];
  const sessionDir = tmp();
  const client = new WhatsAppSocketClient({
    sessionDir,
    socketFactory: () => {
      const sock = new FakeSocket(registeredCreds);
      sockets.push(sock);
      return sock as any;
    },
    authStateFactory: overrides.authFactory ?? (async () => ({
      state: { creds: registeredCreds },
      saveCreds: async () => {}
    })),
    versionProvider: async () => ({ version: [2, 3000, 0] as any }),
    reconnectDelays: overrides.delays ?? { baseMs: 5, maxMs: 20 }
  });
  return { client, sockets, sessionDir };
}

const closeWith = (code: number) => ({
  connection: 'close',
  lastDisconnect: { error: { output: { statusCode: code }, message: 'boom ' + code } }
});

describe('WA-013 serialized lifecycle with generation fencing', () => {
  it('an explicit disconnect during startup wins: no socket is resurrected', async () => {
    const gate = deferred<any>();
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
    await client.start(undefined, { refresh: true });
    expect(sockets.length).toBe(2);
    const [oldSock, newSock] = sockets;

    await oldSock.emitAndFlush('connection.update', { connection: 'open' });
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
    for (const event of ['connection.update', 'creds.update', 'messages.upsert',
                         'messages.update', 'message-receipt.update', 'messaging-history.set']) {
      expect(oldSock.removedEvents).toContain(event);
    }
  });

  it('a delayed send across a reconnect fails closed before the network', async () => {
    const sockets: FakeSocket[] = [];
    const { client } = makeClient({ sockets });
    await client.start();
    await sockets[0].emitAndFlush('connection.update', { connection: 'open' });

    const sendPromise = client.sendMessage('201111111111@s.whatsapp.net', 'hello', { simulatedDelayMs: 60 });
    await sleep(20);
    await client.start(undefined, { refresh: true }); // bumps the generation mid-delay
    await expect(sendPromise).rejects.toMatchObject({ code: 'WHATSAPP_NOT_CONNECTED' });
    expect(sockets[0].sent.length).toBe(0);
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
    await sockets[0].emitAndFlush('connection.update', closeWith(440));
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
      await sock.emitAndFlush('connection.update', closeWith(503));
      await sleep(30);
    }
    expect(client.getState().state).toBe('failed');
    await client.start();
    const sock = sockets[sockets.length - 1];
    await sock.emitAndFlush('connection.update', { connection: 'open' });
    expect(client.getState().state).toBe('connected');
  });
});

describe('WA-014 patch-baileys compatibility guard', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
  // Repo root derived from this file's location (worktree-agnostic).

  function makeFixture(version: string, validator: string): string {
    const dir = tmp();
    const libDir = join(dir, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils');
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(dir, 'node_modules', '@whiskeysockets', 'baileys', 'package.json'),
      JSON.stringify({ name: '@whiskeysockets/baileys', version }));
    writeFileSync(join(libDir, 'validate-connection.js'), validator);
    return dir;
  }

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
