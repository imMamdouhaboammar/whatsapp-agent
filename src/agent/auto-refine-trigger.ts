import type { ConversationalFeedbackSignal } from '../ai/conversational-feedback';

export interface AutoRefineGateConfig {
  enabled: boolean;
  turnInterval: number;
  cooldownMs: number;
}

export interface ChatRefineState {
  turnsSinceLastReflect: number;
  lastAttemptAt: number;
  inFlight: boolean;
  generationVersion: number;
  pendingReason?: string;
}

/**
 * Turn-interval and feedback-burst auto-refine state machine inspired by Prime Agent's
 * CompactAutoRefineState. Ensures continuous back-and-forth conversations trigger
 * bounded, single-flight, cooldown-gated refinement checkpoints without thrashing.
 */
export class AutoRefineTrigger {
  private readonly config: AutoRefineGateConfig;
  private states = new Map<string, ChatRefineState>();
  private static readonly MAX_TRACKED_CHATS = 1000;

  constructor(config: Partial<AutoRefineGateConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      turnInterval: Math.max(2, config.turnInterval ?? 6),
      cooldownMs: Math.max(0, config.cooldownMs ?? 120_000)
    };
  }

  private getOrCreate(chatId: string): ChatRefineState {
    let state = this.states.get(chatId);
    if (!state) {
      if (this.states.size >= AutoRefineTrigger.MAX_TRACKED_CHATS) {
        const oldestKey = this.states.keys().next().value;
        if (oldestKey !== undefined) this.states.delete(oldestKey);
      }
      state = {
        turnsSinceLastReflect: 0,
        lastAttemptAt: 0,
        inFlight: false,
        generationVersion: 0
      };
      this.states.set(chatId, state);
    }
    return state;
  }

  /**
   * Records a conversational turn and arms a refinement trigger if turnInterval
   * is reached or an implicit negative/correction signal is detected.
   */
  recordTurn(
    chatId: string,
    signals: ConversationalFeedbackSignal[] = []
  ): { armed: boolean; reason?: string } {
    if (!this.config.enabled) return { armed: false };

    const state = this.getOrCreate(chatId);
    state.turnsSinceLastReflect += 1;

    const hasNegativeSignal = signals.some(
      (s) => s.kind === 'correction' || s.kind === 'escalation' || s.kind === 'clarification_loop'
    );

    if (hasNegativeSignal) {
      state.pendingReason = 'conversational_feedback_signal';
      return { armed: true, reason: state.pendingReason };
    }

    if (state.turnsSinceLastReflect >= this.config.turnInterval) {
      state.pendingReason = 'turn_interval_checkpoint';
      return { armed: true, reason: state.pendingReason };
    }

    return { armed: Boolean(state.pendingReason), reason: state.pendingReason };
  }

  /**
   * Attempts to claim an armed refinement round, enforcing cooldown and single-flight.
   * Returns the fenced generationVersion if claimed, or null if gated.
   */
  tryClaimRound(chatId: string, now = Date.now()): { reason: string; generationVersion: number } | null {
    if (!this.config.enabled) return null;
    const state = this.states.get(chatId);
    if (!state || !state.pendingReason) return null;
    if (state.inFlight) return null;
    if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < this.config.cooldownMs) {
      return null;
    }

    const reason = state.pendingReason;
    state.pendingReason = undefined;
    state.inFlight = true;
    state.lastAttemptAt = now;
    return { reason, generationVersion: state.generationVersion };
  }

  /**
   * Completes an in-flight round and resets the turn counter only if generationVersion matches.
   */
  finishRound(chatId: string, generationVersion: number, succeeded: boolean): boolean {
    const state = this.states.get(chatId);
    if (!state) return false;
    state.inFlight = false;
    if (state.generationVersion !== generationVersion) {
      return false; // Fenced: state advanced/rolled back while in flight
    }
    if (succeeded) {
      state.turnsSinceLastReflect = 0;
    }
    return true;
  }

  /**
   * Bumps generationVersion (e.g. on rollback or thread reset) so stale in-flight rounds drop.
   */
  fenceGeneration(chatId: string): void {
    const state = this.states.get(chatId);
    if (!state) return;
    state.generationVersion += 1;
    state.inFlight = false;
    state.pendingReason = undefined;
  }

  getState(chatId: string): ChatRefineState | undefined {
    const s = this.states.get(chatId);
    return s ? { ...s } : undefined;
  }
}
