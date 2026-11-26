import { afterEach, test, expect } from 'bun:test';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage } from '../src/domain/types';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

const stores: MemoryStore[] = [];

function createTestMemory(): MemoryStore {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  stores.push(memory);
  return memory;
}

afterEach(() => {
  for (const memory of stores.splice(0)) memory.close();
});

test('preview returns a draft without persisting customer facts, commitments or drafts', async () => {
  const memory = createTestMemory();
  const gemini = new GeminiClient();
  gemini.generateContent = async () => ({ text: JSON.stringify({
    action: 'reply', intent: 'financial_transaction', replyText: 'هراجع العرض وأرد عليك',
    confidence: 0.97, extractedFacts: ['طلب 20 قطعة'],
    extractedCommitments: ['متابعة غدًا'], contactStage: 'negotiation'
  }) });
  const moderator = new ModeratorAgent(gemini, memory);
  const message = {
    id: 'test-1', chatId: 'preview@simulator.invalid', sender: 'tester',
    text: 'تقدر تعمل خصم؟', timestamp: Date.now(), type: 'text', isFromMe: false
  } as const;
  const result = await moderator.processInboundMessage(message, { dryRun: true });
  expect(result.decision.action).toBe('draft');
  expect(result.draftCreated?.proposedReply).toBe('هراجع العرض وأرد عليك');
  expect(memory.getDossier(message.chatId)).toBeUndefined();
  expect(memory.getPendingDrafts()).toEqual([]);
  expect(memory.listChats()).toEqual([]);
});

test('preview style requests never persist a temporary contact dossier', async () => {
  const memory = createTestMemory();
  const gemini = new GeminiClient();
  gemini.generateContent = async () => ({ text: JSON.stringify({
    action: 'reply', intent: 'general_faq', replyText: 'Understood', confidence: 0.98
  }) });
  const moderator = new ModeratorAgent(gemini, memory);
  const chatId = 'preview-style@simulator.invalid';
  await moderator.processInboundMessage({
    id: 'style-1', chatId, sender: 'tester',
    text: 'Please be professional', timestamp: Date.now(), type: 'text', isFromMe: false
  }, { dryRun: true });
  expect(memory.getChatStyle(chatId)).toBeUndefined();
  expect(memory.getDossier(chatId)).toBeUndefined();
});

test('preview HTTP request cannot write live chat, broadcast or send messages', async () => {
  let writes = 0, events = 0, sends = 0;
  const calls: Array<{ message: ChatMessage; options?: { dryRun?: boolean } }> = [];
  const memoryStore = createTestMemory();
  const whatsappClient = new WhatsAppSocketClient();
  const moderatorAgent = new ModeratorAgent(new GeminiClient(), memoryStore);
  const sse = new SSEBroadcaster();
  memoryStore.addMessage = (message) => {
    writes++;
    return message;
  };
  whatsappClient.sendMessage = async () => {
    sends++;
    return { messageId: 'sim' };
  };
  moderatorAgent.processInboundMessage = async (message, options) => {
    calls.push({ message, options });
    return {
      decision: { action: 'reply', intent: 'general_faq', replyText: 'أهلًا بيك', confidence: 1, reasoning: '', simulatedDelayMs: 0 },
      shouldSendImmediately: true
    };
  };
  sse.broadcast = () => { events++; };
  const app = createApiServer({ memoryStore, whatsappClient, moderatorAgent, sse });
  const response = await app.request('/api/simulate', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: 'actual@s.whatsapp.net', sender: 'real', text: 'أهلا' }) });
  expect(response.status).toBe(200);
  const [seen] = calls;
  if (!seen) throw new Error('Expected a simulator model call');
  expect(seen.message.chatId).toMatch(/@simulator\.invalid$/);
  expect(seen.options?.dryRun).toBe(true);
  expect([writes, events, sends]).toEqual([0, 0, 0]);
});

test('preview validates text and name length before calling the model', async () => {
  let calls = 0;
  const memoryStore = createTestMemory();
  const moderatorAgent = new ModeratorAgent(new GeminiClient(), memoryStore);
  moderatorAgent.processInboundMessage = async () => {
    calls++;
    throw new Error('Invalid preview input reached the moderator');
  };
  const app = createApiServer({ memoryStore, moderatorAgent, sse: new SSEBroadcaster() });
  for (const payload of [{ text: '' }, { text: 77 }, { text: '  ' },
    { text: 'x'.repeat(4001) }, { text: 'ok', senderName: 'x'.repeat(121) }]) {
    const res = await app.request('/api/simulate', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(400);
  }
  expect(calls).toBe(0);
});
