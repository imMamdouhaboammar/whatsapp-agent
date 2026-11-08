import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryStore } from '../src/domain/memory-store';
import { ContextFoldEngine } from '../src/domain/context-fold-engine';
import type { ChatMessage, ConversationFold } from '../src/domain/types';

const chatId = 'contact-one@s.whatsapp.net';
const otherChat = 'contact-two@s.whatsapp.net';
const epoch = 1_770_000_000_000;
const stores: MemoryStore[] = [];

function createStore(): MemoryStore {
  const store = new MemoryStore({ dataDir: ':memory:' });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function addMessages(store: MemoryStore, count: number, chat = chatId, start = epoch, spacing = 60_000): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const message: ChatMessage = {
      id: `${chat}-message-${start}-${index}`,
      chatId: chat,
      sender: chat,
      text: `Message ${index} about quotation ${index}`,
      timestamp: start + index * spacing,
      isFromMe: false,
      type: 'text'
    };
    store.addMessage(message);
    return message;
  });
}

function fold(input: Partial<ConversationFold> = {}): ConversationFold {
  return {
    id: 'fold-1',
    chatId,
    tier: 1,
    topic: 'Quotation',
    summary: 'Customer asked about quotation',
    startMessageId: 'start',
    endMessageId: 'end',
    directMessageIds: ['start', 'end'],
    sourceFoldIds: [],
    messageCount: 2,
    factsExtracted: [],
    createdAt: epoch,
    ...input
  };
}

function engine(store: MemoryStore, options: Record<string, unknown> = {}) {
  let calls = 0;
  const worker = new ContextFoldEngine({
    memoryStore: store,
    summarizer: async ({ messages, folds }: { messages?: ChatMessage[]; folds?: ConversationFold[] }) => {
      calls++;
      return {
        topic: 'Quotation',
        summary: `Verified context ${messages?.map(message => message.text).join('; ') ?? folds?.map(item => item.summary).join('; ')}`,
        factsExtracted: ['Message 0 about quotation 0']
      };
    },
    now: () => epoch + 10 * 3_600_000,
    ...options
  });
  return { worker, calls: () => calls };
}

describe('WhatsApp Context Fold persistence and lineage', () => {
  test('stores tiered folds with exact chat-scoped direct message lineage', () => {
    const store = createStore();
    const [first, second] = addMessages(store, 2);
    const record = fold({
      startMessageId: first.id,
      endMessageId: second.id,
      directMessageIds: [first.id, second.id]
    });
    store.saveFold(record);
    expect(store.getFold(record.id)).toMatchObject(record);
    expect(store.getFolds(chatId).map(item => item.id)).toEqual([record.id]);
    expect(store.getFolds(otherChat)).toEqual([]);
    expect(store.getFoldMessages(record.id).map(message => message.id)).toEqual([first.id, second.id]);
  });

  test('rejects forged, cross-chat and noncontiguous lineage without persisting a fold', () => {
    const store = createStore();
    const messages = addMessages(store, 4);
    const [foreign] = addMessages(store, 1, otherChat);
    expect(() => store.saveFold(fold({
      startMessageId: messages[0]!.id,
      endMessageId: foreign!.id,
      directMessageIds: [messages[0]!.id, foreign!.id]
    }))).toThrow();
    expect(() => store.saveFold(fold({
      startMessageId: messages[0]!.id,
      endMessageId: messages[3]!.id,
      directMessageIds: [messages[0]!.id, messages[3]!.id]
    }))).toThrow();
    expect(store.getFolds(chatId)).toEqual([]);
  });

  test('fold retrieval and search remain chat-scoped; nearby decompression is bounded', () => {
    const store = createStore();
    const messages = addMessages(store, 20);
    addMessages(store, 3, otherChat);
    store.saveFold(fold({
      startMessageId: messages[0]!.id,
      endMessageId: messages[5]!.id,
      directMessageIds: messages.slice(0, 6).map(message => message.id),
      messageCount: 6
    }));
    expect(store.getMessageWindow(chatId, messages[5]!.id, 2).map(message => message.id))
      .toEqual(messages.slice(3, 8).map(message => message.id));
    expect(store.getMessageWindow(otherChat, messages[5]!.id, 2)).toEqual([]);
    expect(store.getUnfoldedMessages(chatId, 10).map(message => message.id))
      .toEqual(messages.slice(6, 10).map(message => message.id));
    const matches = store.searchMemory(chatId, 'quotation');
    expect(matches.folds.map(item => item.id)).toContain('fold-1');
    expect(matches.messages.every(message => message.chatId === chatId)).toBe(true);
  });
});

describe('Context Fold growth-gated background engine', () => {
  test('folds only historical contiguous messages and preserves the last 10 verbatim', async () => {
    const store = createStore();
    const messages = addMessages(store, 20);
    const { worker } = engine(store);
    expect(await worker.shouldFold(chatId)).toBe(true);
    const result = await worker.foldChatIncrement(chatId);
    expect(result).toBeDefined();
    expect(result?.tier).toBe(1);
    expect(result?.directMessageIds).toEqual(messages.slice(0, 10).map(message => message.id));
    expect(store.getFoldMessages(result!.id)).toHaveLength(10);
    expect(store.getMessages(chatId, 10).map(message => message.id)).toEqual(messages.slice(10).map(message => message.id));
    expect(await worker.shouldFold(chatId)).toBe(false);
  });

  test('idle gap allows a closed partial epoch while a recent active burst remains intact', async () => {
    const store = createStore();
    const older = addMessages(store, 4, chatId, epoch - 4 * 3_600_000);
    const tail = addMessages(store, 10, chatId, epoch + 3_600_000);
    const { worker } = engine(store, { minRawCount: 15 });
    const result = await worker.foldChatIncrement(chatId);
    expect(result?.directMessageIds).toEqual(older.map(message => message.id));
    expect(store.getMessages(chatId, 10).map(message => message.id)).toEqual(tail.map(message => message.id));
  });

  test('concurrent checks coalesce to one persisted fold and summary call', async () => {
    const store = createStore();
    addMessages(store, 20);
    const { worker, calls } = engine(store);
    const [first, second] = await Promise.all([
      worker.triggerFoldCheck(chatId),
      worker.triggerFoldCheck(chatId)
    ]);
    expect(first?.id ?? null).toBe(second?.id ?? null);
    expect(store.getFolds(chatId, 1)).toHaveLength(1);
    expect(calls()).toBe(1);
  });

  test('coalesces five tier-one blocks into a tier-two milestone without dropping lineage', async () => {
    const store = createStore();
    const messages = addMessages(store, 25);
    for (let index = 0; index < 5; index++) {
      const slice = messages.slice(index * 3, index * 3 + 3);
      store.saveFold(fold({
        id: `fold-${index}`,
        startMessageId: slice[0]!.id,
        endMessageId: slice.at(-1)!.id,
        directMessageIds: slice.map(message => message.id),
        messageCount: slice.length
      }));
    }
    const { worker } = engine(store);
    const milestone = await worker.coalesceTier1Folds(chatId);
    expect(milestone?.tier).toBe(2);
    expect(milestone?.sourceFoldIds).toEqual(['fold-0', 'fold-1', 'fold-2', 'fold-3', 'fold-4']);
    expect(milestone?.directMessageIds).toEqual(messages.slice(0, 15).map(message => message.id));
    expect(await worker.coalesceTier1Folds(chatId)).toBeNull();
  });

  test('does not persist model output credentials or unverified alleged facts', async () => {
    const store = createStore();
    addMessages(store, 20);
    const secret = ['sk', 'fake', 'z'.repeat(32)].join('-');
    const worker = new ContextFoldEngine({
      memoryStore: store,
      summarizer: async () => ({
        topic: 'Credential',
        summary: `Customer said ${secret}`,
        factsExtracted: [secret, 'Unverified spending limit']
      }),
      now: () => epoch + 10 * 3_600_000
    });
    const result = await worker.foldChatIncrement(chatId);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result?.factsExtracted).toEqual([]);
    expect(store.getDossier(chatId)?.facts ?? []).toEqual([]);
  });

  test('worker failures leave raw history intact and allow a later retry', async () => {
    const store = createStore();
    addMessages(store, 20);
    let failure = true;
    const worker = new ContextFoldEngine({
      memoryStore: store,
      summarizer: async () => {
        if (failure) throw new Error('model unavailable');
        return { topic: 'Summary', summary: 'Recovered', factsExtracted: [] };
      }
    });
    expect(await worker.triggerFoldCheck(chatId)).toBeNull();
    expect(store.getFolds(chatId)).toEqual([]);
    expect(store.getMessages(chatId, 20)).toHaveLength(20);
    failure = false;
    expect(await worker.triggerFoldCheck(chatId)).toBeDefined();
  });
});
