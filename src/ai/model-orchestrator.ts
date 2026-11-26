/**
 * Model Orchestrator
 *
 * Lightweight, zero-overhead orchestrator that decides which Gemini model
 * should handle each incoming message based on modality, complexity, risk,
 * tool availability, and persona defaults.
 *
 * Inspired by role-based stage assignment (paper-orchestra), intent-driven
 * dispatching (multi-agent-orchestration), and capability-matched routing
 * with fallback guardrails (agent-orchestrator).
 */

import type { ChatMessage, ModelRoutingTrace } from '../domain/types';
import { resolveModelChain } from './model-fallback';
import { isGemini4Model, type GeminiModelName, type RoutingDecision } from './model-router';

export type OrchestratorRole =
  | 'fast_responder'
  | 'multimodal_specialist'
  | 'balanced_workhorse'
  | 'deep_reasoner';

export type OrchestratorTier = 'trivial' | 'standard' | 'complex';

export interface OrchestrationInput {
  message: Pick<ChatMessage, 'text' | 'type' | 'transcription' | 'mediaUrl' | 'mediaBuffer'>;
  historyLength?: number;
  personaModel?: string;
  hasExternalTools?: boolean;
  /** Optional external Jev routing decision; honored when not bypassed. */
  jevDecision?: RoutingDecision;
}

export interface OrchestrationDecision {
  selectedModel: GeminiModelName;
  tier: OrchestratorTier;
  role: OrchestratorRole;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  fallbackChain: string[];
  confidence: number;
  latencyMs: number;
  reason: string;
  source: 'orchestrator' | 'jev_external';
}

const TRIVIAL_PATTERN =
  /^(?:[\p{Emoji}\s!?.،]+|(?:hi|hello|hey|ok|okay|thanks|thank you|thx|bye|good morning|good evening|yes|no|sure|cool|great|اهلا|أهلا|اهلاً|أهلاً|مرحبا|مرحباً|هاي|هلو|السلام عليكم|وعليكم السلام|صباح الخير|مساء الخير|ازيك|إزيك|عامل ايه|أخبارك|شكرا|شكراً|تسلم|تمام|ماشي|حاضر|نعم|لا|اوكي|أوكي|طيب|ممتاز|يعطيك العافية)[\p{Emoji}\s!?.،]*)$/iu;

const HIGH_STAKES_PATTERN =
  /(?:refund|chargeback|dispute|complaint|lawyer|sue|scam|fraud|cancel.*subscription|angry|terrible|worst|contract|invoice|payment.*failed|double.*charged|استرجاع|استرداد|شكوى|مشكلة|حماية المستهلك|نصب|احتيال|تهديد|محامي|خصم.*مرتين|اتخصم.*مرتين|الغاء|إلغاء|عقد|فاتورة|دفع|مبلغ|تعويض|سيئ|سيئة|زفت|محدش بيرد)/iu;

const ANALYTICAL_TOOL_PATTERN =
  /(?:compare|analyze|explain why|step by step|architecture|calculate|schedule|book|order status|ticket|check.*order|قارن|حلل|اشرح|احسب|تفاصيل|مقارنة|جدول|حجز|متابعة الطلب|تذكرة)/iu;

/** Strips invisible directional/zero-width marks common in WhatsApp RTL/forwarded text. */
function normalizeInvisibleChars(text: string): string {
  return text.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').trim();
}

function mapThinkingLevel(model: string, tier: OrchestratorTier): 'LOW' | 'MEDIUM' | 'HIGH' | undefined {
  if (!isGemini4Model(model)) return undefined;
  if (model === 'gemini-4-neon' || model === 'gemini-4-flash') return undefined;
  if (tier === 'complex' || model === 'gemini-4-carbon') return 'HIGH';
  if (tier === 'trivial' || model === 'gemini-4-hydrogen') return 'LOW';
  return 'MEDIUM';
}

/**
 * Selects the optimal Gemini model and execution configuration for an inbound message.
 */
export function orchestrateModel(input: OrchestrationInput): OrchestrationDecision {
  const start = performance.now();
  const personaModel = input.personaModel?.trim() || 'gemini-4-argon';

  // 1. Honor explicit external Jev decision when active (not bypassed)
  if (input.jevDecision && !input.jevDecision.bypassed) {
    const selected = input.jevDecision.selectedModel || personaModel;
    const tier = input.jevDecision.tier;
    const role: OrchestratorRole =
      tier === 'complex' ? 'deep_reasoner' : tier === 'trivial' ? 'fast_responder' : 'balanced_workhorse';

    return {
      selectedModel: selected,
      tier,
      role,
      thinkingLevel: mapThinkingLevel(selected, tier),
      fallbackChain: resolveModelChain(selected, process.env.GEMINI_FALLBACK_MODELS, personaModel),
      confidence: input.jevDecision.confidence,
      latencyMs: input.jevDecision.routerLatencyMs,
      reason: input.jevDecision.reason,
      source: 'jev_external'
    };
  }

  const text = normalizeInvisibleChars(input.message.text || input.message.transcription || '');
  const msgType = input.message.type;
  const historyLen = input.historyLength ?? 0;

  // 2. Modality-driven routing (images, video, documents, or untranscribed audio)
  if (
    msgType === 'image' ||
    msgType === 'video' ||
    msgType === 'document' ||
    (msgType === 'audio' && !input.message.transcription)
  ) {
    const selected: GeminiModelName = msgType === 'document' && text.length > 300 ? 'gemini-4-argon' : 'gemini-4-neon';
    const tier: OrchestratorTier = selected === 'gemini-4-argon' ? 'complex' : 'standard';
    return {
      selectedModel: selected,
      tier,
      role: 'multimodal_specialist',
      thinkingLevel: mapThinkingLevel(selected, tier),
      fallbackChain: resolveModelChain(selected, process.env.GEMINI_FALLBACK_MODELS, personaModel),
      confidence: 0.92,
      latencyMs: Math.round(performance.now() - start),
      reason: `Multimodal ${msgType} payload routed to ${selected}`,
      source: 'orchestrator'
    };
  }

  // 3. High-stakes, dispute, financial, or complex multi-step reasoning -> Carbon / Argon
  if (HIGH_STAKES_PATTERN.test(text)) {
    const selected: GeminiModelName = 'gemini-4-carbon';
    return {
      selectedModel: selected,
      tier: 'complex',
      role: 'deep_reasoner',
      thinkingLevel: 'HIGH',
      fallbackChain: resolveModelChain(selected, process.env.GEMINI_FALLBACK_MODELS, personaModel),
      confidence: 0.91,
      latencyMs: Math.round(performance.now() - start),
      reason: 'High-stakes or dispute signals detected; escalated to gemini-4-carbon',
      source: 'orchestrator'
    };
  }

  if (
    text.length > 500 ||
    (input.hasExternalTools && ANALYTICAL_TOOL_PATTERN.test(text)) ||
    (historyLen > 15 && /[?؟]/.test(text) && text.length > 80)
  ) {
    const selected: GeminiModelName = personaModel === 'gemini-4-carbon' ? 'gemini-4-carbon' : 'gemini-4-argon';
    return {
      selectedModel: selected,
      tier: 'complex',
      role: 'deep_reasoner',
      thinkingLevel: mapThinkingLevel(selected, 'complex'),
      fallbackChain: resolveModelChain(selected, process.env.GEMINI_FALLBACK_MODELS, personaModel),
      confidence: 0.86,
      latencyMs: Math.round(performance.now() - start),
      reason: `Complex/tool-heavy turn routed to ${selected}`,
      source: 'orchestrator'
    };
  }

  // 4. Trivial greetings, acknowledgements, and short reactions -> Hydrogen (fast responder)
  if (!input.hasExternalTools && text.length > 0 && text.length <= 48 && TRIVIAL_PATTERN.test(text)) {
    const selected: GeminiModelName = 'gemini-4-hydrogen';
    return {
      selectedModel: selected,
      tier: 'trivial',
      role: 'fast_responder',
      thinkingLevel: 'LOW',
      fallbackChain: resolveModelChain(selected, process.env.GEMINI_FALLBACK_MODELS, personaModel),
      confidence: 0.94,
      latencyMs: Math.round(performance.now() - start),
      reason: 'Short greeting or acknowledgement fast-pathed to gemini-4-hydrogen',
      source: 'orchestrator'
    };
  }

  // 5. Standard turn -> configured persona model (defaulting to gemini-4-argon)
  const selected: GeminiModelName = personaModel;
  return {
    selectedModel: selected,
    tier: 'standard',
    role: 'balanced_workhorse',
    thinkingLevel: mapThinkingLevel(selected, 'standard'),
    fallbackChain: resolveModelChain(selected, process.env.GEMINI_FALLBACK_MODELS),
    confidence: 0.85,
    latencyMs: Math.round(performance.now() - start),
    reason: `Standard conversational turn routed to ${selected}`,
    source: 'orchestrator'
  };
}

/** Converts an OrchestrationDecision into the standard ModelRoutingTrace persisted on decisions/drafts. */
export function toRoutingTrace(decision: OrchestrationDecision): ModelRoutingTrace {
  return {
    selectedModel: decision.selectedModel,
    tier: decision.tier,
    confidence: decision.confidence,
    routerLatencyMs: decision.latencyMs,
    reason: decision.reason,
    bypassed: false
  };
}
