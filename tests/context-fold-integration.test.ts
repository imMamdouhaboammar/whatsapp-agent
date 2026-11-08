import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MemoryStore } from '../src/domain/memory-store';
import { ContextFoldEngine } from '../src/domain/context-fold-engine';
import { buildFoldContext } from '../src/domain/context-fold-prompt';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ChatMessage, ConversationFold } from '../src/domain/types';

const chatId = 'contact-one@s.whatsapp.net';
const otherChat = 'contact-other@s.whatsapp.net';
const stores: MemoryStore[] = [];
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
    startMessageId: messages[0]!.id, endMessageId: messages[9]!.id,
    directMessageIds: messages.slice(0, 10).map(item => item.id),
    sourceFoldIds: [], messageCount: 10, factsExtracted: [], createdAt: 1_770_000_000_000
  };
  return { memory, messages, fold };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

describe('Fold prompt assembly and lineage safety', () => {
  test('places historical fold before verbatim recent tail with stable system instruction', async () => {
    const { memory, messages, fold } = setup();
    memory.saveFold(fold);
    let observed: { prompt: string; systemInstruction: string }[] = [];
    const mockGemini: any = {
      generateContent: async (contents: any[], options: any) => {
        observed.push({ prompt: contents[0].parts[0].text, systemInstruction: options.systemInstruction });
        return { text: JSON.stringify({ action: 'reply', intent: 'greeting', replyText: 'تمام', confidence: 0.99 }) };
      }
    };
    const agent = new ModeratorAgent(mockGemini, memory);
    const incoming: ChatMessage = {
      ...messages[19]!, id: 'new-inbound', text: 'فاكر الاتفاق القديم؟'
    };
    await agent.processInboundMessage(incoming, { dryRun: true });
    await agent.processInboundMessage({ ...incoming, text: 'تمام' }, { dryRun: true });
    expect(observed).toHaveLength(2);
    expect(observed[0]!.prompt).toContain(fold.summary);
    expect(observed[0]!.prompt.indexOf(fold.summary)).toBeLessThan(observed[0]!.prompt.indexOf('Offer 19'));
    expect(observed[0]!.prompt).not.toContain('Offer 0\n');
    expect(observed[0]!.systemInstruction).toBe(observed[1]!.systemInstruction);
    expect(buildFoldContext(memory, otherChat)).toBe('');
  });

  test('stale fold whose raw source was deleted is omitted from prompts', () => {
    const { memory, fold } = setup();
    memory.saveFold(fold);
    expect(buildFoldContext(memory, chatId)).toContain('Previous price discussion');
    const db = (memory.getSqliteStore() as unknown as { db: Database }).db;
    db.query('DELETE FROM messages WHERE id = ?').run('item-5');
    expect(memory.getFoldMessages(fold.id)).toHaveLength(9);
    expect(buildFoldContext(memory, chatId)).toBe('');
    expect(memory.getMessages(chatId, 10)).toHaveLength(10);
  });

  test('redacts source credentials before AI summary callback and preserves source rows', async () => {
    const { memory, messages } = setup();
    const secret = ['sk', 'fake', 'X'.repeat(32)].join('-');
    memory.getSqliteStore().saveMessage({ ...messages[0]!, id: 'new-secret', text: `Customer shared ${secret}`, timestamp: messages[0]!.timestamp - 1000 });
    let sawSecret = false;
    const worker = new ContextFoldEngine({
      memoryStore: memory,
      summarizer: async ({ messages: source }) => {
        sawSecret = JSON.stringify(source).includes(secret);
        return { topic: 'Historical quote', summary: 'No verified commitment', factsExtracted: [] };
      },
      now: () => messages[19]!.timestamp + 3_600_000
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
  });

  test('caps background summarization concurrency at two jobs across chats', async () => {
    const { memory, messages } = setup();
    for (let chat = 1; chat < 5; chat++) {
      for (let index = 0; index < messages.length; index++) {
        const item = messages[index]!;
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
    const agent = new ModeratorAgent({ generateContent: async () => ({ text: '{}' }) } as any, memory);
    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      moderatorAgent: agent,
      whatsappClient: { getState: () => ({ state: 'connected' }) } as any
    });
    const list = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    const names = (await list({ method: 'tools/list' }, {})).tools.map((tool: any) => tool.name);
    for (const name of ['whatsapp_search_chat_memory', 'whatsapp_get_chat_folds', 'whatsapp_decompress_fold']) {
      expect(names).toContain(name);
    }
    const invoke = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const call = async (name: string, args: Record<string, unknown>) =>
      invoke({ method: 'tools/call', params: { name, arguments: args } }, {});
    const folds = JSON.parse((await call('whatsapp_get_chat_folds', { chatId })).content[0].text);
    expect(folds).toHaveLength(1);
    const search = JSON.parse((await call('whatsapp_search_chat_memory', { chatId, query: 'Offer 2' })).content[0].text);
    expect(search.messages[0].id).toBe(messages[2]!.id);
    const expanded = JSON.parse((await call('whatsapp_decompress_fold', {
      chatId, foldId: fold.id, aroundMessageId: messages[5]!.id
    })).content[0].text);
    expect(expanded.messages.map((message: ChatMessage) => message.id))
      .toEqual(messages.slice(3, 8).map(message => message.id));
    await expect(call('whatsapp_decompress_fold', { chatId: otherChat, foldId: fold.id })).rejects.toThrow();
    await expect(call('whatsapp_decompress_fold', {
      chatId, foldId: fold.id, aroundMessageId: messages[11]!.id
    })).rejects.toThrow();
  });

  test('REST fold routes are owner-protected and manual folding schedules background work', async () => {
    const { memory, fold } = setup();
    memory.saveFold(fold);
    const engine = new ContextFoldEngine({
      memoryStore: memory,
      summarizer: async () => ({ topic: 'History', summary: 'Verified history', factsExtracted: [] })
    });
    const agent = new ModeratorAgent(
      { generateContent: async () => ({ text: '{}' }) } as any,
      memory, { contextFoldEngine: engine }
    );
    const app = createApiServer({
      memoryStore: memory, moderatorAgent: agent,
      dashboardToken: 'local-owner-token-for-context-fold-tests',
      whatsappClient: { getState: () => ({ state: 'connected' }) } as any,
      sse: new SSEBroadcaster()
    });
    const route = `/api/chats/${encodeURIComponent(chatId)}/folds`;
    expect((await app.request(route)).status).toBe(401);
    const headers = { Authorization: 'Bearer local-owner-token-for-context-fold-tests' };
    const res = await app.request(route, { headers });
    expect(res.status).toBe(200);
    expect((await res.json()).folds).toHaveLength(1);
    const manual = await app.request(`/api/chats/${encodeURIComponent(chatId)}/fold-now`, { method: 'POST', headers });
    expect(manual.status).toBe(202);
    expect((await manual.json()).status).toBe('scheduled');
  });
});
