import type {
  BlueprintCtaMode,
  CoreSpineConfig,
  FinalBlueprint,
  FunnelNode,
  FunnelOption,
  IndustryId,
  IndustryPack,
  IndustryVocab,
  RenderedNode,
  SessionSnapshot,
  UserSession,
} from './types';

const GENERIC_VOCAB: IndustryVocab = {
  industry_label: 'بيزنسك',
  customer_singular: 'العميل',
  customer_plural: 'العملاء',
};

const OPS_MODE_LABELS: Record<string, string> = {
  team: 'فريق موديريشن / سيلز',
  solo: 'رد فردي (صاحب البيزنس أو شخص واحد)',
  existing_bot: 'منصة شات بوت / Business API حالية',
};

const VOLUME_LABELS: Record<string, string> = {
  vol_low: 'أقل من 20 محادثة يومياً',
  vol_mid: 'من 20 إلى 100 محادثة يومياً',
  vol_high: 'أكتر من 100 محادثة يومياً',
};

const VERTEX_LABELS: Record<string, string> = {
  eligible: 'مؤهل لرصيد 300 دولار Vertex AI (حساب جديد + كارت تحقق)',
  has_key: 'لديه حساب Google Cloud أو Gemini Key جاهز',
  need_help: 'محتاج مساعدة كاملة في التجهيز والربط',
};

export interface EngineContext {
  coreSpine: CoreSpineConfig;
  industries: Record<IndustryId, IndustryPack>;
  salesWhatsappNumber: string;
  freeDownloadUrl: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `sess_${Date.now()}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  throw new Error('Cryptographically secure random generator is unavailable');
}

function takeSnapshot(session: UserSession): SessionSnapshot {
  return {
    industryId: session.industryId,
    opsMode: session.opsMode,
    currentNodeId: session.currentNodeId,
    answers: { ...session.answers },
    answerLabels: { ...session.answerLabels },
    tags: [...session.tags],
    painScore: session.painScore,
    objectionsRaised: [...session.objectionsRaised],
  };
}

export function createInitialSession(initialIndustry?: IndustryId): UserSession {
  if (initialIndustry) {
    return {
      sessionId: generateSessionId(),
      startedAt: Date.now(),
      industryId: initialIndustry,
      opsMode: null,
      currentNodeId: 'q02_ops_mode',
      answers: {
        q01_industry: initialIndustry,
      },
      answerLabels: {},
      tags: [],
      painScore: 0,
      objectionsRaised: [],
      history: [],
    };
  }

  return {
    sessionId: generateSessionId(),
    startedAt: Date.now(),
    industryId: null,
    opsMode: null,
    currentNodeId: 'q01_industry',
    answers: {},
    answerLabels: {},
    tags: [],
    painScore: 0,
    objectionsRaised: [],
    history: [],
  };
}

export function resolveNode(
  ctx: EngineContext,
  industryId: IndustryId | null,
  nodeId: string,
): FunnelNode {
  if (nodeId.startsWith('ind_')) {
    if (!industryId) {
      throw new Error(`Cannot resolve industry node "${nodeId}" before industry is selected.`);
    }
    const pack = ctx.industries[industryId];
    const indNode = pack?.nodes[nodeId];
    if (!indNode) {
      throw new Error(`Industry node "${nodeId}" not found in pack "${industryId}".`);
    }
    return indNode;
  }

  const coreNode = ctx.coreSpine.nodes[nodeId];
  if (!coreNode) {
    throw new Error(`Core node "${nodeId}" not found in core-spine.json.`);
  }
  return coreNode;
}

export function interpolateTemplate(
  template: string | undefined,
  vocab: IndustryVocab,
): string {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in vocab) {
      return vocab[key as keyof IndustryVocab];
    }
    return '';
  });
}

function determineNextNodeId(
  session: UserSession,
  currentNode: FunnelNode,
  selectedOption: FunnelOption,
): string {
  // 1. Explicit option override (e.g. "لأ مش مقتنع" -> objection_handler)
  if (selectedOption.next_node_override) {
    return selectedOption.next_node_override;
  }

  // 2. Branch right after ops mode selection
  if (currentNode.id === 'q02_ops_mode') {
    if (session.opsMode === 'team') return 'q03_team_speed';
    if (session.opsMode === 'solo') return 'q03_solo_bottleneck';
    if (session.opsMode === 'existing_bot') return 'q03_bot_frustration';
  }

  // 3. Hand off from ops branch into active industry pack
  if (
    currentNode.id === 'q05_team_persuasion' ||
    currentNode.id === 'q05_solo_followup' ||
    currentNode.id === 'q05_bot_cost'
  ) {
    return 'ind_q1';
  }

  // 4. Return from industry pack back to shared volume/infra/vertex spine
  if (currentNode.id === 'ind_react2' || currentNode.id === 'ind_obj2') {
    return 'q11_daily_volume';
  }

  return currentNode.default_next;
}

export function selectOption(
  ctx: EngineContext,
  session: UserSession,
  optionId: string,
): { nextSession: UserSession; triggeredObjection: boolean } {
  const currentNode = resolveNode(ctx, session.industryId, session.currentNodeId);
  const option = currentNode.options.find((opt) => opt.id === optionId);

  if (!option) {
    throw new Error(
      `Option "${optionId}" does not exist on node "${currentNode.id}".`,
    );
  }

  const snapshot = takeSnapshot(session);
  const nextTags = new Set(session.tags);
  for (const tag of option.add_tags ?? []) {
    nextTags.add(tag);
  }

  let nextIndustryId = session.industryId;
  let nextOpsMode = session.opsMode;

  if (option.set_field) {
    const [field, value] = option.set_field;
    if (field === 'industry_id') {
      nextIndustryId = value;
    } else if (field === 'ops_mode') {
      nextOpsMode = value;
    }
  }

  const isSkeptical = (option.add_tags ?? []).includes('skeptical');
  const nextObjections = isSkeptical
    ? [...session.objectionsRaised, currentNode.id]
    : [...session.objectionsRaised];

  const draftSession: UserSession = {
    ...session,
    industryId: nextIndustryId,
    opsMode: nextOpsMode,
    answers: {
      ...session.answers,
      [currentNode.id]: option.id,
    },
    answerLabels: {
      ...session.answerLabels,
      [currentNode.id]: option.label,
    },
    tags: Array.from(nextTags),
    painScore: clamp(session.painScore + (option.pain_delta ?? 0), 0, 100),
    objectionsRaised: nextObjections,
    history: [...session.history, snapshot],
  };

  const nextNodeId = determineNextNodeId(draftSession, currentNode, option);

  return {
    nextSession: {
      ...draftSession,
      currentNodeId: nextNodeId,
    },
    triggeredObjection: isSkeptical,
  };
}

export function advanceFromLoader(session: UserSession): UserSession {
  if (session.currentNodeId !== 'loader_15') {
    return session;
  }
  return {
    ...session,
    currentNodeId: 'result_blueprint',
  };
}

export function goBack(session: UserSession): UserSession {
  if (session.history.length === 0) {
    return session;
  }
  const previousHistory = session.history.slice(0, -1);
  const lastSnapshot = session.history[session.history.length - 1];

  return {
    ...session,
    ...lastSnapshot,
    history: previousHistory,
  };
}

export function renderCurrentNode(
  ctx: EngineContext,
  session: UserSession,
): RenderedNode {
  const node = resolveNode(ctx, session.industryId, session.currentNodeId);
  const vocab = session.industryId
    ? ctx.industries[session.industryId].vocab
    : GENERIC_VOCAB;

  const totalSteps = ctx.coreSpine.totalEstimatedSteps;
  const stepNumber = Math.min(session.history.length + 1, totalSteps);
  const progressPercent =
    node.type === 'loader'
      ? 96
      : clamp(Math.round((session.history.length / totalSteps) * 100), 6, 94);

  return {
    id: node.id,
    type: node.type,
    phase: node.phase,
    progressPercent,
    stepNumber,
    totalEstimatedSteps: totalSteps,
    title: interpolateTemplate(node.title_template, vocab),
    body: interpolateTemplate(node.body_template, vocab),
    options: node.options,
    canGoBack: session.history.length > 0 && node.type !== 'loader',
  };
}

export function buildFinalBlueprint(
  ctx: EngineContext,
  session: UserSession,
): FinalBlueprint {
  const industryId: IndustryId = session.industryId ?? 'medical';
  const pack = ctx.industries[industryId];
  const tagSet = new Set(session.tags);

  // 1. Pain Tier classification
  let painTier: 'low' | 'medium' | 'high' = 'medium';
  let painTierLabel = 'ضغط تشغيلي متوسط — فرصة واضحة لتوفير الوقت والمصاريف';
  if (session.painScore >= 65) {
    painTier = 'high';
    painTierLabel = 'ضغط تشغيلي عالي — تسرب واضح في العملاء والوقت يومياً';
  } else if (session.painScore < 35) {
    painTier = 'low';
    painTierLabel = 'وضع مستقر — مناسب للأتمتة الهادية وتخفيف الروتين اليومي';
  }

  // 2. Infrastructure Recommendation
  let infraRecommendation: string;
  if (tagSet.has('vol_high')) {
    infraRecommendation =
      'VPS اقتصادي (2GB RAM) شغال 24 ساعة + تفعيل خيار Meta Cloud API الرسمي للتعامل مع ضغط الحملات العالي بأمان';
  } else if (tagSet.has('host_local')) {
    infraRecommendation =
      'تشغيل محلي مباشر (Self-Hosted) على جهاز المكتب الحالي بإمكانيات بسيطة ومن غير تكاليف استضافة شهرية';
  } else {
    infraRecommendation =
      'VPS اقتصادي (1 إلى 2GB RAM) خاص بيك بالكامل يضمن تشغيل 24 ساعة واستقرار عالي بأقل تكلفة';
  }

  // 3. Vertex AI $300 Eligibility & Setup Plan
  let aiPlan: string;
  if (tagSet.has('vertex_eligible')) {
    aiPlan =
      'مؤهل لتفعيل رصيد 300 دولار التجريبي الرسمي من Google Cloud Vertex AI لأول 90 يوم (بنساعدك خطوة بخطوة في التفعيل والربط مع موديلات Gemini)';
  } else if (tagSet.has('has_api_key')) {
    aiPlan =
      'ربط مباشر بمفتاح Gemini / Google Cloud الحالي بتاعك خلال نفس اليوم مع تفعيل ضغط السياق لتقليل استهلاك التوكنز';
  } else {
    aiPlan =
      'تجهيز كامل لحساب Google Cloud وربط موديلات Gemini السريعة مع شرح واضح للتحكم في الاستهلاك الشهري';
  }

  // 4. Recommended Tier & CTA Routing
  let ctaMode: BlueprintCtaMode;
  let recommendedTier: string;
  let ctaLabel: string;

  if (tagSet.has('self_hosted_diy')) {
    ctaMode = 'DOWNLOAD_FREE_CORE';
    recommendedTier = 'النسخة الأساسية المجانية Self-Hosted (تشغيل ذاتي)';
    ctaLabel = 'نزل النسخة المجانية ودليل التشغيل الآن';
  } else if (tagSet.has('vol_high') || tagSet.has('needs_full_setup')) {
    ctaMode = 'WHATSAPP_PILOT_PRO';
    recommendedTier =
      'التطبيق مجاناً + باقة التجهيز الشامل والمتابعة الشهرية (Pilot)';
    ctaLabel = 'ابدأ تجهيز نسخة الـ Pilot على واتساب';
  } else {
    ctaMode = 'WHATSAPP_PILOT_STARTER';
    recommendedTier =
      'التطبيق مجاناً + باقة المتابعة والدعم الشهري الاقتصادية (Pilot)';
    ctaLabel = 'احجز مكانك في الـ Pilot على واتساب';
  }

  // 5. WhatsApp Handoff Summary
  const opsSummary = session.opsMode ? OPS_MODE_LABELS[session.opsMode] : 'غير محدد';
  const volSummary =
    VOLUME_LABELS[session.answers['q11_daily_volume'] ?? ''] ?? 'غير محدد';
  const vertexSummary =
    VERTEX_LABELS[session.answers['q13_vertex_ai'] ?? ''] ?? 'غير محدد';

  const whatsappSummaryText = [
    'أهلاً، خلصت التقييم التفاعلي لوكيل واتساب:',
    `• المجال: ${pack.name_ar}`,
    `• وضع الرد الحالي: ${opsSummary}`,
    `• حجم الرسايل اليومي: ${volSummary}`,
    `• موقف Vertex AI: ${vertexSummary}`,
    `• مؤشر الضغط التشغيلي: ${session.painScore}/100`,
    `• الموديول المقترح: ${pack.recommended_module_name}`,
    'حابب أعرف خطوات التفعيل والـ Pilot.',
  ].join('\n');

  const cleanPhone = ctx.salesWhatsappNumber.replace(/[^\d]/g, '');
  const ctaUrl =
    ctaMode === 'DOWNLOAD_FREE_CORE'
      ? ctx.freeDownloadUrl
      : `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappSummaryText)}`;

  return {
    industryId,
    industryName: pack.name_ar,
    moduleName: pack.recommended_module_name,
    painScore: session.painScore,
    painTier,
    painTierLabel,
    infraRecommendation,
    aiPlan,
    recommendedTier,
    sampleConversation: pack.sample_conversation,
    objectionsAddressedCount: session.objectionsRaised.length,
    ctaMode,
    ctaLabel,
    ctaUrl,
    whatsappSummaryText,
    tags: [...session.tags],
  };
}
