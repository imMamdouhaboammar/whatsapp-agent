import { isRecord, isStringArray } from './response-validation';
import { evaluatePermission } from '../domain/permission-engine';
import { HumanRateLimiter } from '../domain/rate-limiter';
import type { MemoryStore } from '../domain/memory-store';
import type { AgentDecision, AgentDraft, AutonomyAction, ChatMessage, ModeratorPersona, PolicyConfig } from '../domain/types';
import type { GeminiClient } from './gemini-client';
import { formatWhatsAppMessage } from '../domain/whatsapp-formatter';
import { executeWithModelFallback } from './model-fallback';
import { orchestrateModel, toRoutingTrace } from './model-orchestrator';
import { formatMemoriesForPrompt } from '../domain/user-memory';
import { detectConversationStyle, getStylePromptDirective, isExplicitStyleRequest } from './adaptive-style';
import type { DualMemoryManager } from '../domain/learning-memory';
import { ContextFoldEngine } from '../domain/context-fold-engine';
import { buildFoldContext } from '../domain/context-fold-prompt';
import { crushMessageForPrompt } from '../domain/content-cached-retrieval';
import { createGeminiFoldSummarizer } from './fold-summarizer';
import { routeTurnModel, type RoutingDecision, type JevRouteRequest } from './model-router';
import type { JepaWorldModel } from './jepa-world-model';
import { DignityGuardian } from './dignity-guardian';
import { extractDynamicsInput, planConversation, compileDynamicsPrompt } from './conversation-dynamics';
import { compileHumanRealismLayer } from './human-realism';
import { evaluateSpontaneousReaction } from '../domain/whatsapp-rhythm';
import type { McpClientManager } from '../mcp/client-manager';
import { executeGeminiToolLoop } from '../mcp/gemini-tool-adapter';
import {
  auditTemporalAnswer,
  buildTemporalEnvelope,
  clockTruth,
  formatEnvelopeForAgent,
  formatRelativeAge
} from './temporal-guard';

export const DEFAULT_MODERATOR_PERSONA: ModeratorPersona = {
  name: 'ممدوح (الموديرتور الذكي)',
  language: 'ar-EG',
  tone: 'طبيعي جداً، بشوش، محترف، باللهجة المصرية الراقية بدون أي تكلف أو تصنع كأنك صاحب الشات تماماً',
  systemPrompt: `أنت الموديرتور المسؤول عن الرد على رسائل الواتساب نيابة عن صاحب الحساب.
مهمتك الرد على جهات الاتصال بطريقة بشرية 100% كأن صاحب الحساب هو من يكتب بنفسه.

القواعد الأساسية:
1. لا تذكر إطلاقاً أنك ذكاء اصطناعي أو بوت أو روبوت أو نظام آلي.
2. اكتب بلغة عامية مصرية طبيعية وسلسة وودودة، واستخدم أسلوب التحدث اليومي على واتساب (جمل قصيرة ومباشرة، بدون رغي أو مقالات طويلة، ويمكنك تقسيم الرد إلى فقاعات متتالية بالرمز "|||" لتبدو كرسائل واتساب متتالية واقعية).
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
  private contextFoldEngine?: ContextFoldEngine;
  private router: (input: JevRouteRequest) => Promise<RoutingDecision>;
  private worldModel?: JepaWorldModel;
  private dignityGuardian: DignityGuardian;
  private mcpClientManager?: McpClientManager;
  private brandId?: string;
  private now: () => number;
  private timezone: string;

  constructor(
    private gemini: Pick<GeminiClient, 'generateContent'>,
    private memoryStore: MemoryStore,
    options: {
      persona?: Partial<ModeratorPersona>;
      policy?: Partial<PolicyConfig>;
      rateLimiter?: HumanRateLimiter;
      dualMemoryManager?: DualMemoryManager;
      contextFoldEngine?: ContextFoldEngine;
      router?: (input: JevRouteRequest) => Promise<RoutingDecision>;
      worldModel?: JepaWorldModel;
      dignityGuardian?: DignityGuardian;
      mcpClientManager?: McpClientManager;
      brandId?: string;
      now?: () => number;
      timezone?: string;
    } = {}
  ) {
    this.persona = { ...DEFAULT_MODERATOR_PERSONA, ...options.persona };
    this.policy = { ...DEFAULT_POLICY_CONFIG, ...options.policy };
    this.rateLimiter = options.rateLimiter ?? new HumanRateLimiter({
      minDelayMs: this.persona.minTypingDelayMs,
      maxDelayMs: this.persona.maxTypingDelayMs
    });
    this.dualMemoryManager = options.dualMemoryManager;
    this.router = options.router ?? routeTurnModel;
    this.worldModel = options.worldModel;
    this.dignityGuardian = options.dignityGuardian ?? new DignityGuardian();
    this.mcpClientManager = options.mcpClientManager;
    this.brandId = options.brandId;
    this.now = options.now ?? Date.now;
    this.timezone = options.timezone ?? process.env.AGENT_TIMEZONE ?? 'system';
    this.contextFoldEngine = options.contextFoldEngine ?? (
      process.env.CONTEXT_FOLD_ENABLED === 'false' ? undefined :
        new ContextFoldEngine({
          memoryStore,
          summarizer: createGeminiFoldSummarizer(gemini, () => this.persona.model)
        })
    );
  }

  getContextFoldEngine(): ContextFoldEngine | undefined {
    return this.contextFoldEngine;
  }

  getDignityGuardian(): DignityGuardian {
    return this.dignityGuardian;
  }

  getDualMemoryManager(): DualMemoryManager | undefined {
    return this.dualMemoryManager;
  }

  setDualMemoryManager(manager: DualMemoryManager): void {
    this.dualMemoryManager = manager;
  }

  setMcpClientManager(manager: McpClientManager): void {
    this.mcpClientManager = manager;
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
    const inboundText = message.text || message.transcription || '';

    // 0. Boundary & Dignity Defense Check
    const dignityResult = this.dignityGuardian.evaluateTurn(message.chatId, inboundText);
    if (dignityResult.isBlocked) {
      return {
        decision: {
          action: 'ignore',
          intent: 'blocked_boundary',
          reasoning: 'Contact blocked due to dignity/boundary violation',
          confidence: 1,
          simulatedDelayMs: 0
        },
        shouldSendImmediately: false
      };
    }

    if (dignityResult.boundaryMessage) {
      return {
        decision: {
          action: 'reply',
          intent: 'boundary_enforcement',
          replyText: dignityResult.boundaryMessage,
          reasoning: `Dignity boundary warning triggered (${dignityResult.violationType ?? 'boundary'})`,
          confidence: 1,
          simulatedDelayMs: 1200
        },
        shouldSendImmediately: true
      };
    }

    // 1. Build authoritative temporal envelope + fetch conversation history
    const turnNowMs = this.now();
    const temporalEnvelope = buildTemporalEnvelope(inboundText, {
      now: turnNowMs,
      timezone: this.timezone
    });
    const temporalBlock = formatEnvelopeForAgent(temporalEnvelope);

    const referencedId = message.quotedMessage?.id || message.replyToId;
    const budgetStatus = this.contextFoldEngine?.getContextBudgetStatus(message.chatId, this.persona.model);
    const dynamicRecentCount = budgetStatus ? budgetStatus.preservedRecentCount : 10;
    const history = this.memoryStore.getMessages(message.chatId, dynamicRecentCount);
    const foldContext = buildFoldContext(this.memoryStore, message.chatId, referencedId);
    const chatSummary = this.memoryStore.getChat(message.chatId);
    const agentMode = chatSummary?.agentMode ?? 'autopilot';

    // 2. Build Gemini prompt with history and persona (applying CCR for oversized content)
    const historyText = history
      .map((m) => {
        const crushed = crushMessageForPrompt(m);
        const sender = m.isFromMe ? 'أنا (صاحب الحساب/الموديرتور)' : (m.senderName || 'الطرف الآخر');
        const content = crushed.transcription ? `[رسالة صوتية مفرغة: ${crushed.transcription}]` : (crushed.text || `[${m.type}]`);
        const msgClock = clockTruth({ now: m.timestamp, timezone: this.timezone });
        const ageLabel = formatRelativeAge(m.timestamp, turnNowMs);
        return `[${msgClock.local}, ${ageLabel}] ${sender}: ${content}`;
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
    const detectedStyle = detectConversationStyle(inboundText);
    if (!options.dryRun && isExplicitStyleRequest(inboundText)) {
      this.memoryStore.setChatStyle(message.chatId, detectedStyle);
    }
    const storedStyle = this.memoryStore.getChatStyle(message.chatId);
    const activeStyle = storedStyle === 'professional' || storedStyle === 'casual' || storedStyle === 'playful' ||
      storedStyle === 'assertive' || storedStyle === 'empathetic' ? storedStyle : detectedStyle;
    const styleDirective = getStylePromptDirective(activeStyle);

    let notebookPrompt = '';
    let workbookRulesPrompt = '';
    if (this.dualMemoryManager) {
      const nbContext = this.dualMemoryManager.getActiveContextForPrompt(message.chatId);
      if (nbContext) {
        notebookPrompt = `\n📌 الذاكرة التراكمية وسياق الدفتر (Notebook Context):\n${nbContext}\n`;
      }
      const wbRules = this.dualMemoryManager.getActiveRulesForPrompt(inboundText, message.chatId);
      if (wbRules) {
        workbookRulesPrompt = `\n\n=== قواعد وإرشادات التعلم التراكمي (Workbook Rules & Guardrails) ===\n${wbRules}`;
      }
    }

    const isGroup = message.chatId.endsWith('@g.us');
    const dynamicsInput = extractDynamicsInput(inboundText, 1);
    const conversationPlan = planConversation(dynamicsInput);
    const dynamicsPrompt = compileDynamicsPrompt(conversationPlan);
    const humanRealismLayer = compileHumanRealismLayer({
      personaName: this.persona.name,
      isGroup
    });

    const prompt = `${temporalBlock}

${foldContext ? `${foldContext}\n\n` : ''}سياق المحادثة السابقة بين الطرفين:\n${historyText}
${quotedContextPrompt}
${dossierPrompt}
${memoryPrompt}
${notebookPrompt}
${dynamicsPrompt}

الرسالة الجديدة الواردة الآن:
الوقت الحالي للرسالة: ${temporalEnvelope.localTime} (${temporalEnvelope.dayOfWeek})
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

    const systemInstruction = `${this.persona.systemPrompt}\nالنبرة المطلوبة: ${this.persona.tone}\n${styleDirective}\n\n${humanRealismLayer}\n\nالقواعد:\n${this.persona.rules.map((r) => `- ${r}`).join('\n')}${workbookRulesPrompt}`;

    let parsedDecision: AgentDecision;

    const externalTools = agentMode !== 'human' && this.mcpClientManager
      ? this.mcpClientManager.listAvailableTools(this.brandId)
      : [];

    // Route inbound turn with optional external Jev router, then orchestrate local model selection
    let jevDecision: RoutingDecision | undefined;
    try {
      const recentContext = history.slice(-3).map((m) => m.text || m.transcription || '').filter(Boolean);
      jevDecision = await this.router({
        message: inboundText,
        threadContext: recentContext,
        senderName: message.senderName || message.sender
      });
    } catch {
      jevDecision = undefined;
    }

    const orchestration = orchestrateModel({
      message,
      historyLength: history.length,
      personaModel: this.persona.model,
      hasExternalTools: externalTools.length > 0,
      jevDecision
    });

    const routing: RoutingDecision =
      jevDecision && !jevDecision.bypassed ? jevDecision : toRoutingTrace(orchestration);

    try {
      const preferredModel = orchestration.selectedModel;
      const fallbackModels = orchestration.fallbackChain;
      const thinkingConfig = orchestration.thinkingLevel
        ? { thinkingLevel: orchestration.thinkingLevel }
        : undefined;

      if (externalTools.length > 0 && this.mcpClientManager) {
        const loopResult = await executeGeminiToolLoop({
          gemini: this.gemini,
          mcpManager: this.mcpClientManager,
          tools: externalTools,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          agentMode,
          generateOptions: {
            temperature: this.persona.temperature,
            systemInstruction,
            ...(thinkingConfig ? { thinkingConfig } : {})
          },
          preferredModel,
          fallbackModels,
          dryRun: options.dryRun,
          brandId: this.brandId
        });

        const routingTrace = `[Jev: ${routing.tier} -> ${loopResult.activeModel} (${Math.round(routing.confidence * 100)}%, ${routing.routerLatencyMs}ms)]`;

        if (loopResult.status === 'approval_required' && loopResult.pendingApproval) {
          const pending = loopResult.pendingApproval;
          const draftCreated: AgentDraft = {
            id: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            chatId: message.chatId,
            incomingMessageId: message.id,
            incomingText: message.text || message.transcription || '',
            proposedReply: loopResult.text ? formatWhatsAppMessage(loopResult.text) : '',
            reasoning: `${routingTrace} External MCP tool '${pending.namespacedName}' requires human approval (${pending.reason}).`,
            confidence: 0.9,
            status: 'pending',
            createdAt: Date.now(),
            modelRouting: routing,
            toolCall: {
              namespacedName: pending.namespacedName,
              serverName: pending.serverName,
              toolName: pending.toolName,
              args: pending.args,
              risk: pending.risk,
              reason: pending.reason
            }
          };
          if (!options.dryRun) this.memoryStore.saveDraft(draftCreated);
          return {
            decision: {
              action: 'draft',
              intent: 'external_tool_action',
              replyText: draftCreated.proposedReply,
              reasoning: draftCreated.reasoning,
              confidence: 0.9,
              simulatedDelayMs: 0,
              modelRouting: routing,
              externalToolCalls: loopResult.toolTrace
            },
            draftCreated,
            shouldSendImmediately: false
          };
        }

        if (loopResult.status === 'blocked_human') {
          return {
            decision: {
              action: 'human',
              intent: 'external_tool_blocked',
              reasoning: `${routingTrace} External MCP tool execution blocked in human mode.`,
              confidence: 1,
              simulatedDelayMs: 0,
              modelRouting: routing,
              externalToolCalls: loopResult.toolTrace
            },
            shouldSendImmediately: false
          };
        }

        // Completed with or without read-only/autopilot tool calls.
        let parsedJson: Record<string, unknown> | null = null;
        try {
          const value: unknown = JSON.parse(loopResult.text);
          if (isRecord(value)) parsedJson = value;
        } catch {
          parsedJson = null;
        }

        if (parsedJson?.replyText !== undefined && parsedJson.replyText !== null && typeof parsedJson.replyText !== 'string') {
          throw new Error('Tool loop replyText must be a string');
        }
        const rawReply = typeof parsedJson?.replyText === 'string' ? parsedJson.replyText : loopResult.text;
        const formattedReply = rawReply ? formatWhatsAppMessage(rawReply) : '';
        const simulatedDelay = this.persona.simulateTypingDelay
          ? this.rateLimiter.calculateTypingDelay(formattedReply)
          : 500;
        const toolSummary = loopResult.toolTrace.length > 0
          ? ` Tools: ${loopResult.toolTrace.map((t) => `${t.namespacedName}(${t.decision})`).join(', ')}.`
          : '';

        const action = parsedJson?.action;
        const stage = parsedJson?.contactStage;
        parsedDecision = {
          action: action === 'draft' || action === 'ignore' || action === 'human' || action === 'act' ? action : 'reply',
          intent: typeof parsedJson?.intent === 'string' && parsedJson.intent ? parsedJson.intent : 'general_faq',
          replyText: formattedReply,
          sendAsVoiceNote: Boolean(parsedJson?.sendAsVoiceNote),
          reasoning: `${routingTrace}${toolSummary} ${(typeof parsedJson?.reasoning === 'string' && parsedJson.reasoning) || 'Synthesized reply via external MCP tool loop.'}`.trim(),
          confidence: typeof parsedJson?.confidence === 'number' && Number.isFinite(parsedJson.confidence) ? parsedJson.confidence : 0.9,
          simulatedDelayMs: simulatedDelay,
          suggestedReaction: typeof parsedJson?.suggestedReaction === 'string' ? parsedJson.suggestedReaction : undefined,
          extractedFacts: isStringArray(parsedJson?.extractedFacts) ? parsedJson.extractedFacts : undefined,
          extractedCommitments: isStringArray(parsedJson?.extractedCommitments) ? parsedJson.extractedCommitments : undefined,
          contactStage: stage === 'lead' || stage === 'qualified' || stage === 'negotiation' ||
            stage === 'customer' || stage === 'vip' || stage === 'archived' ? stage : undefined,
          modelRouting: routing,
          externalToolCalls: loopResult.toolTrace
        };
      } else {
      const fallbackRes = await executeWithModelFallback(
        fallbackModels,
        async (model) => {
          return await this.gemini.generateContent(
            [{ role: 'user', parts: [{ text: prompt }] }],
            {
              model,
              temperature: this.persona.temperature,
              systemInstruction,
              responseMimeType: 'application/json',
              ...(thinkingConfig ? { thinkingConfig } : {})
            }
          );
        },
        { preferredModel, provider: 'gemini', lane: 'interactive' }
      );

      const response = fallbackRes.result;
      let json = JSON.parse(response.text);

      // Temporal answer audit gate with at most 1 bounded remediation retry on block
      if (json.replyText && json.action !== 'ignore') {
        const initialAudit = auditTemporalAnswer(String(json.replyText), temporalEnvelope);
        if (initialAudit.severity === 'block' && initialAudit.remediation) {
          const retryPrompt = `${prompt}\n\n[NOWGUARD AUDIT REMEDIATION]\n${initialAudit.remediation}`;
          try {
            const retryRes = await executeWithModelFallback(
              fallbackModels,
              async (model) => {
                return await this.gemini.generateContent(
                  [{ role: 'user', parts: [{ text: retryPrompt }] }],
                  {
                    model,
                    temperature: this.persona.temperature,
                    systemInstruction,
                    responseMimeType: 'application/json',
                    ...(thinkingConfig ? { thinkingConfig } : {})
                  }
                );
              },
              { preferredModel, provider: 'gemini', lane: 'interactive' }
            );
            json = JSON.parse(retryRes.result.text);
          } catch {
            // Keep original JSON if remediation retry fails; final audit below will fail-safe to draft.
          }
        }
      }

      // Apply WhatsApp native markdown formatting to reply
      if (json.replyText) {
        json.replyText = formatWhatsAppMessage(json.replyText);
      }

      // Spontaneous natural reaction if model did not propose one
      if (!json.suggestedReaction) {
        const spontaneous = evaluateSpontaneousReaction({ text: inboundText, style: activeStyle });
        if (spontaneous) {
          json.suggestedReaction = spontaneous.emoji;
        }
      }

      const simulatedDelay = this.persona.simulateTypingDelay
        ? this.rateLimiter.calculateTypingDelay(json.replyText || '')
        : 500;

      const routingTrace = `[Jev: ${routing.tier} -> ${routing.selectedModel} (${Math.round(routing.confidence * 100)}%, ${routing.routerLatencyMs}ms)]`;
      const combinedReasoning = json.reasoning ? `${routingTrace} ${json.reasoning}` : routingTrace;

      parsedDecision = {
        action: json.action || 'reply',
        intent: json.intent || 'general_faq',
        replyText: json.replyText,
        sendAsVoiceNote: Boolean(json.sendAsVoiceNote),
        reasoning: combinedReasoning,
        confidence: Number(json.confidence ?? 0.85),
        simulatedDelayMs: simulatedDelay,
        suggestedReaction: json.suggestedReaction,
        extractedFacts: Array.isArray(json.extractedFacts) ? json.extractedFacts : undefined,
        extractedCommitments: Array.isArray(json.extractedCommitments) ? json.extractedCommitments : undefined,
        contactStage: json.contactStage,
        modelRouting: routing
      };

      // Persist newly discovered facts, commitments, and stage in a single atomic update
      if (!options.dryRun && (
        (Array.isArray(parsedDecision.extractedFacts) && parsedDecision.extractedFacts.length > 0) ||
        (Array.isArray(parsedDecision.extractedCommitments) && parsedDecision.extractedCommitments.length > 0) ||
        parsedDecision.contactStage
      )) {
        this.memoryStore.updateDossierExtracts(message.chatId, {
          facts: parsedDecision.extractedFacts,
          commitments: parsedDecision.extractedCommitments,
          stage: parsedDecision.contactStage
        });
      }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      parsedDecision = {
        action: 'human',
        intent: 'error_fallback',
        reasoning: `Model generation failed: ${msg}`,
        confidence: 0,
        simulatedDelayMs: 0,
        modelRouting: routing
      };
    }

    // 2.5 Temporal freshness & clock audit gate (fail-safe to draft on unverified LIVE/stale-year blocks)
    const hasVerifiedEvidence = Boolean(
      parsedDecision.externalToolCalls?.some((t) => t.decision === 'execute' && t.ok === true)
    );
    parsedDecision.temporalEnvelope = {
      observedAt: temporalEnvelope.observedAt,
      timezone: temporalEnvelope.timezone,
      localTime: temporalEnvelope.localTime,
      freshnessClass: temporalEnvelope.freshnessClass,
      evidenceRequired: temporalEnvelope.evidenceRequired,
      detectedDomains: temporalEnvelope.detectedDomains,
      isHighRisk: temporalEnvelope.isHighRisk
    };
    if (parsedDecision.replyText && parsedDecision.action !== 'ignore') {
      const finalAudit = auditTemporalAnswer(parsedDecision.replyText, temporalEnvelope, {
        hasVerifiedEvidence
      });
      parsedDecision.temporalAudit = {
        pass: finalAudit.pass,
        severity: finalAudit.severity,
        reasons: finalAudit.reasons,
        staleYearDetected: finalAudit.staleYearDetected,
        spoofedEvidence: finalAudit.spoofedEvidence
      };
      if (finalAudit.severity === 'block' && parsedDecision.action === 'reply') {
        parsedDecision.action = 'draft';
        parsedDecision.reasoning = `${parsedDecision.reasoning} [NowGuard: ${finalAudit.reasons.join('; ')}]`.trim();
      }
    }

    // 3. Evaluate through Deterministic Permission Policy
    const evalResult = evaluatePermission(this.policy, {
      intent: parsedDecision.intent,
      confidence: parsedDecision.confidence,
      requestedAction: parsedDecision.action
    });

    const finalAction: AutonomyAction = evalResult.action;
    parsedDecision.action = finalAction;

    if (this.worldModel) {
      const worldState = this.worldModel.encodeObservation({
        messages: history,
        dossier,
        intent: parsedDecision.intent,
        inboundText,
        confidence: parsedDecision.confidence
      });
      const prediction = this.worldModel.predictOutcome(worldState, finalAction, parsedDecision.confidence);
      parsedDecision.worldPrediction = {
        factors: worldState.factors,
        predictedOverrideProb: prediction.predictedOverrideProb,
        predictedUtility: prediction.predictedUtility,
        uncertainty: prediction.uncertainty
      };
    }

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
        createdAt: Date.now(),
        modelRouting: routing
      };
      if (!options.dryRun) this.memoryStore.saveDraft(draftCreated);
      shouldSendImmediately = false;
    } else if (agentMode === 'autopilot' && finalAction === 'reply' && parsedDecision.replyText) {
      shouldSendImmediately = true;
    }

    // Distillation is fire-and-forget and never blocks the live reply path.
    if (!options.dryRun && this.contextFoldEngine) {
      void this.contextFoldEngine.triggerFoldCheck(message.chatId);
    }

    return {
      decision: parsedDecision,
      draftCreated,
      shouldSendImmediately
    };
  }
}
