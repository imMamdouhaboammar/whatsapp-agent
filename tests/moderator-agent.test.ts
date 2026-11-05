import { describe, expect, it } from 'bun:test';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage } from '../src/domain/types';

describe('ModeratorAgent', () => {
  it('automatically replies in autopilot mode for casual greeting', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-memory-1' });
    const mockGemini: any = {
      generateContent: async () => ({
        text: JSON.stringify({
          action: 'reply',
          intent: 'greeting',
          replyText: 'أهلاً يا صديقي! إزيك؟',
          reasoning: 'Warm greeting',
          confidence: 0.95,
          suggestedReaction: '👋'
        })
      })
    };

    const agent = new ModeratorAgent(mockGemini, memory);
    const incoming: ChatMessage = {
      id: 'msg_1',
      chatId: 'contact1@s.whatsapp.net',
      sender: 'contact1@s.whatsapp.net',
      senderName: 'أحمد',
      text: 'السلام عليكم يا ممدوح',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(incoming);
    expect(result.decision.action).toBe('reply');
    expect(result.shouldSendImmediately).toBe(true);
    expect(result.decision.replyText).toBe('أهلاً يا صديقي! إزيك؟');
    expect(result.decision.suggestedReaction).toBe('👋');
  });

  it('generates a draft when intent is sensitive or requires approval', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-memory-2' });
    const mockGemini: any = {
      generateContent: async () => ({
        text: JSON.stringify({
          action: 'reply',
          intent: 'financial_transaction',
          replyText: 'تمام هحولك الفلوس حالاً',
          reasoning: 'Payment request',
          confidence: 0.92
        })
      })
    };

    const agent = new ModeratorAgent(mockGemini, memory);
    const incoming: ChatMessage = {
      id: 'msg_2',
      chatId: 'contact2@s.whatsapp.net',
      sender: 'contact2@s.whatsapp.net',
      text: 'ممكن تحولي 500 جنيه على فودافون كاش؟',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(incoming);
    expect(result.decision.action).toBe('draft');
    expect(result.shouldSendImmediately).toBe(false);
    expect(result.draftCreated).toBeDefined();
    expect(result.draftCreated?.status).toBe('pending');
  });

  it('respects copilot mode and creates a draft for manual approval', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-memory-3' });
    memory.setChatMode('contact3@s.whatsapp.net', 'copilot');

    const mockGemini: any = {
      generateContent: async () => ({
        text: JSON.stringify({
          action: 'reply',
          intent: 'greeting',
          replyText: 'صباح الورد والياسمين',
          confidence: 0.98
        })
      })
    };

    const agent = new ModeratorAgent(mockGemini, memory);
    const incoming: ChatMessage = {
      id: 'msg_3',
      chatId: 'contact3@s.whatsapp.net',
      sender: 'contact3@s.whatsapp.net',
      text: 'صباح الخير',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(incoming);
    expect(result.shouldSendImmediately).toBe(false);
    expect(result.draftCreated).toBeDefined();
    expect(result.draftCreated?.chatId).toBe('contact3@s.whatsapp.net');
  });
});
