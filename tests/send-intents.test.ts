import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/domain/memory-store';
import { SendIntentService } from '../src/domain/send-intent-service';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import type { SendIntentInput } from '../src/domain/send-ledger';

const stores: MemoryStore[] = [];
const makeStore = () => {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  stores.push(memory);
  return memory;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const input = (overrides: Partial<SendIntentInput> = {}): SendIntentInput => ({
  sourceKind: 'ui',
  sourceId: 'mutation-123',
  sourceRevision: 1,
  actionKind: 'text',
  chatId: '201111111111@s.whatsapp.net',
  text: 'Hello',
  policyRevision: 1,
  ...overrides
});

describe('S01 reliable send ledger', () => {
  it('reuses one durable intent and one send across duplicate requests', async () => {
    const memory = makeStore();
    let calls = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => ({ messageId: `native-${++calls}` })
    });
    const first = await service.sendText(input());
    const second = await service.sendText(input());
    expect(first.intent.id).toBe(second.intent.id);
    expect(first.intent.state).toBe('accepted');
    expect(second.intent.state).toBe('accepted');
    expect(calls).toBe(1);
    expect(memory.getSendLedger().getAttempts(first.intent.id)).toHaveLength(1);
    expect(memory.getSendLedger().getEvents(first.intent.id).map((e) => e.toState)).toEqual([
      'queued', 'attempting', 'accepted'
    ]);
  });

  it('rejects a changed payload on an existing source revision', async () => {
    const memory = makeStore();
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => ({ messageId: 'native-a' })
    });
    await service.sendText(input());
    expect(service.sendText(input({ text: 'Different' }))).rejects.toThrow(/conflict/i);
  });

  it('never calls the transport when persistence fails', async () => {
    const memory = makeStore();
    let networkCalls = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => { networkCalls++; return { messageId: 'unsafe' }; }
    });
    const ledger = memory.getSendLedger();
    ledger.closeForTesting();
    expect(service.sendText(input())).rejects.toThrow();
    expect(networkCalls).toBe(0);
  });

  it('does not automatically repeat a send with an uncertain outcome', async () => {
    const memory = makeStore();
    let calls = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => { calls++; throw new Error('network result unknown'); }
    });
    const first = await service.sendText(input());
    expect(first.intent.state).toBe('uncertain');
    const second = await service.sendText(input());
    expect(second.intent.state).toBe('uncertain');
    expect(calls).toBe(1);
    expect(memory.getSendLedger().getAttempts(first.intent.id)[0]?.outcome).toBe('uncertain');
  });

  it('recovers interrupted attempts as uncertain without retrying', () => {
    const memory = makeStore();
    const ledger = memory.getSendLedger();
    const queued = ledger.createIntent(input());
    const claimed = ledger.claim(queued.id, 'worker-1', 10);
    expect(claimed).toBeDefined();
    expect(ledger.recoverInterrupted(30_100)).toBe(1);
    expect(ledger.getIntent(queued.id)?.state).toBe('uncertain');
  });

  it('retries known pre-network failures within a bounded cap', async () => {
    const memory = makeStore();
    let calls = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('offline'), { code: 'WHATSAPP_NOT_CONNECTED' });
        return { messageId: 'native-after-retry' };
      },
      retryBaseMs: 1,
      maxAttempts: 2
    });
    const first = await service.sendText(input());
    expect(first.intent.state).toBe('queued');
    const second = await service.dispatch(first.intent.id, Date.now() + 1000);
    expect(second.intent.state).toBe('accepted');
    expect(calls).toBe(2);
  });

  it('advances receipts monotonically and only for correlated native IDs', async () => {
    const memory = makeStore();
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => ({ messageId: 'native-1' })
    });
    const result = await service.sendText(input());
    const ledger = memory.getSendLedger();
    expect(ledger.advanceReceipt(input().chatId, 'native-1', 'read')?.state).toBe('read');
    expect(ledger.advanceReceipt(input().chatId, 'native-1', 'delivered')).toBeUndefined();
    expect(ledger.advanceReceipt(input().chatId, 'wrong-native', 'read')).toBeUndefined();
    expect(ledger.getIntent(result.intent.id)?.state).toBe('read');
  });

  it('claims a draft once and creates exactly one intent in the same transaction', () => {
    const memory = makeStore();
    memory.saveDraft({
      id: 'draft-1', chatId: input().chatId, incomingMessageId: 'inbound-1',
      incomingText: 'What?', proposedReply: 'Answer', reasoning: 'Test',
      confidence: 0.9, status: 'pending', createdAt: Date.now()
    });
    const ledger = memory.getSendLedger();
    const first = ledger.approveDraft('draft-1', 'Edited answer', 3);
    const second = ledger.approveDraft('draft-1', 'Edited answer', 3);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.intent!.id).toBe(first.intent!.id);
    expect(memory.getDraft('draft-1')?.status).toBe('approved');
    expect(ledger.getAttempts(first.intent!.id)).toHaveLength(0);
  });
});

describe('S01 HTTP send paths', () => {
  const makeApi = (memory: MemoryStore, sender: (chatId: string, text: string) => Promise<{ messageId: string }>) =>
    createApiServer({
      memoryStore: memory,
      whatsappClient: {
        sendMessage: sender,
        canonicalizeJid: async (chatId: string) => chatId
      } as any,
      moderatorAgent: {} as any,
      sse: new SSEBroadcaster()
    });

  it('one UI mutation ID creates one send and a conflict is rejected', async () => {
    const memory = makeStore();
    let calls = 0;
    const app = makeApi(memory, async () => ({ messageId: `native-${++calls}` }));
    const request = (text: string) => app.request(
      `/api/chats/${encodeURIComponent(input().chatId)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, clientMutationId: 'ui-1' })
      }
    );
    const first = await request('Hello');
    const second = await request('Hello');
    const conflict = await request('Changed');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(calls).toBe(1);
    expect((await second.json()).intentId).toBe((await first.json()).intentId);
  });

  it('parallel draft approvals create one intent and one network send', async () => {
    const memory = makeStore();
    memory.saveDraft({
      id: 'draft-parallel', chatId: input().chatId, incomingMessageId: 'inbound-1',
      incomingText: 'Question', proposedReply: 'Answer', reasoning: 'Review',
      confidence: 0.9, status: 'pending', createdAt: Date.now()
    });
    let calls = 0;
    const app = makeApi(memory, async () => {
      calls++;
      await Promise.resolve();
      return { messageId: 'native-approval' };
    });
    const request = () => app.request('/api/drafts/draft-parallel/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editedText: 'Approved answer' })
    });
    const responses = await Promise.all([request(), request()]);
    expect(calls).toBe(1);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 202]);
    const payloads = await Promise.all(responses.map((r) => r.json()));
    expect(payloads.filter((p) => p.alreadyProcessed)).toHaveLength(1);
    expect(payloads[0].intentId).toBe(payloads[1].intentId);
  });
});

describe('S01 receipt correlation and deliberate retries', () => {
  it('catches up an early read receipt when the accepted message is persisted', async () => {
    const memory = makeStore();
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async (chatId) => {
        memory.updateMessageStatus(chatId, 'early-native', 'read');
        return { messageId: 'early-native' };
      }
    });
    const result = await service.sendText(input());
    expect(result.message?.status).toBe('read');
    expect(result.intent.state).toBe('read');
  });

  it('does not repeat accepted parts when a later split bubble becomes uncertain', async () => {
    const memory = makeStore();
    memory.setChatMode(input().chatId, 'autopilot');
    const sends: string[] = [];
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async (_chatId, text) => {
        sends.push(text);
        if (text === 'second') throw new Error('ambiguous');
        return { messageId: 'first-native' };
      }
    });
    const firstPart = input({ sourceKind: 'autopilot', sourceId: 'turn:part-1-of-2', text: 'first' });
    const secondPart = input({ sourceKind: 'autopilot', sourceId: 'turn:part-2-of-2', text: 'second' });
    expect((await service.sendText(firstPart)).intent.state).toBe('accepted');
    expect((await service.sendText(secondPart)).intent.state).toBe('uncertain');
    await service.sendText(firstPart);
    await service.sendText(secondPart);
    expect(sends).toEqual(['first', 'second']);
  });

  it('sends voice through the same ledger and retains its type on the message', async () => {
    const memory = makeStore();
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => { throw new Error('text should not run'); },
      prepareVoice: async () => new Uint8Array([1, 2, 3]),
      sendVoice: async () => ({ messageId: 'voice-native' })
    });
    const result = await service.sendVoice(input({ actionKind: 'voice', sourceId: 'voice-1' }));
    expect(result.intent.state).toBe('accepted');
    expect(result.message?.type).toBe('audio');
    expect(result.message?.transcription).toBe('Hello');
  });

  it('keeps a retry behind explicit approval and allows only one child retry', async () => {
    const memory = makeStore();
    let calls = 0;
    const app = createApiServer({
      memoryStore: memory,
      whatsappClient: {
        canonicalizeJid: async (id: string) => id,
        sendMessage: async () => {
          calls++;
          if (calls === 1) throw new Error('unknown after transmit');
          return { messageId: 'native-retry' };
        }
      } as any,
      moderatorAgent: {} as any,
      sse: new SSEBroadcaster()
    });
    const chatId = input().chatId;
    const sent = await app.request(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Review me', clientMutationId: 'first-attempt' })
    });
    expect(sent.status).toBe(202);
    const original = await sent.json();
    const listed = await app.request(`/api/chats/${encodeURIComponent(chatId)}/messages`);
    const displayed = await listed.json();
    expect(displayed.messages[0].deliveryState).toBe('uncertain');
    expect(displayed.messages[0].sendIntentId).toBe(original.intentId);
    const retryUrl = `/api/send-intents/${original.intentId}/retry`;
    const denied = await app.request(retryUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false })
    });
    expect(denied.status).toBe(400);
    expect(calls).toBe(1);
    const confirmed = (id: string) => app.request(retryUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, clientMutationId: id })
    });
    const [one, two] = await Promise.all([confirmed('explicit-1'), confirmed('explicit-2')]);
    expect([one.status, two.status].sort()).toEqual([200, 202]);
    expect(calls).toBe(2);
    const [payloadOne, payloadTwo] = await Promise.all([one.json(), two.json()]);
    expect(payloadOne.intentId).toBe(payloadTwo.intentId);
    const finalList = await app.request(`/api/chats/${encodeURIComponent(chatId)}/messages`);
    expect((await finalList.json()).messages.every((message: any) => message.deliveryState !== 'uncertain')).toBe(true);
  });
});

describe('S01 durable recovery', () => {
  it('keeps an uncertain send and its audit history after a SQLite restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wa-send-ledger-'));
    const dbPath = join(directory, 'messages.sqlite');
    let first: MemoryStore | undefined;
    let reopened: MemoryStore | undefined;
    try {
      first = new MemoryStore({ dataDir: ':memory:', dbPath });
      let calls = 0;
      const sender = async () => {
        calls++;
        throw new Error('result unknown');
      };
      const initialService = new SendIntentService({ memoryStore: first, sendText: sender });
      const original = await initialService.sendText(input());
      expect(original.intent.state).toBe('uncertain');
      first.close();
      first = undefined;

      reopened = new MemoryStore({ dataDir: ':memory:', dbPath });
      const restored = new SendIntentService({ memoryStore: reopened, sendText: sender });
      const duplicate = await restored.sendText(input());
      expect(duplicate.intent.id).toBe(original.intent.id);
      expect(duplicate.intent.state).toBe('uncertain');
      expect(calls).toBe(1);
      expect(reopened.getSendLedger().getEvents(original.intent.id).length).toBeGreaterThanOrEqual(3);
    } finally {
      first?.close();
      reopened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('S01 action gate', () => {
  it('blocks Auto-Pilot sends in Human or Co-Pilot chat mode before networking', async () => {
    const memory = makeStore();
    let sends = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => { sends++; return { messageId: 'blocked-native' }; }
    });
    const action = input({ sourceKind: 'autopilot', sourceId: 'restricted-turn' });
    memory.setChatMode(action.chatId, 'human');
    expect(service.sendText(action)).rejects.toThrow(/chat mode/);
    memory.setChatMode(action.chatId, 'copilot');
    expect(service.sendText(action)).rejects.toThrow(/chat mode/);
    expect(sends).toBe(0);
    expect(memory.getSendLedger().getBySource(action)).toBeUndefined();
  });
});

describe('S01 proven pre-network boundaries', () => {
  it('does not mark voice synthesis as a WhatsApp network attempt', async () => {
    const memory = makeStore();
    let prepares = 0;
    let sends = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      maxAttempts: 2,
      retryBaseMs: 1,
      prepareVoice: async () => {
        prepares++;
        if (prepares === 1) throw new Error('voice preparation failed');
        return new Uint8Array([1, 2]);
      },
      sendVoice: async () => { sends++; return { messageId: 'voice-native-2' }; },
      sendText: async () => { throw new Error('text must not run'); }
    });
    const first = await service.sendVoice(input({ actionKind: 'voice', sourceId: 'voice-preflight' }));
    expect(first.intent.state).toBe('queued');
    expect(sends).toBe(0);
    expect(memory.getSendLedger().getAttempts(first.intent.id)[0].networkStartedAt).toBeUndefined();
    const retry = await service.dispatch(first.intent.id, Date.now() + 1000);
    expect(retry.intent.state).toBe('accepted');
    expect(sends).toBe(1);
  });

  it('does not auto-retry ambiguous errors after the send adapter begins', async () => {
    const memory = makeStore();
    let calls = 0;
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => { calls++; throw new Error('timeout'); }
    });
    const first = await service.sendText(input());
    await service.dispatchDue(Date.now() + 60_000);
    expect(first.intent.state).toBe('uncertain');
    expect(calls).toBe(1);
    expect(memory.getSendLedger().getAttempts(first.intent.id)[0].networkStartedAt).toBeDefined();
  });
});

describe('S01 native transport acceptance boundary', () => {
  it('treats a text send response without a native ID as ambiguous', async () => {
    const memory = makeStore();
    const client = new WhatsAppSocketClient();
    let networkCalls = 0;
    (client as any).sock = {
      sendPresenceUpdate: async () => {},
      sendMessage: async () => { networkCalls++; return { key: {}, message: {} }; }
    };
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: (chatId, text, options) => client.sendMessage(chatId, text, options)
    });
    const directError = await client.sendMessage(input().chatId, 'raw', { simulatedDelayMs: 0 }).catch((error) => error);
    expect(directError.code).toBe('WHATSAPP_ACCEPTANCE_AMBIGUOUS');
    const result = await service.sendText(input());
    expect(result.intent.state).toBe('uncertain');
    expect(result.intent.nativeMessageId).toBeUndefined();
    await service.sendText(input());
    expect(networkCalls).toBe(2);
  });

  it('treats a voice send response without a native ID as ambiguous', async () => {
    const memory = makeStore();
    const client = new WhatsAppSocketClient();
    let networkCalls = 0;
    (client as any).sock = {
      sendPresenceUpdate: async () => {},
      sendMessage: async () => { networkCalls++; return { key: {}, message: {} }; }
    };
    const service = new SendIntentService({
      memoryStore: memory,
      sendText: async () => { throw new Error('text should not run'); },
      prepareVoice: async () => new Uint8Array([1, 2]),
      sendVoice: (chatId, audio, options) => client.sendVoiceNote(chatId, audio, {
        replyToMessageId: options?.replyToMessageId,
        simulatedRecordingDurationMs: 0
      })
    });
    const directError = await client.sendVoiceNote(input().chatId, new Uint8Array([1]), {
      simulatedRecordingDurationMs: 0
    }).catch((error) => error);
    expect(directError.code).toBe('WHATSAPP_ACCEPTANCE_AMBIGUOUS');
    const result = await service.sendVoice(input({ actionKind: 'voice', sourceId: 'ambiguous-voice' }));
    expect(result.intent.state).toBe('uncertain');
    expect(result.intent.nativeMessageId).toBeUndefined();
    await service.sendVoice(input({ actionKind: 'voice', sourceId: 'ambiguous-voice' }));
    expect(networkCalls).toBe(2);
  });
});
