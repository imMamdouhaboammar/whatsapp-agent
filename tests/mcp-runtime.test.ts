import { describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpRuntime } from '../src/mcp/runtime';
import { startManagedChannel } from '../src/mcp/managed-channel';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import type { PairingState } from '../src/domain/types';

const noopListener = (_s: PairingState) => {};

function fakeClient(opts: { connectOnStart?: boolean; failStart?: boolean } = {}) {
  const calls = { start: 0, disconnect: 0 };
  let listener: (s: PairingState) => void = noopListener;
  let state: PairingState = { state: 'disconnected', updatedAt: Date.now() };
  const client = new WhatsAppSocketClient();
  client.start = async () => {
    calls.start++;
    if (opts.failStart) throw new Error('boom');
    if (opts.connectOnStart) {
      state = { state: 'connected', updatedAt: Date.now(), connectedUser: { id: '201000000000@s.whatsapp.net', phone: '201000000000' } };
      listener(state);
    }
  };
  client.disconnect = async () => { calls.disconnect++; };
  client.getState = () => state;
  client.sendMessage = async () => ({ messageId: 'm1' });
  client.sendReaction = async () => {};
  return { client, calls, bind: (l: (s: PairingState) => void) => { listener = l; return client; } };
}

function makeDeps(name: string) {
  const memoryStore = new MemoryStore({ dataDir: `./data/test-mcp-runtime-${name}` });
  const gemini = new GeminiClient({ apiKey: 'test-key' });
  gemini.generateContent = async () => ({ text: '{}' });
  return { memoryStore, moderatorAgent: new ModeratorAgent(gemini, memoryStore) };
}

async function connectClient(server: Awaited<ReturnType<typeof createMcpRuntime>>['server']): Promise<Client> {
  const client = new Client({ name: 'mcp-runtime-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('MCP runner composition', () => {
  it('starts the transport exactly once and binds the server to that same client', async () => {
    const f = fakeClient({ connectOnStart: true });
    const logs: string[] = [];
    const runtime = await createMcpRuntime({ ...makeDeps('a'), createClient: f.bind, log: (m) => logs.push(m), connectTimeoutMs: 500 });
    expect(f.calls.start).toBe(1);
    expect(runtime.channel?.connected).toBe(true);

    const client = await connectClient(runtime.server);
    try {
      const res = CallToolResultSchema.parse(await client.callTool({ name: 'whatsapp_get_status' }));
      const item = res.content[0];
      if (item?.type !== 'text') throw new Error('Expected MCP text content');
      const status: unknown = JSON.parse(item.text);
      expect(status).toMatchObject({ connectionState: 'connected' });
    } finally {
      await client.close();
      await runtime.shutdown();
    }
    expect(f.calls.disconnect).toBe(1);
  });

  it('reports a bounded, honest not-connected state instead of hanging or throwing', async () => {
    const f = fakeClient();
    const logs: string[] = [];
    const t0 = Date.now();
    const channel = await startManagedChannel({ createClient: f.bind, connectTimeoutMs: 50, log: (m) => logs.push(m) });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(channel.connected).toBe(false);
    expect(channel.client.getState().state).toBe('disconnected');
    expect(logs.join('\n')).toContain('Not connected');
  });

  it('survives a transport start failure and logs to the injected sink', async () => {
    const f = fakeClient({ failStart: true });
    const logs: string[] = [];
    const channel = await startManagedChannel({ createClient: f.bind, connectTimeoutMs: 20, log: (m) => logs.push(m) });
    expect(channel.connected).toBe(false);
    expect(logs.some((l) => l.includes('Failed to start'))).toBe(true);
  });

  it('channelMode none never starts the transport', async () => {
    const f = fakeClient();
    const runtime = await createMcpRuntime({ ...makeDeps('b'), createClient: f.bind, channelMode: 'none' });
    expect(f.calls.start).toBe(0);
    expect(runtime.channel).toBeNull();
  });

  it('start() that never settles cannot block runtime creation past the timeout', async () => {
    const f = fakeClient();
    f.client.start = async () => new Promise<void>(() => {});
    const t0 = Date.now();
    const runtime = await createMcpRuntime({ ...makeDeps('stall'), createClient: f.bind, log: () => {}, connectTimeoutMs: 60 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(runtime.channel?.connected).toBe(false);
  });

  it('a start that throws ends the wait immediately instead of waiting out the timeout', async () => {
    const f = fakeClient({ failStart: true });
    const t0 = Date.now();
    const channel = await startManagedChannel({ createClient: f.bind, connectTimeoutMs: 5000, log: () => {} });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(channel.connected).toBe(false);
  });

  it('channel mode none is read-only: mutating tools are hidden and refused, reads do not mark chats read', async () => {
    const f = fakeClient();
    const d = makeDeps('ro');
    d.memoryStore.addMessage({ id: 'x1', chatId: 'c@s.whatsapp.net', sender: 'c@s.whatsapp.net', text: 'hi', timestamp: Date.now(), isFromMe: false, type: 'text' });
    const before = d.memoryStore.listChats().find((c) => c.id === 'c@s.whatsapp.net')?.unreadCount ?? 0;
    const runtime = await createMcpRuntime({ ...d, createClient: f.bind, channelMode: 'none' });
    const client = await connectClient(runtime.server);
    try {
      const list = await client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toContain('whatsapp_get_messages');
      for (const bad of ['whatsapp_send_message', 'whatsapp_send_reaction', 'whatsapp_set_chat_mode', 'whatsapp_approve_draft', 'whatsapp_manage_memory']) {
        expect(names).not.toContain(bad);
        const res = await client.callTool({ name: bad, arguments: {} });
        expect(res.isError).toBe(true);
      }
      await client.callTool({ name: 'whatsapp_get_messages', arguments: { chatId: 'c@s.whatsapp.net' } });
      expect(d.memoryStore.listChats().find((c) => c.id === 'c@s.whatsapp.net')?.unreadCount ?? 0).toBe(before);
    } finally {
      await client.close();
    }
  });
});
