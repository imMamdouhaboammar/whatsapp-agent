import { randomUUID } from 'node:crypto';
import type { DualMemoryManager } from '../domain/learning-memory';
import type { RsiGenerationRecord, RsiLedger } from '../domain/rsi-ledger';
import type { AutonomyAction, ChatMessage, ContactDossier } from '../domain/types';
import {
  JepaWorldModel,
  type LatentWorldState,
  type OpfDiagnostics,
  type WorldPrediction,
  type WorldTransitionRecord
} from './jepa-world-model';

export type RsiMutationKind =
  | 'add_rule'
  | 'update_rule'
  | 'delete_rule'
  | 'add_best_practice'
  | 'update_best_practice'
  | 'delete_best_practice'
  | 'compact_rules';

export interface CandidateMutation {
  id: string;
  kind: RsiMutationKind;
  payload: string[];
  summary: string;
  sourceIntent: string;
  requiresHumanAuthorization: boolean;
  authorizedByHuman: boolean;
}

export interface ScoredCandidateMutation {
  candidate: CandidateMutation;
  predictedGain: number;
  predictedRisk: number;
  score: number;
}

export interface RegressionScenario {
  scenarioId: string;
  required: boolean;
  baselinePassed: boolean;
  evaluate: (proposedRules: string[], proposedPractices: string[]) => boolean;
}

export interface RsiCycleInput {
  brandId: string;
  chatId?: string;
  messages?: ChatMessage[];
  dossier?: ContactDossier | null;
  candidates: CandidateMutation[];
  scenarios?: RegressionScenario[];
  feedbackType?: WorldTransitionRecord['feedbackType'];
  actionTaken?: AutonomyAction;
  intent?: string;
}

export interface RsiCycleResult {
  stageReached: 'propose' | 'predict' | 'select' | 'evaluate' | 'learn' | 'retain';
  promoted: boolean;
  selectedCandidate?: ScoredCandidateMutation;
  generation?: RsiGenerationRecord;
  opfDiagnostics: OpfDiagnostics;
  reason: string;
}

export interface TurnCandidateScore {
  action: AutonomyAction;
  prediction: WorldPrediction;
  netScore: number;
}

/**
 * Implements the RSI-Anything closed loop:
 * Propose -> Predict -> Select -> Evaluate -> Learn -> Retain
 */
export class RsiCycleOrchestrator {
  private worldModel: JepaWorldModel;
  private memoryManager: DualMemoryManager;
  private ledger: RsiLedger;

  constructor(options: {
    worldModel: JepaWorldModel;
    memoryManager: DualMemoryManager;
    ledger: RsiLedger;
  }) {
    this.worldModel = options.worldModel;
    this.memoryManager = options.memoryManager;
    this.ledger = options.ledger;
  }

  /**
   * Online JEPA-guided candidate action scoring for ModeratorAgent turns.
   */
  scoreTurnCandidates(
    state: LatentWorldState,
    actions: AutonomyAction[],
    confidence = 0.85
  ): TurnCandidateScore[] {
    return actions
      .map((action) => {
        const prediction = this.worldModel.predictOutcome(state, action, confidence);
        const netScore = prediction.predictedUtility - prediction.uncertainty * 0.15;
        return { action, prediction, netScore };
      })
      .sort((a, b) => b.netScore - a.netScore);
  }

  /**
   * Executes a full 6-stage Recursive Self-Improvement cycle.
   */
  runCycle(input: RsiCycleInput): RsiCycleResult {
    const { brandId } = input;
    const recentBefore = this.ledger.getRecentTransitions(brandId, 100);
    const diagBefore = this.worldModel.computeOpfDiagnostics(recentBefore);

    // 1. PROPOSE: Filter out empty or unauthorized mutations (WA-003 trust boundary)
    const authorizedCandidates = input.candidates.filter((c) => {
      if (!c.payload.length || !c.payload.some((p) => p.trim().length > 0)) return false;
      if (c.requiresHumanAuthorization && !c.authorizedByHuman) return false;
      return true;
    });

    if (authorizedCandidates.length === 0) {
      return {
        stageReached: 'propose',
        promoted: false,
        opfDiagnostics: diagBefore,
        reason: 'No authorized non-empty candidate mutations proposed'
      };
    }

    // 2. PREDICT: Score each candidate using JEPA-OPF world state
    const baseState = this.worldModel.encodeObservation({
      messages: input.messages ?? [],
      dossier: input.dossier ?? null,
      intent: input.intent ?? 'general_faq',
      inboundText: input.messages?.at(-1)?.text ?? ''
    });

    const scored: ScoredCandidateMutation[] = authorizedCandidates.map((candidate) => {
      const actionForPred: AutonomyAction =
        candidate.kind === 'add_rule' ? 'draft' : 'reply';
      const pred = this.worldModel.predictOutcome(baseState, actionForPred, 0.9);
      const noveltyBonus = candidate.kind === 'compact_rules' ? 0.1 : 0.05;
      const predictedGain = Number((pred.predictedUtility + noveltyBonus).toFixed(4));
      const predictedRisk = Number(pred.predictedOverrideProb.toFixed(4));
      const score = Number((predictedGain - predictedRisk * 0.5).toFixed(4));
      return { candidate, predictedGain, predictedRisk, score };
    });

    // 3. SELECT: Pick highest net-score candidate
    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0];

    // 4. EVALUATE: Deterministic regression gate before retention
    const currentWb = this.memoryManager.getWorkbook();
    const proposedRules = this.previewRules(currentWb.enforcedRules, selected.candidate);
    const proposedPractices = this.previewPractices(currentWb.bestPractices, selected.candidate);

    const scenarios = input.scenarios ?? [];
    let baselinePassRate = 1;
    let observedPassRate = 1;
    let regressionDetected = false;

    if (scenarios.length > 0) {
      let basePassed = 0;
      let afterPassed = 0;
      for (const sc of scenarios) {
        if (sc.baselinePassed) basePassed++;
        const after = sc.evaluate(proposedRules, proposedPractices);
        if (after) afterPassed++;
        if (sc.required && sc.baselinePassed && !after) {
          regressionDetected = true;
        }
      }
      baselinePassRate = basePassed / scenarios.length;
      observedPassRate = afterPassed / scenarios.length;
      if (observedPassRate < baselinePassRate) {
        regressionDetected = true;
      }
    }

    // Basic structural invariant: never compact to 0 rules if rules existed
    if (currentWb.enforcedRules.length > 0 && proposedRules.length === 0) {
      regressionDetected = true;
      observedPassRate = 0;
    }

    // 5. LEARN: Calibrate JEPA world model if feedback/transition is present
    if (input.feedbackType && input.chatId) {
      const { record } = this.worldModel.calibrateFromTransition({
        id: `tr_${randomUUID()}`,
        chatId: input.chatId,
        stateBefore: baseState,
        action: input.actionTaken ?? 'reply',
        feedbackType: input.feedbackType
      });
      this.ledger.recordTransition(brandId, record);
      this.ledger.saveWorldWeights(brandId, this.worldModel.exportWeights());
    }

    const recentAfter = this.ledger.getRecentTransitions(brandId, 100);
    const diagAfter = this.worldModel.computeOpfDiagnostics(recentAfter);
    const parentGen = this.ledger.getLatestPromotedGeneration(brandId);

    if (regressionDetected) {
      const rejectedGen = this.ledger.recordGeneration({
        parentGenerationId: parentGen?.generationId ?? null,
        brandId,
        status: 'rejected',
        mutationSummary: selected.candidate.summary,
        predictedGain: selected.predictedGain,
        observedPassRate,
        baselinePassRate,
        predictionErrorBefore: diagBefore.meanPredictionError,
        predictionErrorAfter: diagAfter.meanPredictionError,
        opfDiagnostics: diagAfter,
        createdAt: Date.now()
      });

      return {
        stageReached: 'evaluate',
        promoted: false,
        selectedCandidate: selected,
        generation: rejectedGen,
        opfDiagnostics: diagAfter,
        reason: 'Candidate blocked by evaluation regression gate'
      };
    }

    // 6. RETAIN: Snapshot pre-mutation state, apply verified mutation, and record generation
    const snapshotId = `rsi_gen_${Date.now()}_${randomUUID().slice(0, 8)}`;
    this.memoryManager.takeSnapshot(snapshotId);
    this.applyMutation(selected.candidate);

    const promotedGen = this.ledger.recordGeneration({
      parentGenerationId: parentGen?.generationId ?? null,
      brandId,
      status: 'promoted',
      mutationSummary: `${selected.candidate.summary} [snap:${snapshotId}]`,
      predictedGain: selected.predictedGain,
      observedPassRate,
      baselinePassRate,
      predictionErrorBefore: diagBefore.meanPredictionError,
      predictionErrorAfter: diagAfter.meanPredictionError,
      opfDiagnostics: diagAfter,
      createdAt: Date.now()
    });

    return {
      stageReached: 'retain',
      promoted: true,
      selectedCandidate: selected,
      generation: promotedGen,
      opfDiagnostics: diagAfter,
      reason: 'Candidate verified and retained'
    };
  }

  /**
   * Rolls back a promoted generation using its pre-mutation snapshot and records
   * a rollback generation entry in RsiLedger.
   */
  rollbackGeneration(brandId: string, generationId: number): { rolledBack: boolean; reason: string } {
    const gens = this.ledger.getRecentGenerations(brandId, 50);
    const target = gens.find((g) => g.generationId === generationId && g.status === 'promoted');
    if (!target) {
      return { rolledBack: false, reason: `Promoted generation ${generationId} not found for brand ${brandId}` };
    }
    const snapMatch = target.mutationSummary.match(/\[snap:([^\]]+)\]/);
    if (!snapMatch?.[1]) {
      return { rolledBack: false, reason: 'Generation has no associated snapshot ID' };
    }
    const ok = this.memoryManager.rollbackToSnapshot(snapMatch[1]);
    if (!ok) {
      return { rolledBack: false, reason: `Snapshot ${snapMatch[1]} expired or unavailable` };
    }
    const recent = this.ledger.getRecentTransitions(brandId, 100);
    const diag = this.worldModel.computeOpfDiagnostics(recent);
    this.ledger.recordGeneration({
      parentGenerationId: generationId,
      brandId,
      status: 'rejected',
      mutationSummary: `Rollback of generation ${generationId}: ${target.mutationSummary}`,
      predictedGain: 0,
      observedPassRate: target.baselinePassRate,
      baselinePassRate: target.baselinePassRate,
      predictionErrorBefore: diag.meanPredictionError,
      predictionErrorAfter: diag.meanPredictionError,
      opfDiagnostics: diag,
      createdAt: Date.now()
    });
    return { rolledBack: true, reason: `Rolled back generation ${generationId}` };
  }

  private previewRules(current: string[], candidate: CandidateMutation): string[] {
    if (candidate.kind === 'add_rule') {
      const next = [...current];
      for (const r of candidate.payload) {
        const clean = r.trim();
        if (clean && !next.includes(clean)) next.push(clean);
      }
      return next;
    }
    if (candidate.kind === 'update_rule' && candidate.payload.length >= 2) {
      const [oldRule, newRule] = candidate.payload;
      return current.map((r) => (r === oldRule.trim() ? newRule.trim() : r)).filter(Boolean);
    }
    if (candidate.kind === 'delete_rule') {
      const toDelete = new Set(candidate.payload.map((r) => r.trim()));
      return current.filter((r) => !toDelete.has(r));
    }
    if (candidate.kind === 'compact_rules') {
      return candidate.payload.map((r) => r.trim()).filter(Boolean);
    }
    return current;
  }

  private previewPractices(current: string[], candidate: CandidateMutation): string[] {
    if (candidate.kind === 'add_best_practice') {
      const next = [...current];
      for (const p of candidate.payload) {
        const clean = p.trim();
        if (clean && !next.includes(clean)) next.push(clean);
      }
      return next;
    }
    if (candidate.kind === 'update_best_practice' && candidate.payload.length >= 2) {
      const [oldBp, newBp] = candidate.payload;
      return current.map((p) => (p === oldBp.trim() ? newBp.trim() : p)).filter(Boolean);
    }
    if (candidate.kind === 'delete_best_practice') {
      const toDelete = new Set(candidate.payload.map((p) => p.trim()));
      return current.filter((p) => !toDelete.has(p));
    }
    return current;
  }

  private applyMutation(candidate: CandidateMutation): void {
    if (candidate.kind === 'add_rule') {
      for (const rule of candidate.payload) {
        this.memoryManager.addEnforcedRule(rule);
      }
    } else if (candidate.kind === 'update_rule' && candidate.payload.length >= 2) {
      this.memoryManager.updateEnforcedRule(candidate.payload[0], candidate.payload[1]);
    } else if (candidate.kind === 'delete_rule') {
      for (const rule of candidate.payload) {
        this.memoryManager.removeEnforcedRule(rule);
      }
    } else if (candidate.kind === 'add_best_practice') {
      for (const bp of candidate.payload) {
        this.memoryManager.addBestPractice(bp);
      }
    } else if (candidate.kind === 'update_best_practice' && candidate.payload.length >= 2) {
      this.memoryManager.updateBestPractice(candidate.payload[0], candidate.payload[1]);
    } else if (candidate.kind === 'delete_best_practice') {
      for (const bp of candidate.payload) {
        this.memoryManager.removeBestPractice(bp);
      }
    } else if (candidate.kind === 'compact_rules') {
      this.memoryManager.compactWorkbook(candidate.payload);
    }
  }
}
