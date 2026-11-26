import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Database } from 'bun:sqlite';
import { GeminiClient, type ChatContent, type GeminiGenerateOptions } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { ContextFoldEngine } from '../src/domain/context-fold-engine';
import { buildFoldContext } from '../src/domain/context-fold-prompt';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage, ConversationFold } from '../src/domain/types';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

const chatId = 'contact-one@s.whatsapp.net';
const otherChat = 'contact-other@s.whatsapp.net';
const stores: MemoryStore[] = [];

function requireValue<T>(value: T | undefined | null, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

function setup() {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  stores.push(memory);
  const messages: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
    id: `item-${index}`, chatId, sender: chatId, text: `Offer ${index}`,
    timestamp: 1_770_000_000_000 + index * 60_000, isFromMe: false, type: 'text'
  }));
  for (const item of messages) memory.addMessage(item);
  const fold: ConversationFold = {
    id: 'historical-epoch', chatId, tier: 1, topic: 'Previous price discussion',
    summary: 'Quoted price was subject to human approval',
    startMessageId: requireValue(messages[0]).id, endMessageId: requireValue(messages[9]).id,
    directMessageIds: messages.slice(0, 10).map(item => item.id),
    sourceFoldIds: [], messageCount: 10, factsExtracted: [], createdAt: 1_770_000_000_000
  };
  return { memory, messages, fold };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('Fold prompt assembly and lineage safety', () => {
  test('places historical fold before verbatim recent tail with stable system instruction', async () => {
    const { memory, messages, fold } = setup();
    memory.saveFold(fold);
    const observed: { prompt: string; systemInstruction?: string }[] = [];
    const mockGemini = new GeminiClient({ apiKey: 'test-key' });
    mockGemini.generateContent = async (contents: ChatContent[], options?: GeminiGenerateOptions) => {
      observed.push({ prompt: contents[0]?.parts[0]?.text ?? '', systemInstruction: options?.systemInstruction });
      return { text: JSON.stringify({ action: 'reply', intent: 'greeting', replyText: 'تمام', confidence: 0.99 }) };
    };
    const agent = new ModeratorAgent(mockGemini, memory);
    const incoming: ChatMessage = {
      ...requireValue(messages[19]), id: 'new-inbound', text: 'فاكر الاتفاق القديم؟'
    };
    await agent.processInboundMessage(incoming, { dryRun: true });
    await agent.processInboundMessage({ ...incoming, text: 'تمام' }, { dryRun: true });
    expect(observed).toHaveLength(2);
    const firstObserved = requireValue(observed[0]);
    const secondObserved = requireValue(observed[1]);
    expect(firstObserved.prompt).toContain(fold.summary);
    expect(firstObserved.prompt.indexOf(fold.summary)).toBeLessThan(firstObserved.prompt.indexOf('Offer 19'));
    expect(firstObserved.prompt).not.toContain('Offer 0\n');
    expect(firstObserved.systemInstruction).toBe(requireValue(secondObserved.systemInstruction));
    expect(buildFoldContext(memory, otherChat)).toBe('');
  });

  test('stale fold whose raw source was deleted is omitted from prompts', () => {
    const { memory, fold } = setup();
    memory.saveFold(fold);
    expect(buildFoldContext(memory, chatId)).toContain('Previous price discussion');
    const db: unknown = Reflect.get(memory.getSqliteStore(), 'db');
    if (!(db instanceof Database)) throw new Error('Expected SQLite database');
    db.query('DELETE FROM messages WHERE id = ?').run('item-5');
    expect(memory.getFoldMessages(fold.id)).toHaveLength(9);
    expect(buildFoldContext(memory, chatId)).toBe('');
    expect(memory.getMessages(chatId, 10)).toHaveLength(10);
  });

  test('redacts source credentials before AI summary callback and preserves source rows', async () => {
    const { memory, messages } = setup();
    const firstMsg = requireValue(messages[0]);
    const lastMsg = requireValue(messages[19]);
    const secret = ['sk', 'fake', 'X'.repeat(32)].join('-');
    memory.getSqliteStore().saveMessage({ ...firstMsg, id: 'new-secret', text: `Customer shared ${secret}`, timestamp: firstMsg.timestamp - 1000 });
    let sawSecret = false;
    const worker = new ContextFoldEngine({
      memoryStore: memory,
      summarizer: async ({ messages: source }) => {
        sawSecret = JSON.stringify(source).includes(secret);
        return { topic: 'Historical quote', summary: 'No verified commitment', factsExtracted: [] };
      },
      now: () => lastMsg.timestamp + 3_600_000
    });
    expect(await worker.foldChatIncrement(chatId)).toBeDefined();
    expect(sawSecret).toBe(false);
    expect(memory.getMessage(chatId, 'new-secret')?.text).toContain(secret);
  });

  test('keeps lineage validation query count bounded across hundreds of historical folds', () => {
    const { memory } = setup();
    const totalFolds = 120;
    for (let index = 0; index < totalFolds; index++) {
      const first: ChatMessage = {
        id: `historical-${index}-a`, chatId, sender: chatId,
        text: `Historical note ${index} a`, isFromMe: false, type: 'text',
        timestamp: 1_770_000_000_000 + (20 + index * 2) * 60_000
      };
      const second = { ...first, id: `historical-${index}-b`, text: `Historical note ${index} b`, timestamp: first.timestamp + 30_000 };
      memory.addMessage(first);
      memory.addMessage(second);
      memory.saveFold({
        id: `historical-fold-${index}`, chatId, tier: 1, topic: `Note ${index}`,
        summary: `Summary ${index}`, startMessageId: first.id, endMessageId: second.id,
        directMessageIds: [first.id, second.id], sourceFoldIds: [],
        messageCount: 2, factsExtracted: [], createdAt: 1_770_000_000_000 + index
      });
    }
    let reads = 0;
    const original = memory.getFoldMessages.bind(memory);
    memory.getFoldMessages = (id: string) => { reads++; return original(id); };
    const prompt = buildFoldContext(memory, chatId);
    expect(prompt).toContain('Summary 119');
    expect(prompt).not.toContain('Summary 1;');
    expect(reads).toBeLessThanOrEqual(52);
    expect(memory.getRecentFolds(chatId, 1, 4).map(item => item.id))
      .toEqual(['historical-fold-116', 'historical-fold-117', 'historical-fold-118', 'historical-fold-119']);
    expect(memory.getFolds(chatId, 1, 20)).toHaveLength(20);
    expect(memory.getPendingTier1Folds(chatId, 3).map(item => item.id))
      .toEqual(['historical-fold-0', 'historical-fold-1', 'historical-fold-2']);
  });

  test('caps background summarization concurrency at two jobs across chats', async () => {
    const { memory, messages } = setup();
    for (let chat = 1; chat < 5; chat++) {
      for (let index = 0; index < messages.length; index++) {
        const item = requireValue(messages[index]);
        memory.addMessage({
          ...item, id: `chat-${chat}-message-${index}`,
          chatId: `chat-${chat}@s.whatsapp.net`,
          sender: `chat-${chat}@s.whatsapp.net`
        });
      }
    }
    let active = 0;
    let peak = 0;
    const worker = new ContextFoldEngine({
      memoryStore: memory,
      summarizer: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        active--;
        return { topic: 'Summary', summary: 'Verified note', factsExtracted: [] };
      }
    });
    const ids = [chatId, ...Array.from({ length: 4 }, (_, index) => `chat-${index + 1}@s.whatsapp.net`)];
    const results = await Promise.all(ids.map(id => worker.triggerFoldCheck(id)));
    expect(results).toHaveLength(5);
    expect(results.every(Boolean)).toBe(true);
    expect(peak).toBe(2);
  });
});

describe('Fold operator tools and REST API', () => {
  test('MCP tools are registered, chat-scoped, searched and decompressed with bounded context', async () => {
    const { memory, messages, fold } = setup();
    memory.saveFold(fold);
    const gemini = new GeminiClient({ apiKey: 'test-key' });
    gemini.generateContent = async () => ({ text: '{}' });
    const agent = new ModeratorAgent(gemini, memory);
    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      moderatorAgent: agent,
      whatsappClient: new WhatsAppSocketClient()
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const listRes = await client.listTools();
      const names = listRes.tools.map(tool => tool.name);
      for (const name of ['whatsapp_search_chat_memory', 'whatsapp_get_chat_folds', 'whatsapp_decompress_fold']) {
        expect(names).toContain(name);
      }
      const call = async (name: string, args: Record<string, unknown>) => {
        const res = await client.callTool({ name, arguments: args });
        const content: unknown = Array.isArray(res.content) ? res.content[0] : undefined;
        const text = typeof content === 'object' && content !== null && 'type' in content &&
          content.type === 'text' && 'text' in content && typeof content.text === 'string' ? content.text : undefined;
        if (res.isError) throw new Error(text ?? 'MCP tool error');
        return text ?? '';
      };
      const folds: unknown = JSON.parse(await call('whatsapp_get_chat_folds', { chatId }));
      expect(Array.isArray(folds)).toBe(true);
      expect(folds).toHaveLength(1);
      const search: unknown = JSON.parse(await call('whatsapp_search_chat_memory', { chatId, query: 'Offer 2' }));
      if (typeof search !== 'object' || search === null || !('messages' in search) || !Array.isArray(search.messages)) {
        throw new Error('Expected search messages');
      }
      expect(search.messages[0]).toMatchObject({ id: requireValue(messages[2]).id });
      const expanded: unknown = JSON.parse(await call('whatsapp_decompress_fold', {
        chatId, foldId: fold.id, aroundMessageId: requireValue(messages[5]).id
      }));
      expect(expanded).toMatchObject({
        messages: messages.slice(3, 8).map(message => ({ id: message.id }))
      });
      for (const args of [
        { chatId: otherChat, foldId: fold.id },
        { chatId, foldId: fold.id, aroundMessageId: requireValue(messages[11]).id }
      ]) {
        await call('whatsapp_decompress_fold', args).then(
          () => { throw new Error('Unexpected fold decompression success'); },
          (error: unknown) => { expect(error).toBeInstanceOf(Error); }
        );
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('REST fold routes are owner-protected and manual folding schedules background work', async () => {
    const { memory, fold } = setup();
    memory.saveFold(fold);
    const engine = new ContextFoldEngine({
      memoryStore: memory,
      summarizer: async () => ({ topic: 'History', summary: 'Verified history', factsExtracted: [] })
    });
    const gemini = new GeminiClient({ apiKey: 'test-key' });
    gemini.generateContent = async () => ({ text: '{}' });
    const agent = new ModeratorAgent(gemini, memory, { contextFoldEngine: engine });
    const app = createApiServer({
      memoryStore: memory, moderatorAgent: agent,
      dashboardToken: 'local-owner-token-for-context-fold-tests',
      whatsappClient: new WhatsAppSocketClient(),
      sse: new SSEBroadcaster()
    });
    const route = `/api/chats/${encodeURIComponent(chatId)}/folds`;
    expect((await app.request(route)).status).toBe(401);
    const headers = { Authorization: 'Bearer local-owner-token-for-context-fold-tests' };
    const res = await app.request(route, { headers });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null || !('folds' in body) || !Array.isArray(body.folds)) {
      throw new Error('Expected response folds');
    }
    expect(body.folds).toHaveLength(1);
    const manual = await app.request(`/api/chats/${encodeURIComponent(chatId)}/fold-now`, { method: 'POST', headers });
    expect(manual.status).toBe(202);
    const manualBody: unknown = await manual.json();
    expect(manualBody).toMatchObject({ status: 'scheduled' });
  });
});
