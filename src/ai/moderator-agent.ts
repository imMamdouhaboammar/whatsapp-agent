import { evaluatePermission } from '../domain/permission-engine';
import { HumanRateLimiter } from '../domain/rate-limiter';
import type { MemoryStore } from '../domain/memory-store';
import type { AgentDecision, AgentDraft, AutonomyAction, ChatMessage, ModeratorPersona, PolicyConfig } from '../domain/types';
import type { GeminiClient } from './gemini-client';

export const DEFAULT_MODERATOR_PERSONA: ModeratorPersona = {
  name: 'ممدوح (الموديرتور الذكي)',
  language: 'ar-EG',
  tone: 'طبيعي جداً، بشوش، محترف، باللهجة المصرية الراقية بدون أي تكلف أو تصنع كأنك صاحب الشات تماماً',
  systemPrompt: `أنت الموديرتور المسؤول عن الرد على رسائل الواتساب نيابة عن صاحب الحساب.
مهمتك الرد على جهات الاتصال بطريقة بشرية 100% كأن صاحب الحساب هو من يكتب بنفسه.

القواعد الأساسية:
1. لا تذكر إطلاقاً أنك ذكاء اصطناعي أو بوت أو روبوت أو نظام آلي.
2. اكتب بلغة عامية مصرية طبيعية وسلسة وودودة، واستخدم أسلوب التحدث اليومي على واتساب (جمل قصيرة ومباشرة، بدون رغي أو مقالات طويلة).
3. تفاعل مع السياق السابق للحديث وافهم قصد المتصل بدقة.
4. إذا سأل المتصل عن أمر حساس أو مالي أو طلب قرار مصيري لا تعرفه، اختر الأكشن "draft" أو "human" ليراجعه صاحب الحساب.
5. لا تتجاهل رسائل العملاء أو الأصدقاء، بل رد بما يفيد ويسهل التعامل.
6. يمكنك اقتراح إيموجي خفيف مناسب لطبيعة الكلام (مثل: 🙏, 👍, 😊) لجعل المحادثة دافئة وطبيعية.`,
  rules: [
    'عدم إعطاء وعود مالية أو خصومات بدون مراجعة',
    'الترحيب الودود في بداية المحادثات',
    'التحدث باختصار ووضوح كإنسان طبيعي'
  ],
  model: 'gemini-2.5-flash',
  temperature: 0.7,
  minConfidence: 0.8,
  simulateTypingDelay: true,
  minTypingDelayMs: 2000,
  maxTypingDelayMs: 5000
};

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  version: 1,
  defaultAction: 'reply',
  minConfidence: 0.75,
  rules: [
    { id: 'greeting', intent: 'greeting', effect: 'allow', action: 'reply' },
    { id: 'general_faq', intent: 'general_faq', effect: 'allow', action: 'reply' },
    { id: 'casual_chat', intent: 'casual_chat', effect: 'allow', action: 'reply' },
    { id: 'financial_transaction', intent: 'financial_transaction', effect: 'require_approval', action: 'draft' },
    { id: 'sensitive_inquiry', intent: 'sensitive_inquiry', effect: 'require_approval', action: 'draft' },
    { id: 'spam', intent: 'spam', effect: 'deny', action: 'ignore' }
  ]
};

export class ModeratorAgent {
  private persona: ModeratorPersona;
  private policy: PolicyConfig;
  private rateLimiter: HumanRateLimiter;

  constructor(
    private gemini: GeminiClient,
    private memoryStore: MemoryStore,
    options: {
      persona?: Partial<ModeratorPersona>;
      policy?: Partial<PolicyConfig>;
      rateLimiter?: HumanRateLimiter;
    } = {}
  ) {
    this.persona = { ...DEFAULT_MODERATOR_PERSONA, ...options.persona };
    this.policy = { ...DEFAULT_POLICY_CONFIG, ...options.policy };
    this.rateLimiter = options.rateLimiter ?? new HumanRateLimiter({
      minDelayMs: this.persona.minTypingDelayMs,
      maxDelayMs: this.persona.maxTypingDelayMs
    });
  }

  getPersona(): ModeratorPersona {
    return { ...this.persona };
  }

  updatePersona(updates: Partial<ModeratorPersona>) {
    this.persona = { ...this.persona, ...updates };
  }

  getPolicy(): PolicyConfig {
    return { ...this.policy };
  }

  updatePolicy(updates: Partial<PolicyConfig>) {
    this.policy = { ...this.policy, ...updates };
  }

  /**
   * Processes an incoming message and determines the agent's decision and reply
   */
  async processInboundMessage(message: ChatMessage): Promise<{
    decision: AgentDecision;
    draftCreated?: AgentDraft;
    shouldSendImmediately: boolean;
  }> {
    // 1. Fetch conversation history for context
    const history = this.memoryStore.getMessages(message.chatId, 10);
    const chatSummary = this.memoryStore.getChat(message.chatId);
    const agentMode = chatSummary?.agentMode ?? 'autopilot';

    // 2. Build Gemini prompt with history and persona
    const historyText = history
      .map((m) => {
        const sender = m.isFromMe ? 'أنا (صاحب الحساب/الموديرتور)' : `${m.senderName || 'الطرف الآخر'}`;
        const content = m.text || (m.transcription ? `[رسالة صوتية مفرغة: ${m.transcription}]` : `[${m.type}]`);
        return `${sender}: ${content}`;
      })
      .join('\n');

    const prompt = `سياق المحادثة السابقة بين الطرفين:\n${historyText}\n
الرسالة الجديدة الواردة الآن:
من: ${message.senderName || message.sender}
نص الرسالة: ${message.text || message.transcription || `[${message.type}]`}

المطلوب منك:
حلل الرسالة كإنسان موديرتور، وحدد النية (intent)، ومستوى الثقة، والرد الطبيعي المناسب جداً بالسياق.
اختر الأكشن من بين:
- "reply": للرد التلقائي المباشر على الرسالة.
- "draft": إذا كانت الرسالة تحتاج مراجعة أو موافقة من صاحب الحساب أولاً.
- "human": لتسليم المحادثة لصاحب الحساب تماماً دون رد.
- "ignore": للرسائل الترويجية المزعجة (spam) أو الرسائل الآلية.

أرجع النتيجة بصيغة JSON فقط:
{
  "action": "reply",
  "intent": "greeting | general_faq | casual_chat | sensitive_inquiry | spam | other",
  "replyText": "الرد البشري الطبيعي الذي سيتم إرساله",
  "reasoning": "سبب اختيار هذا الرد والتصرف في جملة واحدة",
  "confidence": 0.95,
  "suggestedReaction": "إيموجي اختياري أو اتركه فارغ"
}`;

    const systemInstruction = `${this.persona.systemPrompt}\nالنبرة المطلوبة: ${this.persona.tone}\nالقواعد:\n${this.persona.rules.map((r) => `- ${r}`).join('\n')}`;

    let parsedDecision: AgentDecision;

    try {
      const response = await this.gemini.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          model: this.persona.model,
          temperature: this.persona.temperature,
          systemInstruction,
          responseMimeType: 'application/json'
        }
      );

      const json = JSON.parse(response.text);
      const simulatedDelay = this.persona.simulateTypingDelay
        ? this.rateLimiter.calculateTypingDelay(json.replyText || '')
        : 500;

      parsedDecision = {
        action: json.action || 'reply',
        intent: json.intent || 'general_faq',
        replyText: json.replyText,
        reasoning: json.reasoning || 'Automated moderation evaluation',
        confidence: Number(json.confidence ?? 0.85),
        simulatedDelayMs: simulatedDelay,
        suggestedReaction: json.suggestedReaction
      };
    } catch (err: any) {
      parsedDecision = {
        action: 'human',
        intent: 'error_fallback',
        reasoning: `Model generation failed: ${err.message}`,
        confidence: 0,
        simulatedDelayMs: 0
      };
    }

    // 3. Evaluate through Deterministic Permission Policy
    const evalResult = evaluatePermission(this.policy, {
      intent: parsedDecision.intent,
      confidence: parsedDecision.confidence,
      requestedAction: parsedDecision.action
    });

    const finalAction: AutonomyAction = evalResult.action;
    parsedDecision.action = finalAction;

    // 4. Check Chat Agent Mode
    let shouldSendImmediately = false;
    let draftCreated: AgentDraft | undefined = undefined;

    if (agentMode === 'human') {
      shouldSendImmediately = false;
    } else if (agentMode === 'copilot' || finalAction === 'draft') {
      // Create draft awaiting human 1-click approval in the UI
      draftCreated = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        chatId: message.chatId,
        incomingMessageId: message.id,
        incomingText: message.text || message.transcription || '',
        proposedReply: parsedDecision.replyText || '',
        reasoning: parsedDecision.reasoning,
        confidence: parsedDecision.confidence,
        status: 'pending',
        createdAt: Date.now()
      };
      this.memoryStore.saveDraft(draftCreated);
      shouldSendImmediately = false;
    } else if (agentMode === 'autopilot' && finalAction === 'reply' && parsedDecision.replyText) {
      shouldSendImmediately = true;
    }

    return {
      decision: parsedDecision,
      draftCreated,
      shouldSendImmediately
    };
  }
}
