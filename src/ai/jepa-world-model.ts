import type { AutonomyAction, ChatMessage, ContactDossier } from '../domain/types';

/**
 * Neutral factor coordinates inspired by JEPA-Anything's Orthogonal Predictive Factorization (OPF).
 * Semantic meanings are established by diagnostic correlation rather than hardwired assumptions:
 * - pc_000: engagement momentum [-1, 1]
 * - pc_001: trust / rapport alignment [-1, 1]
 * - pc_002: policy / escalation risk [0, 1]
 * - pc_003: resolution progress [0, 1]
 */
export type OpfFactorVector = [number, number, number, number];

export interface LatentWorldState {
  factors: OpfFactorVector;
  intent: string;
  turnCount: number;
  timestamp: number;
}

export interface FactorWeightDelta {
  delta: OpfFactorVector;
  overrideProb: number;
  count: number;
}

export interface WorldPrediction {
  predictedNextState: OpfFactorVector;
  predictedOverrideProb: number;
  predictedUtility: number;
  uncertainty: number;
}

export interface WorldTransitionRecord {
  id: string;
  chatId: string;
  intent: string;
  action: AutonomyAction;
  stateBefore: OpfFactorVector;
  predictedState: OpfFactorVector;
  observedState: OpfFactorVector;
  predictionError: number;
  surprise: number;
  feedbackType: 'approved' | 'edited' | 'rejected' | 'manual_override' | 'resolved' | 'unresolved';
  createdAt: number;
}

export interface OpfDiagnostics {
  sampleCount: number;
  meanPredictionError: number;
  meanSurprise: number;
  coordinateVariances: OpfFactorVector;
  hasCollapsedCoordinate: boolean;
  maxOffDiagonalCorrelation: number;
}

const DEFAULT_ACTION_PRIORS: Record<AutonomyAction, { delta: OpfFactorVector; overrideProb: number }> = {
  reply: { delta: [0.12, 0.1, -0.05, 0.22], overrideProb: 0.12 },
  draft: { delta: [0.02, 0.05, -0.15, 0.08], overrideProb: 0.25 },
  human: { delta: [-0.05, 0.0, -0.25, 0.05], overrideProb: 0.05 },
  ignore: { delta: [-0.25, -0.1, 0.0, 0.0], overrideProb: 0.02 },
  act: { delta: [0.15, 0.12, -0.08, 0.28], overrideProb: 0.15 }
};

const SENSITIVE_INTENTS = new Set(['financial_transaction', 'sensitive_inquiry', 'complaint', 'refund']);

const MAX_RECURSION_DEPTH = 32;

function clamp(value: number, min: number, max: number, depth = 0): number {
  if (depth > MAX_RECURSION_DEPTH) return min;
  return Math.max(min, Math.min(max, value));
}

function clampFactors(raw: readonly number[]): OpfFactorVector {
  return [
    clamp(raw[0] ?? 0, -1, 1),
    clamp(raw[1] ?? 0, -1, 1),
    clamp(raw[2] ?? 0, 0, 1),
    clamp(raw[3] ?? 0, 0, 1)
  ];
}

export function transitionKey(intent: string, action: AutonomyAction): string {
  return `${intent.trim().toLowerCase() || 'other'}::${action}`;
}

/**
 * Domain-adapted JEPA-OPF World Model for conversational state prediction and calibration.
 */
export class JepaWorldModel {
  private weights = new Map<string, FactorWeightDelta>();
  private readonly learningRate: number;

  constructor(options: { learningRate?: number; initialWeights?: Record<string, FactorWeightDelta> } = {}) {
    this.learningRate = clamp(options.learningRate ?? 0.25, 0.01, 0.8);
    if (options.initialWeights) {
      for (const [k, v] of Object.entries(options.initialWeights)) {
        this.weights.set(k, {
          delta: clampFactors(v.delta),
          overrideProb: clamp(v.overrideProb, 0, 1),
          count: Math.max(0, v.count)
        });
      }
    }
  }

  /**
   * Encodes an inbound conversation context into a 4D OPF latent state.
   */
  encodeObservation(input: {
    messages: Pick<ChatMessage, 'isFromMe' | 'text' | 'timestamp'>[];
    dossier?: Pick<ContactDossier, 'stage' | 'facts' | 'commitments'> | null;
    intent: string;
    inboundText: string;
    confidence?: number;
  }): LatentWorldState {
    const { messages, dossier, intent, inboundText, confidence = 0.85 } = input;
    const turnCount = messages.length;

    // pc_000: engagement momentum from recent reciprocity and message density
    const recent = messages.slice(-6);
    const contactMsgs = recent.filter((m) => !m.isFromMe).length;
    const ownerMsgs = recent.filter((m) => m.isFromMe).length;
    const reciprocity = recent.length > 0 ? (Math.min(contactMsgs, ownerMsgs) * 2) / recent.length : 0.2;
    const textLengthSignal = clamp(inboundText.trim().length / 180, 0, 0.5);
    const pc0 = clamp(reciprocity * 0.8 + textLengthSignal - 0.3, -1, 1);

    // pc_001: trust / rapport alignment from stage & dossier depth
    const stageScoreMap: Record<string, number> = {
      lead: 0.0,
      qualified: 0.25,
      negotiation: 0.35,
      customer: 0.65,
      vip: 0.85
    };
    const stageScore = dossier?.stage ? (stageScoreMap[dossier.stage] ?? 0.1) : 0.0;
    const factsBoost = clamp((dossier?.facts?.length ?? 0) * 0.05, 0, 0.25);
    const pc1 = clamp(stageScore + factsBoost - (SENSITIVE_INTENTS.has(intent) ? 0.15 : 0), -1, 1);

    // pc_002: policy / escalation risk
    const baseRisk = SENSITIVE_INTENTS.has(intent) ? 0.65 : intent === 'spam' ? 0.45 : 0.15;
    const uncertaintyPenalty = clamp(1 - confidence, 0, 0.6) * 0.5;
    const pc2 = clamp(baseRisk + uncertaintyPenalty, 0, 1);

    // pc_003: resolution progress
    const commitmentBoost = clamp((dossier?.commitments?.length ?? 0) * 0.12, 0, 0.35);
    const stageProgress = dossier?.stage === 'customer' || dossier?.stage === 'vip' ? 0.45 : 0.15;
    const pc3 = clamp(stageProgress + commitmentBoost + clamp(turnCount * 0.02, 0, 0.2), 0, 1);

    return {
      factors: [pc0, pc1, pc2, pc3],
      intent,
      turnCount,
      timestamp: Date.now()
    };
  }

  /**
   * Predicts the next latent state, human-override probability, and net utility for a candidate action.
   */
  predictOutcome(
    state: LatentWorldState,
    action: AutonomyAction,
    confidence = 0.85
  ): WorldPrediction {
    const key = transitionKey(state.intent, action);
    const learned = this.weights.get(key);
    const prior = DEFAULT_ACTION_PRIORS[action] ?? DEFAULT_ACTION_PRIORS.reply;

    // Blend prior with learned factor delta as sample count grows
    const alpha = learned ? clamp(learned.count / (learned.count + 4), 0, 0.9) : 0;
    const delta: OpfFactorVector = [
      prior.delta[0] * (1 - alpha) + (learned?.delta[0] ?? 0) * alpha,
      prior.delta[1] * (1 - alpha) + (learned?.delta[1] ?? 0) * alpha,
      prior.delta[2] * (1 - alpha) + (learned?.delta[2] ?? 0) * alpha,
      prior.delta[3] * (1 - alpha) + (learned?.delta[3] ?? 0) * alpha
    ];

    // If high policy risk (pc_002 > 0.5) and action is direct 'reply', override probability rises sharply
    const riskFactor = state.factors[2];
    const baseOverride = learned
      ? prior.overrideProb * (1 - alpha) + learned.overrideProb * alpha
      : prior.overrideProb;
    const riskPenalty = action === 'reply' ? riskFactor * 0.55 : action === 'draft' ? riskFactor * 0.1 : 0;
    const predictedOverrideProb = clamp(baseOverride + riskPenalty + (1 - confidence) * 0.2, 0, 1);

    const predictedNextState: OpfFactorVector = [
      clamp(state.factors[0] + delta[0], -1, 1),
      clamp(state.factors[1] + delta[1], -1, 1),
      clamp(state.factors[2] + delta[2], 0, 1),
      clamp(state.factors[3] + delta[3], 0, 1)
    ];

    // Utility balances engagement + trust + resolution against policy risk and human override cost
    const predictedUtility =
      predictedNextState[0] * 0.25 +
      predictedNextState[1] * 0.3 +
      predictedNextState[3] * 0.45 -
      predictedNextState[2] * 0.35 -
      predictedOverrideProb * 0.5;

    const uncertainty = clamp(1 - alpha * 0.7 - confidence * 0.3, 0.05, 1);

    return {
      predictedNextState,
      predictedOverrideProb,
      predictedUtility,
      uncertainty
    };
  }

  /**
   * Derives the realized latent state from real external feedback.
   */
  observeOutcome(
    prevState: LatentWorldState,
    feedbackType: WorldTransitionRecord['feedbackType']
  ): OpfFactorVector {
    const [pc0, pc1, pc2, pc3] = prevState.factors;
    switch (feedbackType) {
      case 'approved':
      case 'resolved':
        return [
          clamp(pc0 + 0.15, -1, 1),
          clamp(pc1 + 0.18, -1, 1),
          clamp(pc2 - 0.12, 0, 1),
          clamp(pc3 + 0.28, 0, 1)
        ];
      case 'edited':
        return [
          clamp(pc0 + 0.02, -1, 1),
          clamp(pc1 - 0.08, -1, 1),
          clamp(pc2 + 0.15, 0, 1),
          clamp(pc3 + 0.05, 0, 1)
        ];
      case 'rejected':
      case 'manual_override':
        return [
          clamp(pc0 - 0.2, -1, 1),
          clamp(pc1 - 0.28, -1, 1),
          clamp(pc2 + 0.32, 0, 1),
          clamp(pc3 - 0.15, 0, 1)
        ];
      case 'unresolved':
      default:
        return [
          clamp(pc0 - 0.05, -1, 1),
          clamp(pc1 - 0.05, -1, 1),
          clamp(pc2 + 0.05, 0, 1),
          clamp(pc3 - 0.05, 0, 1)
        ];
    }
  }

  /**
   * Calibrates factor transition weights from a realized (stateBefore, action, observedState) tuple.
   * Returns the transition record including prediction error and surprise.
   */
  calibrateFromTransition(input: {
    id: string;
    chatId: string;
    stateBefore: LatentWorldState;
    action: AutonomyAction;
    confidence?: number;
    feedbackType: WorldTransitionRecord['feedbackType'];
    createdAt?: number;
  }): { record: WorldTransitionRecord; updatedWeight: FactorWeightDelta } {
    const prediction = this.predictOutcome(input.stateBefore, input.action, input.confidence ?? 0.85);
    const observedState = this.observeOutcome(input.stateBefore, input.feedbackType);

    // L2 prediction error normalized by dimension sqrt(4)=2
    const sqSum =
      (observedState[0] - prediction.predictedNextState[0]) ** 2 +
      (observedState[1] - prediction.predictedNextState[1]) ** 2 +
      (observedState[2] - prediction.predictedNextState[2]) ** 2 +
      (observedState[3] - prediction.predictedNextState[3]) ** 2;
    const predictionError = Math.sqrt(sqSum) / 2;

    const wasOverridden =
      input.feedbackType === 'rejected' ||
      input.feedbackType === 'edited' ||
      input.feedbackType === 'manual_override'
        ? 1
        : 0;
    const overrideError = Math.abs(wasOverridden - prediction.predictedOverrideProb);
    const surprise = clamp(predictionError * 0.7 + overrideError * 0.3, 0, 1);

    const observedDelta: OpfFactorVector = [
      observedState[0] - input.stateBefore.factors[0],
      observedState[1] - input.stateBefore.factors[1],
      observedState[2] - input.stateBefore.factors[2],
      observedState[3] - input.stateBefore.factors[3]
    ];

    const key = transitionKey(input.stateBefore.intent, input.action);
    const prev = this.weights.get(key) ?? {
      delta: [...(DEFAULT_ACTION_PRIORS[input.action]?.delta ?? [0, 0, 0, 0])] as OpfFactorVector,
      overrideProb: DEFAULT_ACTION_PRIORS[input.action]?.overrideProb ?? 0.15,
      count: 0
    };

    const lr = this.learningRate;
    const updatedWeight: FactorWeightDelta = {
      delta: [
        clamp(prev.delta[0] * (1 - lr) + observedDelta[0] * lr, -1, 1),
        clamp(prev.delta[1] * (1 - lr) + observedDelta[1] * lr, -1, 1),
        clamp(prev.delta[2] * (1 - lr) + observedDelta[2] * lr, -1, 1),
        clamp(prev.delta[3] * (1 - lr) + observedDelta[3] * lr, -1, 1)
      ],
      overrideProb: clamp(prev.overrideProb * (1 - lr) + wasOverridden * lr, 0, 1),
      count: prev.count + 1
    };
    this.weights.set(key, updatedWeight);

    const record: WorldTransitionRecord = {
      id: input.id,
      chatId: input.chatId,
      intent: input.stateBefore.intent,
      action: input.action,
      stateBefore: input.stateBefore.factors,
      predictedState: prediction.predictedNextState,
      observedState,
      predictionError,
      surprise,
      feedbackType: input.feedbackType,
      createdAt: input.createdAt ?? Date.now()
    };

    return { record, updatedWeight };
  }

  exportWeights(): Record<string, FactorWeightDelta> {
    const out: Record<string, FactorWeightDelta> = {};
    for (const [k, v] of this.weights.entries()) {
      out[k] = { delta: [...v.delta] as OpfFactorVector, overrideProb: v.overrideProb, count: v.count };
    }
    return out;
  }

  /**
   * Computes JEPA-Anything style OPF geometry diagnostics:
   * - coordinate-wise variance (to detect collapsed factors)
   * - max off-diagonal Pearson correlation (to verify factor orthogonality)
   */
  computeOpfDiagnostics(transitions: WorldTransitionRecord[]): OpfDiagnostics {
    const n = transitions.length;
    if (n === 0) {
      return {
        sampleCount: 0,
        meanPredictionError: 0,
        meanSurprise: 0,
        coordinateVariances: [0, 0, 0, 0],
        hasCollapsedCoordinate: false,
        maxOffDiagonalCorrelation: 0
      };
    }

    const meanError = transitions.reduce((s, t) => s + t.predictionError, 0) / n;
    const meanSurprise = transitions.reduce((s, t) => s + t.surprise, 0) / n;

    const means: OpfFactorVector = [0, 0, 0, 0];
    for (const t of transitions) {
      for (let i = 0; i < 4; i++) {
        means[i] = (means[i] ?? 0) + (t.observedState[i] ?? 0);
      }
    }
    for (let i = 0; i < 4; i++) means[i] = (means[i] ?? 0) / n;

    const variances: OpfFactorVector = [0, 0, 0, 0];
    for (const t of transitions) {
      for (let i = 0; i < 4; i++) {
        const diff = (t.observedState[i] ?? 0) - (means[i] ?? 0);
        variances[i] = (variances[i] ?? 0) + diff * diff;
      }
    }
    for (let i = 0; i < 4; i++) variances[i] = (variances[i] ?? 0) / n;

    const hasCollapsedCoordinate = n >= 5 && variances.some((v) => v < 1e-6);

    let maxOffDiag = 0;
    if (n >= 3) {
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const denom = Math.sqrt((variances[i] ?? 0) * (variances[j] ?? 0));
          if (denom <= 1e-9) continue;
          let cov = 0;
          for (const t of transitions) {
            cov += ((t.observedState[i] ?? 0) - (means[i] ?? 0)) * ((t.observedState[j] ?? 0) - (means[j] ?? 0));
          }
          cov /= n;
          const corr = Math.abs(cov / denom);
          if (corr > maxOffDiag) maxOffDiag = corr;
        }
      }
    }

    return {
      sampleCount: n,
      meanPredictionError: meanError,
      meanSurprise,
      coordinateVariances: variances,
      hasCollapsedCoordinate,
      maxOffDiagonalCorrelation: maxOffDiag
    };
  }
}
