import { test, expect } from 'bun:test';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { createApiServer } from '../src/server/api';

test('preview returns a draft without persisting customer facts, commitments or drafts', async () => {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  try {
    const moderator = new ModeratorAgent({
      generateContent: async () => ({ text: JSON.stringify({
        action: 'reply', intent: 'financial_transaction', replyText: 'هراجع العرض وأرد عليك',
        confidence: 0.97, extractedFacts: ['طلب 20 قطعة'],
        extractedCommitments: ['متابعة غدًا'], contactStage: 'negotiation'
      }) })
    } as any, memory);
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
  } finally { memory.close(); }
});

test('preview style requests never persist a temporary contact dossier', async () => {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  try {
    const moderator = new ModeratorAgent({
      generateContent: async () => ({ text: JSON.stringify({
        action: 'reply', intent: 'general_faq', replyText: 'Understood', confidence: 0.98
      }) })
    } as any, memory);
    const chatId = 'preview-style@simulator.invalid';
    await moderator.processInboundMessage({
      id: 'style-1', chatId, sender: 'tester',
      text: 'Please be professional', timestamp: Date.now(), type: 'text', isFromMe: false
    }, { dryRun: true });
    expect(memory.getChatStyle(chatId)).toBeUndefined();
    expect(memory.getDossier(chatId)).toBeUndefined();
  } finally { memory.close(); }
});

test('preview HTTP request cannot write live chat, broadcast or send messages', async () => {
  let writes = 0, events = 0, sends = 0;
  let seen: any;
  const app = createApiServer({
    memoryStore: { addMessage: () => { writes++; } } as any,
    whatsappClient: { sendMessage: async () => { sends++; } } as any,
    moderatorAgent: { processInboundMessage: async (message: any, options: any) => {
      seen = { message, options };
      return { decision: { action: 'reply', replyText: 'أهلًا بيك' }, shouldSendImmediately: true };
    } } as any,
    sse: { broadcast: () => { events++; } } as any
  });
  const response = await app.request('/api/simulate', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: 'actual@s.whatsapp.net', sender: 'real', text: 'أهلا' }) });
  expect(response.status).toBe(200);
  expect(seen.message.chatId).toMatch(/@simulator\.invalid$/);
  expect(seen.options.dryRun).toBe(true);
  expect([writes, events, sends]).toEqual([0, 0, 0]);
});

test('preview validates text and name length before calling the model', async () => {
  let calls = 0;
  const app = createApiServer({
    memoryStore: {} as any, whatsappClient: {} as any,
    moderatorAgent: { processInboundMessage: async () => {
      calls++;
      return { decision: { action: 'reply' }, shouldSendImmediately: true };
    } } as any,
    sse: {} as any
  });
  for (const payload of [{ text: '' }, { text: 77 }, { text: '  ' },
    { text: 'x'.repeat(4001) }, { text: 'ok', senderName: 'x'.repeat(121) }]) {
    const res = await app.request('/api/simulate', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(400);
  }
  expect(calls).toBe(0);
});
