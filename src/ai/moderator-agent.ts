import { evaluatePermission } from '../domain/permission-engine';
import { HumanRateLimiter } from '../domain/rate-limiter';
import type { MemoryStore } from '../domain/memory-store';
import type { AgentDecision, AgentDraft, AutonomyAction, ChatMessage, ModeratorPersona, PolicyConfig } from '../domain/types';
import type { GeminiClient } from './gemini-client';
import { formatWhatsAppMessage } from '../domain/whatsapp-formatter';
import { executeWithModelFallback, parseModelChain } from './model-fallback';
import { formatMemoriesForPrompt } from '../domain/user-memory';
import { detectConversationStyle, getStylePromptDirective, isExplicitStyleRequest, type ConversationStyle } from './adaptive-style';
import type { DualMemoryManager } from '../domain/learning-memory';

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
6. يمكنك اقتراح إيموجي خفيف مناسب لطبيعة الكلام (مثل: 🙏, 👍, 😊) لجعل المحادثة دافئة وطبيعية.
7. أنت تمتلك ميزة تسجيل وإرسال رسائل صوتية حقيقية (Voice Notes / PTT)! إذا طلب المتصل فويس نوت (مثل: "ابعتلي فويس"، "اشرحلي بفويس نوت"، "سجل فويس")، أو أردت إرسال رد صوتي دافئ، اختر الأكشن "reply" واجعل sendAsVoiceNote: true. لا تحول الطلب إلى draft لمجرد أنه طلب فويس نوت لأن النظام يسجله ويبعثه تلقائياً كفويس نوت حقيقي!`,
  rules: [
    'عدم إعطاء وعود مالية أو خصومات بدون مراجعة',
    'الترحيب الودود في بداية المحادثات',
    'التحدث باختصار ووضوح كإنسان طبيعي'
  ],
  model: process.env.GEMINI_MODEL || 'gemini-4-argon',
  temperature: 0.7,
  minConfidence: 0.8,
  simulateTypingDelay: true,
  minTypingDelayMs: 2000,
  maxTypingDelayMs: 5000,
  voiceName: 'kore'
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
  private dualMemoryManager?: DualMemoryManager;

  constructor(
    private gemini: GeminiClient,
    private memoryStore: MemoryStore,
    options: {
      persona?: Partial<ModeratorPersona>;
      policy?: Partial<PolicyConfig>;
      rateLimiter?: HumanRateLimiter;
      dualMemoryManager?: DualMemoryManager;
    } = {}
  ) {
    this.persona = { ...DEFAULT_MODERATOR_PERSONA, ...options.persona };
    this.policy = { ...DEFAULT_POLICY_CONFIG, ...options.policy };
    this.rateLimiter = options.rateLimiter ?? new HumanRateLimiter({
      minDelayMs: this.persona.minTypingDelayMs,
      maxDelayMs: this.persona.maxTypingDelayMs
    });
    this.dualMemoryManager = options.dualMemoryManager;
  }

  getDualMemoryManager(): DualMemoryManager | undefined {
    return this.dualMemoryManager;
  }

  setDualMemoryManager(manager: DualMemoryManager): void {
    this.dualMemoryManager = manager;
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
  async processInboundMessage(message: ChatMessage, options: { dryRun?: boolean } = {}): Promise<{
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

    let quotedContextPrompt = '';
    if (message.quotedMessage) {
      quotedContextPrompt = `\n📌 تنبيه وسياق محوري (الرد بالسحب / Reply):
قام المستخدم بعمل Reply مخصص على الرسالة التالية:
- صاحب الرسالة المقتبسة: ${message.quotedMessage.senderName || 'صاحب الحساب'}
- نص الرسالة المقتبسة: "${message.quotedMessage.text}"
(ملاحظة مهمة: كلام المستخدم الحالي هو تعليق أو إجابة مباشرة على محتوى هذه الرسالة المقتبسة بعينها! خذ هذا السياق في عين الاعتبار أثناء صياغة الرد).\n`;
    } else if (message.replyToId) {
      const referenced = this.memoryStore.getMessage(message.chatId, message.replyToId);
      if (referenced) {
        quotedContextPrompt = `\n📌 تنبيه وسياق محوري (الرد بالسحب / Reply):
قام المستخدم بعمل Reply مخصص على الرسالة التالية:
- صاحب الرسالة المقتبسة: ${referenced.isFromMe ? 'أنا (صاحب الحساب/الموديرتور)' : (referenced.senderName || 'الطرف الآخر')}
- نص الرسالة المقتبسة: "${referenced.text}"
(ملاحظة مهمة: كلام المستخدم الحالي هو تعليق أو إجابة مباشرة على محتوى هذه الرسالة المقتبسة بعينها! خذ هذا السياق في عين الاعتبار أثناء صياغة الرد).\n`;
      }
    }

    // Fetch contact dossier if available for long-term episodic memory
    const dossier = this.memoryStore.getDossier(message.chatId);
    let dossierPrompt = '';
    if (dossier) {
      const factsList = dossier.facts?.length
        ? dossier.facts.map((f) => `- ${f}`).join('\n')
        : 'لا توجد حقائق مسجلة بعد';
      const commitmentsList = dossier.commitments?.length
        ? dossier.commitments.map((c) => `- ${c}`).join('\n')
        : 'لا توجد التزامات معلقة';
      dossierPrompt = `\n📌 ملف جهة الاتصال والذاكرة التراكمية (Contact Dossier):
- المرحلة الحالية: ${dossier.stage || 'lead'}
- حقائق سابقة معروفة عن الشخص:
${factsList}
- وعود والتزامات سابقة:
${commitmentsList}\n`;
    }

    // Fetch contact explicit memories
    const explicitMemories = this.memoryStore.getContactMemories('default', message.chatId);
    const memoryContext = formatMemoriesForPrompt(explicitMemories);
    const memoryPrompt = memoryContext ? `\n📌 ${memoryContext}\n` : '';

    // Detect or update conversation style
    const inboundText = message.text || message.transcription || '';
    const detectedStyle = detectConversationStyle(inboundText);
    if (!options.dryRun && isExplicitStyleRequest(inboundText)) {
      this.memoryStore.setChatStyle(message.chatId, detectedStyle);
    }
    const activeStyle = (this.memoryStore.getChatStyle(message.chatId) as ConversationStyle) || detectedStyle;
    const styleDirective = getStylePromptDirective(activeStyle);

    let notebookPrompt = '';
    let workbookRulesPrompt = '';
    if (this.dualMemoryManager) {
      const nbContext = this.dualMemoryManager.getActiveContextForPrompt(message.chatId);
      if (nbContext) {
        notebookPrompt = `\n📌 الذاكرة التراكمية وسياق الدفتر (Notebook Context):\n${nbContext}\n`;
      }
      const wbRules = this.dualMemoryManager.getActiveRulesForPrompt();
      if (wbRules) {
        workbookRulesPrompt = `\n\n=== قواعد وإرشادات التعلم التراكمي (Workbook Rules & Guardrails) ===\n${wbRules}`;
      }
    }

    const prompt = `سياق المحادثة السابقة بين الطرفين:
${historyText}
${quotedContextPrompt}
${dossierPrompt}
${memoryPrompt}
${notebookPrompt}
الرسالة الجديدة الواردة الآن:
من: ${message.senderName || message.sender}
نص الرسالة: ${message.text || message.transcription || `[${message.type}]`}

المطلوب منك:
حلل الرسالة كإنسان موديرتور، وحدد النية (intent)، ومستوى الثقة، والرد الطبيعي المناسب جداً بالسياق.
واستخرج أي حقائق جديدة أو التزامات ذكرها الطرفان لتحديث ملف جهة الاتصال التراكمي.

اختر الأكشن من بين:
- "reply": للرد التلقائي المباشر على الرسالة.
- "draft": إذا كانت الرسالة تحتاج مراجعة أو موافقة من صاحب الحساب أولاً.
- "human": لتسليم المحادثة لصاحب الحساب تماماً دون رد.
- "ignore": للرسائل الترويجية المزعجة (spam) أو الرسائل الآلية.

أرجع النتيجة بصيغة JSON فقط:
{
  "action": "reply | draft | human | ignore",
  "intent": "greeting | general_faq | casual_chat | sensitive_inquiry | spam | other",
  "replyText": "الرد البشري الطبيعي الذي سيتم إرساله أو تسجيله صوتياً",
  "sendAsVoiceNote": false, // اجعلها true إذا طلب المتصل رسالة صوتية/فويس نوت صراحة
  "reasoning": "سبب اختيار هذا الرد والتصرف في جملة واحدة",
  "confidence": 0.95,
  "suggestedReaction": "إيموجي اختياري أو اتركه فارغ",
  "extractedFacts": ["أي معلومة جديدة مفيدة عن الشخص أو متطلباته، مثل: ميزانيته، طبيعة عمله"],
  "extractedCommitments": ["أي وعد أو التزام قدمه أحد الطرفين، مثل: وعدته بالتواصل غداً"],
  "contactStage": "lead | qualified | negotiation | customer | vip"
}`;

    const systemInstruction = `${this.persona.systemPrompt}\nالنبرة المطلوبة: ${this.persona.tone}\n${styleDirective}\nالقواعد:\n${this.persona.rules.map((r) => `- ${r}`).join('\n')}${workbookRulesPrompt}`;

    let parsedDecision: AgentDecision;

    try {
      const fallbackModels = parseModelChain(
        this.persona.model || 'gemini-2.5-flash',
        process.env.GEMINI_FALLBACK_MODELS,
        'gemini-2.5-flash,gemini-2.5-pro,gemini-2.0-flash'
      );

      const fallbackRes = await executeWithModelFallback(fallbackModels, async (model) => {
        return await this.gemini.generateContent(
          [{ role: 'user', parts: [{ text: prompt }] }],
          {
            model,
            temperature: this.persona.temperature,
            systemInstruction,
            responseMimeType: 'application/json'
          }
        );
      });

      const response = fallbackRes.result;
      const json = JSON.parse(response.text);

      // Apply WhatsApp native markdown formatting to reply
      if (json.replyText) {
        json.replyText = formatWhatsAppMessage(json.replyText);
      }

      const simulatedDelay = this.persona.simulateTypingDelay
        ? this.rateLimiter.calculateTypingDelay(json.replyText || '')
        : 500;

      parsedDecision = {
        action: json.action || 'reply',
        intent: json.intent || 'general_faq',
        replyText: json.replyText,
        sendAsVoiceNote: Boolean(json.sendAsVoiceNote),
        reasoning: json.reasoning || 'Automated moderation evaluation',
        confidence: Number(json.confidence ?? 0.85),
        simulatedDelayMs: simulatedDelay,
        suggestedReaction: json.suggestedReaction,
        extractedFacts: Array.isArray(json.extractedFacts) ? json.extractedFacts : undefined,
        extractedCommitments: Array.isArray(json.extractedCommitments) ? json.extractedCommitments : undefined,
        contactStage: json.contactStage
      };

      // Persist newly discovered facts into the Contact Dossier
      if (!options.dryRun && Array.isArray(json.extractedFacts)) {
        for (const fact of json.extractedFacts) {
          if (typeof fact === 'string' && fact.trim()) {
            this.memoryStore.addFactToDossier(message.chatId, fact.trim());
          }
        }
      }

      // Persist newly extracted commitments into the Contact Dossier
      if (!options.dryRun && Array.isArray(json.extractedCommitments)) {
        for (const comm of json.extractedCommitments) {
          if (typeof comm === 'string' && comm.trim()) {
            this.memoryStore.addCommitmentToDossier(message.chatId, comm.trim());
          }
        }
      }

      // Update stage if recognized
      if (!options.dryRun && json.contactStage) {
        const existingDossier = this.memoryStore.getDossier(message.chatId);
        if (existingDossier) {
          existingDossier.stage = json.contactStage;
          existingDossier.updatedAt = Date.now();
          this.memoryStore.saveDossier(existingDossier);
        }
      }
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
        sendAsVoiceNote: parsedDecision.sendAsVoiceNote,
        reasoning: parsedDecision.reasoning,
        confidence: parsedDecision.confidence,
        status: 'pending',
        createdAt: Date.now()
      };
      if (!options.dryRun) this.memoryStore.saveDraft(draftCreated);
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
