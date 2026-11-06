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

  it('incorporates swiped/quoted message context into reasoning prompt', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-memory-4' });
    let capturedPrompt = '';

    const mockGemini: any = {
      generateContent: async (contents: any) => {
        capturedPrompt = JSON.stringify(contents);
        return {
          text: JSON.stringify({
            action: 'reply',
            intent: 'product_inquiry',
            replyText: 'الباقة بتشمل إدارة كاملة لحسابات السوشيال ميديا مع الرد الآلي والمتابعة.',
            confidence: 0.96
          })
        };
      }
    };

    const agent = new ModeratorAgent(mockGemini, memory);
    const swipedIncoming: ChatMessage = {
      id: 'msg_swipe_1',
      chatId: 'contact4@s.whatsapp.net',
      sender: 'contact4@s.whatsapp.net',
      senderName: 'محمد',
      text: 'ممكن تفاصيل أكتر عنها؟',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text',
      quotedMessage: {
        id: 'msg_original_1',
        sender: 'me',
        senderName: 'أنت',
        text: 'باقة البريميوم بـ 1500 جنيه شهرياً',
        type: 'text'
      }
    };

    const result = await agent.processInboundMessage(swipedIncoming);
    expect(result.decision.action).toBe('reply');
    expect(capturedPrompt).toContain('📌 تنبيه وسياق محوري (الرد بالسحب / Reply)');
    expect(capturedPrompt).toContain('باقة البريميوم بـ 1500 جنيه شهرياً');
    expect(capturedPrompt).toContain('ممكن تفاصيل أكتر عنها؟');
  });

  it('extracts facts and commitments into contact dossier and recalls them in subsequent turns', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    let capturedPrompt = '';

    const mockGemini: any = {
      generateContent: async (contents: any) => {
        capturedPrompt = JSON.stringify(contents);
        return {
          text: JSON.stringify({
            action: 'reply',
            intent: 'business_consultation',
            replyText: 'أهلاً بك يا فندم، يشرفنا التعامل معك',
            confidence: 0.94,
            extractedFacts: ['يعمل مدير تسويق في شركة النور', 'الميزانية المتاحة 10 آلاف دولار'],
            extractedCommitments: ['وعدته بإرسال بروفايل الشركة غداً'],
            contactStage: 'qualified'
          })
        };
      }
    };

    const agent = new ModeratorAgent(mockGemini, memory);
    const incoming: ChatMessage = {
      id: 'msg_dossier_1',
      chatId: 'lead100@s.whatsapp.net',
      sender: 'lead100@s.whatsapp.net',
      senderName: 'كريم',
      text: 'أنا مدير التسويق في شركة النور وميزانيتنا 10 آلاف دولار',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const turn1 = await agent.processInboundMessage(incoming);
    expect(turn1.decision.action).toBe('reply');
    expect(turn1.decision.extractedFacts).toHaveLength(2);
    expect(turn1.decision.contactStage).toBe('qualified');

    // Verify written to SQLite dossier
    const dossier = memory.getDossier('lead100@s.whatsapp.net');
    expect(dossier).toBeDefined();
    expect(dossier?.facts).toContain('يعمل مدير تسويق في شركة النور');
    expect(dossier?.commitments).toContain('وعدته بإرسال بروفايل الشركة غداً');
    expect(dossier?.stage).toBe('qualified');

    // Turn 2: verify dossier is recalled in prompt
    const incoming2: ChatMessage = {
      id: 'msg_dossier_2',
      chatId: 'lead100@s.whatsapp.net',
      sender: 'lead100@s.whatsapp.net',
      senderName: 'كريم',
      text: 'في انتظار البروفايل',
      timestamp: Date.now() + 1000,
      isFromMe: false,
      type: 'text'
    };

    await agent.processInboundMessage(incoming2);
    expect(capturedPrompt).toContain('ملف جهة الاتصال والذاكرة التراكمية');
    expect(capturedPrompt).toContain('يعمل مدير تسويق في شركة النور');
    expect(capturedPrompt).toContain('وعدته بإرسال بروفايل الشركة غداً');
  });
});
