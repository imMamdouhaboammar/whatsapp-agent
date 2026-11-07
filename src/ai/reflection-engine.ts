import type { GeminiClient } from './gemini-client';
import { DualMemoryManager, type FailureLogEntry } from '../domain/learning-memory';
import type { ChatMessage } from '../domain/types';

export interface ModerationFeedbackEvent {
  chatId: string;
  draftId?: string;
  feedbackType: 'rejected' | 'edited' | 'manual_override';
  originalReply?: string;
  revisedReply?: string;
  humanNote?: string;
}

export interface ReflectionEvaluationParams {
  chatId: string;
  messages: ChatMessage[];
  moderationFeedback?: ModerationFeedbackEvent[];
}

export interface ReflectionResult {
  selfCorrectionsDetected: number;
  rulesAdded: number;
  bestPracticesAdded: number;
  factsAdded: number;
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

  constructor(
    gemini: GeminiClient,
    memoryManager: DualMemoryManager,
    options: { model?: string } = {}
  ) {
    this.gemini = gemini;
    this.memoryManager = memoryManager;
    this.model = options.model || process.env.GEMINI_REFLECTION_MODEL || 'gemini-4-argon';
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
    let feedbackText = 'None recorded.';
    if (moderationFeedback && moderationFeedback.length > 0) {
      feedbackText = moderationFeedback.map(fb => {
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

    const response = await this.gemini.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        model: this.model,
        systemInstruction: REFLECTION_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        thinkingConfig: {
          thinkingLevel: 'HIGH'
        },
        responseMimeType: 'application/json'
      }
    );

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
    let factsAdded = 0;

    // 1. Process Self-Corrections & Failure Logs
    if (Array.isArray(parsed.selfCorrections)) {
      for (const sc of parsed.selfCorrections) {
        if (sc.incident && sc.correctiveAction) {
          const entry: FailureLogEntry = {
            timestamp: new Date().toISOString(),
            incident: sc.incident,
            rootCause: sc.rootCause || 'Unspecified',
            correctiveAction: sc.correctiveAction
          };
          this.memoryManager.recordFailureLog(entry);
          selfCorrectionsDetected++;
        }
      }
    }

    // 2. Process New Enforced Rules
    if (Array.isArray(parsed.newEnforcedRules)) {
      for (const rule of parsed.newEnforcedRules) {
        if (typeof rule === 'string' && rule.trim()) {
          this.memoryManager.addEnforcedRule(rule.trim());
          rulesAdded++;
        }
      }
    }

    // 3. Process New Best Practices
    if (Array.isArray(parsed.newBestPractices)) {
      for (const bp of parsed.newBestPractices) {
        if (typeof bp === 'string' && bp.trim()) {
          this.memoryManager.addBestPractice(bp.trim());
          bestPracticesAdded++;
        }
      }
    }

    // 4. Process Customer Traits & Profiles
    if (Array.isArray(parsed.customerInsights)) {
      for (const ci of parsed.customerInsights) {
        if (ci.chatId && Array.isArray(ci.traits)) {
          this.memoryManager.recordCustomerProfile(ci.chatId, {
            traits: ci.traits,
            stage: ci.stage
          });
          factsAdded += ci.traits.length;
        }
      }
    }

    // 5. Process Thread Semantic Summary
    if (parsed.threadSemanticSummary && typeof parsed.threadSemanticSummary === 'string') {
      this.memoryManager.recordThreadSemantic(chatId, parsed.threadSemanticSummary);
    }

    // 6. Process Business Signals
    if (Array.isArray(parsed.businessSignals)) {
      for (const bs of parsed.businessSignals) {
        if (typeof bs === 'string' && bs.trim()) {
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
      factsAdded,
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
        this.memoryManager.compactWorkbook(parsed.distilledRules);
        return true;
      }
    } catch (err: any) {
      console.warn('⚠️ [ReflectionEngine] Context compaction failed:', err.message);
    }
    return false;
  }
}
