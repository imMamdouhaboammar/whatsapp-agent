import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { ContextFoldEngine } from '../src/domain/context-fold-engine';
import { buildFoldContext } from '../src/domain/context-fold-prompt';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage, ConversationFold } from '../src/domain/types';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

const chatId = 'client-vip@s.whatsapp.net';
const epoch = 1_770_000_000_000;
const stores: MemoryStore[] = [];

function requireValue<T>(value: T | undefined | null, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

function createStore(): MemoryStore {
  const store = new MemoryStore({ dataDir: ':memory:' });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function addMessages(store: MemoryStore, count: number, start = epoch): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const msg: ChatMessage = {
      id: `msg-${start}-${i}`,
      chatId,
      sender: chatId,
      text: `Historical transaction statement item ${i}`,
      timestamp: start + i * 60_000,
      isFromMe: i % 2 === 1,
      type: 'text'
    };
    store.addMessage(msg);
    return msg;
  });
}

describe('3-Tier LSM Context Compression & Active Context Pruning', () => {
  test('coalesces Tier-2 milestones into Tier-3 Archival folds with unbroken lineage', async () => {
    const store = createStore();
    // 20 messages -> 4 Tier-1 folds (5 msgs each)
    const messages = addMessages(store, 20);

    const t1Folds: ConversationFold[] = [];
    for (let f = 0; f < 4; f++) {
      const slice = messages.slice(f * 5, (f + 1) * 5);
      const fold: ConversationFold = {
        id: `fold-t1-${f}`,
        chatId,
        tier: 1,
        topic: `Session ${f}`,
        summary: `Summary of session ${f}`,
        startMessageId: requireValue(slice[0]).id,
        endMessageId: requireValue(slice.at(-1)).id,
        directMessageIds: slice.map(m => m.id),
        sourceFoldIds: [],
        messageCount: slice.length,
        factsExtracted: [`Fact from session ${f}`],
        createdAt: epoch + f * 1000
      };
      store.saveFold(fold);
      t1Folds.push(fold);
    }

    expect(store.getFolds(chatId, 1)).toHaveLength(4);

    // Coalesce pairs into two Tier-2 milestones
    const t1Fold0 = requireValue(t1Folds[0]);
    const t1Fold1 = requireValue(t1Folds[1]);
    const m1Slice = [...t1Fold0.directMessageIds, ...t1Fold1.directMessageIds];
    const t2Fold1: ConversationFold = {
      id: 'fold-t2-0',
      chatId,
      tier: 2,
      topic: 'Milestone 0 (Sessions 0-1)',
      summary: 'Combined agreement from sessions 0 and 1',
      startMessageId: requireValue(m1Slice[0]),
      endMessageId: requireValue(m1Slice.at(-1)),
      directMessageIds: m1Slice,
      sourceFoldIds: [t1Fold0.id, t1Fold1.id],
      messageCount: m1Slice.length,
      factsExtracted: ['Fact from session 0', 'Fact from session 1'],
      createdAt: epoch + 5000
    };
    store.saveFold(t2Fold1);

    const t1Fold2 = requireValue(t1Folds[2]);
    const t1Fold3 = requireValue(t1Folds[3]);
    const m2Slice = [...t1Fold2.directMessageIds, ...t1Fold3.directMessageIds];
    const t2Fold2: ConversationFold = {
      id: 'fold-t2-1',
      chatId,
      tier: 2,
      topic: 'Milestone 1 (Sessions 2-3)',
      summary: 'Combined agreement from sessions 2 and 3',
      startMessageId: requireValue(m2Slice[0]),
      endMessageId: requireValue(m2Slice.at(-1)),
      directMessageIds: m2Slice,
      sourceFoldIds: [t1Fold2.id, t1Fold3.id],
      messageCount: m2Slice.length,
      factsExtracted: ['Fact from session 2', 'Fact from session 3'],
      createdAt: epoch + 6000
    };
    store.saveFold(t2Fold2);

    expect(store.getFolds(chatId, 2)).toHaveLength(2);
    expect(store.getPendingTier2Folds(chatId, 5)).toHaveLength(2);

    // Now coalesce the two Tier-2 milestones into Tier-3 Archival fold
    const engine = new ContextFoldEngine({
      memoryStore: store,
      summarizer: async (req) => {
        expect(req.tier).toBe(3);
        expect(req.folds).toHaveLength(2);
        return {
          topic: 'Archival Agreement Phase 1',
          summary: 'High-density multi-milestone contract summary',
          factsExtracted: ['Fact from session 0']
        };
      },
      tier3Threshold: 2,
      now: () => epoch + 100_000
    });

    const archival = requireValue(await engine.coalesceTier2Folds(chatId));
    expect(archival.tier).toBe(3);
    expect(archival.topic).toBe('Archival Agreement Phase 1');
    expect(archival.messageCount).toBe(20);
    expect(archival.startMessageId).toBe(requireValue(messages[0]).id);
    expect(archival.endMessageId).toBe(requireValue(messages[19]).id);
    expect(archival.sourceFoldIds).toEqual(['fold-t2-0', 'fold-t2-1']);

    // Check retrieval by tier
    expect(store.getFolds(chatId, 3)).toHaveLength(1);
    expect(store.getPendingTier2Folds(chatId, 5)).toHaveLength(0); // Both coalesced into tier 3!
  });

  test('buildFoldContext renders Tier-3 Archival history and supersedes older coalesced folds', () => {
    const store = createStore();
    const messages = addMessages(store, 10);

    const t1SliceA = messages.slice(0, 5).map(m => m.id);
    const t1FoldA: ConversationFold = {
      id: 'fa', chatId, tier: 1, topic: 'Topic One', summary: 'Brief session first part',
      startMessageId: requireValue(t1SliceA[0]), endMessageId: requireValue(t1SliceA.at(-1)),
      directMessageIds: t1SliceA, sourceFoldIds: [], messageCount: 5, factsExtracted: [], createdAt: epoch
    };
    const t1SliceB = messages.slice(5, 10).map(m => m.id);
    const t1FoldB: ConversationFold = {
      id: 'fb', chatId, tier: 1, topic: 'Topic Two', summary: 'Brief session second part',
      startMessageId: requireValue(t1SliceB[0]), endMessageId: requireValue(t1SliceB.at(-1)),
      directMessageIds: t1SliceB, sourceFoldIds: [], messageCount: 5, factsExtracted: [], createdAt: epoch + 1000
    };
    store.saveFold(t1FoldA);
    store.saveFold(t1FoldB);

    const t2Slice = [...t1SliceA, ...t1SliceB];
    const t2FoldA: ConversationFold = {
      id: 't2-a', chatId, tier: 2, topic: 'Milestone Alpha', summary: 'Coalesced milestone Alpha details',
      startMessageId: requireValue(t2Slice[0]), endMessageId: requireValue(t2Slice.at(-1)),
      directMessageIds: t2Slice, sourceFoldIds: ['fa', 'fb'], messageCount: 10, factsExtracted: [], createdAt: epoch + 2000
    };
    store.saveFold(t2FoldA);

    // Context should only show Milestone Alpha, since Sessions A & B are coalesced into it
    const promptContext = buildFoldContext(store, chatId);
    expect(promptContext).toContain('Milestone Alpha');
    expect(promptContext).not.toContain('Brief session first part');
    expect(promptContext).not.toContain('Brief session second part');
  });

  test('decompress-on-demand expands local window (±2 messages) when an archived message is quoted', () => {
    const store = createStore();
    const messages = addMessages(store, 10);

    const t1Slice = messages.map(m => m.id);
    const t1Fold: ConversationFold = {
      id: 'fold-target', chatId, tier: 1, topic: 'Specific Order Quotation',
      summary: 'Agreed on price for order items',
      startMessageId: requireValue(t1Slice[0]), endMessageId: requireValue(t1Slice.at(-1)),
      directMessageIds: t1Slice, sourceFoldIds: [], messageCount: 10, factsExtracted: [], createdAt: epoch
    };
    store.saveFold(t1Fold);

    // When message 5 is quoted, buildFoldContext should automatically decompress messages 3..7
    const promptWithQuote = buildFoldContext(store, chatId, requireValue(messages[5]).id);
    expect(promptWithQuote).toContain('Specific Order Quotation');
    expect(promptWithQuote).toContain('السياق التفصيلي للرسالة المقتبسة من الأرشيف');
    expect(promptWithQuote).toContain('Historical transaction statement item 5');
    expect(promptWithQuote).toContain('Historical transaction statement item 4');
  });

  test('exposes context-status and fold operations via MCP server and REST API', async () => {
    const store = createStore();
    addMessages(store, 15);

    const mockAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), store, {
      persona: { model: 'gemini-4-argon' },
      contextFoldEngine: new ContextFoldEngine({
        memoryStore: store,
        summarizer: async () => ({ topic: 'Auto', summary: 'Auto sum', factsExtracted: [] })
      })
    });

    // 1. MCP Tools
    const mcp = createWhatsAppMcpServer({
      memoryStore: store,
      whatsappClient: new WhatsAppSocketClient(),
      moderatorAgent: mockAgent
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    const client = new Client({ name: 'test-mcp-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const statusRes = await client.callTool({
        name: 'whatsapp_get_context_status',
        arguments: { chatId }
      });
      const content: unknown = Array.isArray(statusRes.content) ? statusRes.content[0] : undefined;
      if (typeof content !== 'object' || content === null || !('type' in content) ||
          content.type !== 'text' || !('text' in content) || typeof content.text !== 'string') {
        throw new Error('Expected MCP text content');
      }
      expect(content.text).toContain('targetContextBudget');
      expect(content.text).toContain('gemini-4-argon');
    } finally {
      await client.close();
      await mcp.close();
    }

    // 2. REST API
    const sse = new SSEBroadcaster();
    const app = createApiServer({
      memoryStore: store,
      moderatorAgent: mockAgent,
      sse
    });

    // GET /api/chats/:id/context-status
    const reqStatus = new Request(`http://localhost/api/chats/${encodeURIComponent(chatId)}/context-status`);
    const resStatus = await app.fetch(reqStatus);
    expect(resStatus.status).toBe(200);
    const jsonStatus: unknown = await resStatus.json();
    expect(jsonStatus).toMatchObject({ status: { chatId, model: 'gemini-4-argon' } });

    // GET /api/chats/:id/memory-search
    const reqSearch = new Request(`http://localhost/api/chats/${encodeURIComponent(chatId)}/memory-search?query=transaction`);
    const resSearch = await app.fetch(reqSearch);
    expect(resSearch.status).toBe(200);
    const jsonSearch: unknown = await resSearch.json();
    if (typeof jsonSearch !== 'object' || jsonSearch === null || !('results' in jsonSearch) ||
        typeof jsonSearch.results !== 'object' || jsonSearch.results === null ||
        !('messages' in jsonSearch.results) || !Array.isArray(jsonSearch.results.messages)) {
      throw new Error('Expected memory search messages');
    }
    expect(jsonSearch.results.messages.length).toBeGreaterThan(0);
  });
});
