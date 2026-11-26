import type { GeminiClient } from './gemini-client';
import { DualMemoryManager, type FailureLogEntry } from '../domain/learning-memory';
import type { ChatMessage } from '../domain/types';
import { executeWithModelFallback, resolveModelChain } from './model-fallback';
import type { RsiCycleOrchestrator } from './rsi-loop';
import {
  extractConversationalFeedback,
  formatConversationalFeedbackForReflection,
  type ConversationalFeedbackSignal
} from './conversational-feedback';

export interface ModerationFeedbackEvent {
  chatId: string;
  draftId?: string;
  feedbackType: 'approved' | 'rejected' | 'edited' | 'manual_override';
  originalReply?: string;
  revisedReply?: string;
  humanNote?: string;
}

export interface ReflectionEvaluationParams {
  chatId: string;
  messages: ChatMessage[];
  moderationFeedback?: ModerationFeedbackEvent[];
  conversationalSignals?: ConversationalFeedbackSignal[];
}

export interface ReflectionResult {
  selfCorrectionsDetected: number;
  rulesAdded: number;
  bestPracticesAdded: number;
  localTacticsAdded?: number;
  factsAdded: number;
  conversationalSignalsDetected?: number;
  summary: string;
  compacted?: boolean;
}

const REFLECTION_SYSTEM_INSTRUCTION = `You are the Lead SRE, Systems Architect, and Autonomous Cognition Evaluator for a production WhatsApp conversational AI.
Your purpose is continuous post-conversation learning, recursive prompt error auditing, and context distillation.

You will be given:
1. The recent conversation transcript between the WhatsApp user and the agent/human.
2. Any explicit human moderation events (such as human operator rejecting or altering an agent draft).
3. The current [Enforced Execution Rules] and [Best Practices Developed] from the agent's WORKBOOK.
4. The current customer profile and facts from the agent's NOTEBOOK.

YOUR EVALUATION OBJECTIVES:
1. SELF-CORRECTION & FAILURE AUDIT:
   - Identify whether the agent made errors: e.g., hallucinated product details or prices, made unapproved promises/discounts, showed bad tone or over-verbosity, or had a draft rejected/edited by the human owner.
   - For each detected failure, diagnose the precise Root Cause and formulate a strict, non-redundant, actionable COUNTER-RULE for [Enforced Execution Rules].
   - Counter-rules MUST start with clear imperatives: "NEVER ..." or "ALWAYS ...".

2. CONTINUOUS LEARNING & CUSTOMER TRAITS:
   - Extract durable customer traits: dialect preferences, location, business type, budget constraints, delivery habits.
   - Extract high-signal market/business intelligence: product demand spikes, frequent objections, shipping challenges.

3. BEST PRACTICES DISTILLATION:
   - When an interaction flowed smoothly, identify what phrasing or interaction rhythm worked and formulate a crisp best practice.

4. CONTEXT HYGIENE & STRICT OUTPUT:
   - Respond ONLY with valid JSON conforming to the requested schema.
   - Never output credentials, passwords, or tokens.
`;

export class ReflectionEngine {
  private gemini: GeminiClient;
  private memoryManager: DualMemoryManager;
  private model: string;
  private rsiOrchestrator?: RsiCycleOrchestrator;
  private brandId: string;

  constructor(
    gemini: GeminiClient,
    memoryManager: DualMemoryManager,
    options: { model?: string; rsiOrchestrator?: RsiCycleOrchestrator; brandId?: string } = {}
  ) {
    this.gemini = gemini;
    this.memoryManager = memoryManager;
    this.model = options.model || process.env.GEMINI_REFLECTION_MODEL || 'gemini-4-argon';
    this.rsiOrchestrator = options.rsiOrchestrator;
    this.brandId = options.brandId ?? 'default';
  }

  async evaluateThread(params: ReflectionEvaluationParams): Promise<ReflectionResult> {
    const { chatId, messages, moderationFeedback } = params;

    const currentWb = this.memoryManager.getWorkbook();

    // Format transcript
    const transcriptText = messages.map(m => {
      const sender = m.isFromMe ? 'Agent/Owner' : (m.senderName || m.sender);
      const text = m.text || (m.transcription ? `[Voice: ${m.transcription}]` : `[${m.type}]`);
      return `[${new Date(m.timestamp).toISOString()}] ${sender}: ${text}`;
    }).join('\n');

    // Format human moderation feedback
    const scopedFeedback = (moderationFeedback ?? []).filter((fb) => fb && fb.chatId === chatId);
    const conversationalSignals = params.conversationalSignals ?? extractConversationalFeedback(messages);
    let feedbackText = 'None recorded.';
    if (scopedFeedback.length > 0) {
      feedbackText = scopedFeedback.map(fb => {
        let str = `- Type: ${fb.feedbackType}`;
        if (fb.originalReply) str += ` | Proposed Draft: "${fb.originalReply}"`;
        if (fb.revisedReply) str += ` | Human Corrected To: "${fb.revisedReply}"`;
        if (fb.humanNote) str += ` | Note: ${fb.humanNote}`;
        return str;
      }).join('\n');
    }

    const prompt = `=== CONVERSATION LOGS (Chat: ${chatId}) ===
${transcriptText || 'No conversation messages.'}

=== HUMAN OPERATOR MODERATION SIGNALS ===
${feedbackText}

=== IMPLICIT CONVERSATIONAL FEEDBACK SIGNALS ===
${formatConversationalFeedbackForReflection(conversationalSignals)}

=== CURRENT ACTIVE WORKBOOK RULES ===
Enforced Rules:
${currentWb.enforcedRules.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'None'}

Best Practices:
${currentWb.bestPractices.map(bp => `- ${bp}`).join('\n') || 'None'}

=== CURRENT NOTEBOOK PROFILE (${chatId}) ===
${this.memoryManager.getActiveContextForPrompt(chatId) || 'No prior profile recorded.'}

Analyze this data and return your evaluation strictly in the following JSON structure:
{
  "selfCorrections": [
    {
      "incident": "Description of what went wrong or why human operator intervened",
      "rootCause": "Root cause analysis",
      "correctiveAction": "Enforced rule or procedural counter-measure"
    }
  ],
  "newEnforcedRules": [
    "NEVER ... or ALWAYS ..."
  ],
  "newBestPractices": [
    "Crisp operational guideline"
  ],
  "localTactics": [
    "Thread-specific phrasing or tactical adjustment for this customer only"
  ],
  "customerInsights": [
    {
      "chatId": "${chatId}",
      "traits": ["trait 1", "trait 2"],
      "stage": "lead | qualified | negotiation | customer | vip"
    }
  ],
  "threadSemanticSummary": "One sentence summary of thread topic and current resolution status",
  "businessSignals": [
    "Market insight or common customer trend"
  ]
}`;

    const chain = resolveModelChain(this.model, 'gemini-3.1-pro', 'gemini-3.8-flash');
    const { result: response } = await executeWithModelFallback(chain, async (targetModel) => {
      return this.gemini.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          model: targetModel,
          systemInstruction: REFLECTION_SYSTEM_INSTRUCTION,
          temperature: 0.2,
          thinkingConfig: targetModel.includes('argon') ? { thinkingLevel: 'HIGH' } : undefined,
          responseMimeType: 'application/json'
        }
      );
    
    }, { provider: 'gemini', lane: 'background' });

    let parsed: any;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      // Graceful parsing fallback if model wraps JSON in markdown blocks
      const cleaned = response.text.replace(/```(?:json)?/gi, '').trim();
      parsed = JSON.parse(cleaned);
    }

    let selfCorrectionsDetected = 0;
    let rulesAdded = 0;
    let bestPracticesAdded = 0;
    let localTacticsAdded = 0;
    let factsAdded = 0;

    // WA-003 trust boundaries for model output. The transcript is untrusted input: every entry is
    // fully type-validated before any write, customer facts bind to THIS thread's server-supplied
    // chatId, and global operational instructions (rules and best practices alike) require explicit
    // human moderation feedback recorded for THIS chat.
    const bounded = (value: unknown, max: number): value is string =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    const MAX_PER_REFLECTION = 10;
    const KNOWN_STAGES = new Set(['lead', 'qualified', 'negotiation', 'customer', 'vip']);
    // Only feedback recorded for this thread authorizes anything for this thread.
    const chatFeedback = (moderationFeedback ?? []).filter((fb) => fb && fb.chatId === chatId);
    const hasHumanFeedback = chatFeedback.length > 0;

    // 1. Process Self-Corrections & Failure Logs
    if (Array.isArray(parsed.selfCorrections)) {
      for (const sc of parsed.selfCorrections.slice(0, MAX_PER_REFLECTION)) {
        if (sc && bounded(sc.incident, 1000) && bounded(sc.correctiveAction, 1000)) {
          const entry: FailureLogEntry = {
            timestamp: new Date().toISOString(),
            incident: sc.incident,
            rootCause: bounded(sc.rootCause, 1000) ? sc.rootCause : 'Unspecified',
            correctiveAction: sc.correctiveAction
          };
          this.memoryManager.recordFailureLog(entry);
          selfCorrectionsDetected++;
        }
      }
    }

    // 2. Process New Enforced Rules
    // Security Guard: Global enforced rules in workbook.md can ONLY be added when explicit human
    // moderation feedback is present. This prevents untrusted customer prompt injection from
    // authoring global execution guardrails for other customers.
    if (hasHumanFeedback && Array.isArray(parsed.newEnforcedRules)) {
      const candidateRules = parsed.newEnforcedRules
        .slice(0, MAX_PER_REFLECTION)
        .filter((rule: unknown): rule is string => bounded(rule, 500))
        .map((r: string) => r.trim());
      if (candidateRules.length > 0) {
        if (this.rsiOrchestrator) {
          const cycle = this.rsiOrchestrator.runCycle({
            brandId: this.brandId,
            chatId,
            messages,
            candidates: [{
              id: `rsi_rules_${Date.now()}`,
              kind: 'add_rule',
              payload: candidateRules,
              summary: `Add ${candidateRules.length} enforced rule(s) from human feedback`,
              sourceIntent: 'reflection',
              requiresHumanAuthorization: true,
              authorizedByHuman: hasHumanFeedback
            }],
            feedbackType: chatFeedback[0]?.feedbackType,
            intent: 'reflection'
          });
          if (cycle.promoted) rulesAdded += candidateRules.length;
        } else {
          for (const rule of candidateRules) {
            this.memoryManager.addEnforcedRule(rule);
            rulesAdded++;
          }
        }
      }
    }

    // 3. Process New Best Practices — same trust tier as enforced rules: they are injected into
    // every future prompt, so untrusted transcripts must not install them.
    if (hasHumanFeedback && Array.isArray(parsed.newBestPractices)) {
      const candidatePractices = parsed.newBestPractices
        .slice(0, MAX_PER_REFLECTION)
        .filter((bp: unknown): bp is string => bounded(bp, 500))
        .map((bp: string) => bp.trim());
      if (candidatePractices.length > 0) {
        if (this.rsiOrchestrator) {
          const cycle = this.rsiOrchestrator.runCycle({
            brandId: this.brandId,
            chatId,
            messages,
            candidates: [{
              id: `rsi_bp_${Date.now()}`,
              kind: 'add_best_practice',
              payload: candidatePractices,
              summary: `Add ${candidatePractices.length} best practice(s) from human feedback`,
              sourceIntent: 'reflection',
              requiresHumanAuthorization: true,
              authorizedByHuman: hasHumanFeedback
            }]
          });
          if (cycle.promoted) bestPracticesAdded += candidatePractices.length;
        } else {
          for (const bp of candidatePractices) {
            this.memoryManager.addBestPractice(bp);
            bestPracticesAdded++;
          }
        }
      }
    }

    // 3b. Process Thread-Scoped Local Tactics — isolated to this chatId only, so conversational
    // back-and-forth can refine local tactics without polluting global rules (WA-003 preserved).
    if (Array.isArray(parsed.localTactics)) {
      for (const tactic of parsed.localTactics.slice(0, MAX_PER_REFLECTION)) {
        if (bounded(tactic, 320)) {
          if (this.memoryManager.recordLocalTactic(chatId, tactic.trim(), 'reflection_local_tactic')) {
            localTacticsAdded++;
          }
        }
      }
    }

    // 4. Process Customer Traits & Profiles — bound to this thread only. An insight naming any
    // other chatId is a trust-boundary violation and is dropped, never written.
    if (Array.isArray(parsed.customerInsights)) {
      for (const ci of parsed.customerInsights.slice(0, MAX_PER_REFLECTION)) {
        if (!ci || ci.chatId !== chatId || !Array.isArray(ci.traits)) continue;
        if (ci.stage !== undefined && !KNOWN_STAGES.has(ci.stage)) continue;
        if (!ci.traits.every((t: unknown) => bounded(t, 280))) continue;
        const traits = ci.traits.slice(0, MAX_PER_REFLECTION);
        if (traits.length === 0) continue;
        this.memoryManager.recordCustomerProfile(chatId, {
          traits,
          stage: ci.stage
        });
        factsAdded += traits.length;
      }
    }

    // 5. Process Thread Semantic Summary
    if (bounded(parsed.threadSemanticSummary, 2000)) {
      this.memoryManager.recordThreadSemantic(chatId, parsed.threadSemanticSummary);
    }

    // 6. Process Business Signals — observational market context, never operational instructions.
    if (Array.isArray(parsed.businessSignals)) {
      for (const bs of parsed.businessSignals.slice(0, MAX_PER_REFLECTION)) {
        if (bounded(bs, 500)) {
          this.memoryManager.recordBusinessInsight(bs.trim());
        }
      }
    }

    // 7. Context Protection & Distillation Check
    let compacted = false;
    if (this.memoryManager.needsCompaction()) {
      compacted = await this.performCompaction();
    }

    return {
      selfCorrectionsDetected,
      rulesAdded,
      bestPracticesAdded,
      localTacticsAdded,
      factsAdded,
      conversationalSignalsDetected: conversationalSignals.length,
      summary: parsed.threadSemanticSummary || `Reflected on ${messages.length} messages`,
      compacted
    };
  }

  /**
   * Performs an LLM-driven distillation to compress overgrown workbook rules.
   */
  async performCompaction(): Promise<boolean> {
    const wb = this.memoryManager.getWorkbook();
    if (wb.enforcedRules.length <= 5) return false;

    const prompt = `The following list of execution rules has grown and needs high-density distillation to preserve context budget and latency:
${wb.enforcedRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Synthesize these rules into a lean, non-redundant set of maximum 5-8 bulletproof execution guardrails.
Rules must remain strict imperatives (starting with ALWAYS or NEVER).
Return JSON:
{
  "distilledRules": ["rule 1", "rule 2"]
}`;

    try {
      const response = await this.gemini.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          model: this.model,
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: 'HIGH' },
          responseMimeType: 'application/json'
        }
      );
      const parsed = JSON.parse(response.text);
      if (Array.isArray(parsed.distilledRules) && parsed.distilledRules.length > 0) {
        if (this.rsiOrchestrator) {
          const cycle = this.rsiOrchestrator.runCycle({
            brandId: this.brandId,
            candidates: [{
              id: `rsi_compact_${Date.now()}`,
              kind: 'compact_rules',
              payload: parsed.distilledRules,
              summary: `Distill ${wb.enforcedRules.length} rules to ${parsed.distilledRules.length}`,
              sourceIntent: 'compaction',
              requiresHumanAuthorization: false,
              authorizedByHuman: true
            }]
          });
          return cycle.promoted;
        }
        this.memoryManager.compactWorkbook(parsed.distilledRules);
        return true;
      }
    } catch (err: any) {
      console.warn('⚠️ [ReflectionEngine] Context compaction failed:', err.message);
    }
    return false;
  }
}
