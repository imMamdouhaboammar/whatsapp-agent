import type { MemoryStore } from '../domain/memory-store';
import type { DualMemoryManager, LearningPersistenceStore } from '../domain/learning-memory';
import type { ReflectionEngine, ModerationFeedbackEvent, ReflectionResult } from '../ai/reflection-engine';
import type { PostgresLearningStore } from '../persistence/postgres/learning-store';
import { describeError, hashChatId, logEvent } from '../observability/safe-log';
import { AutoRefineTrigger } from './auto-refine-trigger';
import { extractConversationalFeedback } from '../ai/conversational-feedback';

export interface ReflectionWorkerOptions {
  memoryStore: MemoryStore;
  memoryManager: DualMemoryManager;
  reflectionEngine: ReflectionEngine;
  persistenceStore?: PostgresLearningStore | LearningPersistenceStore;
  brandId?: string;
  idleThresholdMs?: number; // Defaults to 15 minutes (15 * 60 * 1000)
  maxBatchPerSweep?: number;
}

export interface ThreadActivityRecord {
  chatId: string;
  lastActivityAt: number;
  lastReflectedAt: number;
  isProcessing: boolean;
}

export class ReflectionWorker {
  private memoryStore: MemoryStore;
  private reflectionEngine: ReflectionEngine;
  private persistenceStore?: PostgresLearningStore | LearningPersistenceStore;
  private brandId: string;
  private idleThresholdMs: number;
  private maxBatchPerSweep: number;

  private activityMap = new Map<string, ThreadActivityRecord>();
  private pendingFeedback = new Map<string, ModerationFeedbackEvent[]>();
  private refineTrigger: AutoRefineTrigger;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private inFlightSweep?: Promise<{ evaluatedCount: number; results: ReflectionResult[] }>;
  private static readonly MAX_PENDING_FEEDBACK_PER_CHAT = 50;

  constructor(options: ReflectionWorkerOptions) {
    this.memoryStore = options.memoryStore;
    this.reflectionEngine = options.reflectionEngine;
    this.persistenceStore = options.persistenceStore;
    this.brandId = options.brandId ?? 'default';
    this.idleThresholdMs = options.idleThresholdMs ?? 15 * 60 * 1000; // 15 mins default
    this.maxBatchPerSweep = options.maxBatchPerSweep ?? 5;
    this.refineTrigger = new AutoRefineTrigger();
  }

  /**
   * Records inbound or outbound message timestamp for a thread.
   */
  recordActivity(chatId: string, timestamp = Date.now()): void {
    const existing = this.activityMap.get(chatId) || {
      chatId,
      lastActivityAt: timestamp,
      lastReflectedAt: 0,
      isProcessing: false
    };

    existing.lastActivityAt = Math.max(existing.lastActivityAt, timestamp);
    this.activityMap.set(chatId, existing);

    // Mirror to Postgres/Supabase store if available
    const pg = this.persistenceStore;
    if (pg && 'updateThreadActivity' in pg && typeof pg.updateThreadActivity === 'function') {
      void pg.updateThreadActivity(this.brandId, chatId, timestamp).catch((err) => {
        console.warn('⚠️ [ReflectionWorker] Postgres thread activity update failed:', describeError(err));
      });
    }

    // Arm turn-interval / implicit-feedback auto-refine trigger from recent messages
    try {
      const recent = this.memoryStore.getMessages(chatId, 8);
      const signals = extractConversationalFeedback(recent);
      this.refineTrigger.recordTurn(chatId, signals);
    } catch {
      // Best-effort turn signal extraction; never block inbound activity recording
    }
  }

  /** WA-018: read-only snapshot of a thread's activity record (watermark introspection). */
  getThreadActivity(chatId: string): ThreadActivityRecord | undefined {
    const record = this.activityMap.get(chatId);
    return record ? { ...record } : undefined;
  }

  /**
   * Enqueues explicit human moderation feedback for the next reflection cycle.
   */
  recordModerationFeedback(feedback: ModerationFeedbackEvent): void {
    const list = this.pendingFeedback.get(feedback.chatId) || [];
    list.push(feedback);
    // WA-018: bound the durable backlog; the oldest entry is dropped loudly, never silently.
    if (list.length > ReflectionWorker.MAX_PENDING_FEEDBACK_PER_CHAT) {
      console.warn('⚠️ [ReflectionWorker] Feedback backlog full for a chat; dropping oldest entry');
      list.splice(0, list.length - ReflectionWorker.MAX_PENDING_FEEDBACK_PER_CHAT);
    }
    this.pendingFeedback.set(feedback.chatId, list);
    this.recordActivity(feedback.chatId, Date.now());

    // Mirror to Postgres/Supabase store if available
    const pg = this.persistenceStore;
    if (pg && 'recordModerationFeedback' in pg && typeof pg.recordModerationFeedback === 'function') {
      void pg.recordModerationFeedback({ ...feedback, brandId: this.brandId }).catch((err) => {
        console.warn('⚠️ [ReflectionWorker] Postgres moderation feedback save failed:', describeError(err));
      });
    }
  }

  /**
   * Sweeps threads that have exceeded the idle threshold (cold threads) or have explicit feedback.
   */
  async sweepColdThreads(): Promise<{ evaluatedCount: number; results: ReflectionResult[] }> {
    // WA-018: single-flight. A tick that arrives while a sweep is still running skips
    // instead of stacking overlapping evaluations and contending for the model.
    if (this.inFlightSweep) {
      console.warn('⚠️ [ReflectionWorker] Sweep skipped: previous sweep still in flight');
      return { evaluatedCount: 0, results: [] };
    }
    this.inFlightSweep = this.sweepColdThreadsInner();
    try {
      return await this.inFlightSweep;
    } finally {
      this.inFlightSweep = undefined;
    }
  }

  private async sweepColdThreadsInner(): Promise<{ evaluatedCount: number; results: ReflectionResult[] }> {
    const now = Date.now();
    const candidates: string[] = [];

    // Check Postgres/Supabase store for cold threads first if available
    const pg = this.persistenceStore;
    if (pg && 'getColdThreads' in pg && typeof pg.getColdThreads === 'function') {
      try {
        const pgCandidates = await pg.getColdThreads(this.brandId, this.idleThresholdMs, this.maxBatchPerSweep);
        for (const c of pgCandidates) {
          if (!this.activityMap.get(c)?.isProcessing) {
            candidates.push(c);
          }
        }
      } catch (err: unknown) {
        console.warn('⚠️ [ReflectionWorker] Failed to query cold threads from Postgres:', describeError(err));
      }
    }

    const results: ReflectionResult[] = [];
    const claimedRuns = new Map<string, { reason: string; generationVersion: number }>();

    if (candidates.length === 0) {
      for (const [chatId, record] of this.activityMap.entries()) {
        if (record.isProcessing) continue;

        const isCold = (now - record.lastActivityAt) >= this.idleThresholdMs;
        const hasUnreflectedMessages = record.lastActivityAt > record.lastReflectedAt;
        const hasFeedback = (this.pendingFeedback.get(chatId)?.length ?? 0) > 0;
        const claimed = hasUnreflectedMessages ? this.refineTrigger.tryClaimRound(chatId, now) : null;

        if ((isCold && hasUnreflectedMessages) || hasFeedback || claimed) {
          candidates.push(chatId);
          if (claimed) claimedRuns.set(chatId, claimed);
          if (candidates.length >= this.maxBatchPerSweep) break;
        }
      }
    }

    for (const chatId of candidates) {
      const claimed = claimedRuns.get(chatId);
      const res = await this.reflectOnThread(chatId, claimed ? claimed.reason : 'idle_sweep');
      if (claimed) {
        this.refineTrigger.finishRound(chatId, claimed.generationVersion, Boolean(res));
      }
      if (res) results.push(res);
    }

    // Prune stale reflected activity records to prevent unbounded memory growth
    const retentionThreshold = now - 24 * 60 * 60 * 1000;
    for (const [chatId, record] of this.activityMap.entries()) {
      if (record.isProcessing) continue;
      if (
        record.lastActivityAt < retentionThreshold &&
        record.lastReflectedAt >= record.lastActivityAt &&
        (!this.pendingFeedback.has(chatId) || (this.pendingFeedback.get(chatId)?.length ?? 0) === 0)
      ) {
        this.activityMap.delete(chatId);
      }
    }

    return {
      evaluatedCount: results.length,
      results
    };
  }

  /**
   * Evaluates a single conversation thread asynchronously.
   */
  async reflectOnThread(chatId: string, reason: string): Promise<ReflectionResult | null> {
    const record = this.activityMap.get(chatId) || {
      chatId,
      lastActivityAt: Date.now(),
      lastReflectedAt: 0,
      isProcessing: false
    };

    if (record.isProcessing) {
      return null;
    }

    record.isProcessing = true;
    this.activityMap.set(chatId, record);

    try {
      // 1. Fetch recent messages
      const messages = this.memoryStore.getMessages(chatId, 30);
      if (messages.length === 0) {
        record.isProcessing = false;
        return null;
      }

      // 2. Snapshot pending moderation feedback WITHOUT consuming it. The snapshot is only
      // acknowledged after a successful evaluation, so a failure keeps it for the retry and
      // feedback arriving during the evaluation is never accidentally acknowledged.
      const localSnapshot = [...(this.pendingFeedback.get(chatId) || [])];
      let feedback = [...localSnapshot];

      const pg = this.persistenceStore;
      if (pg && 'getUnreflectedFeedback' in pg && typeof pg.getUnreflectedFeedback === 'function') {
        try {
          const pgFeedback = await pg.getUnreflectedFeedback(chatId, this.brandId);
          if (pgFeedback.length > 0) {
            feedback = [...feedback, ...pgFeedback];
          }
        } catch (err) {
          console.warn('⚠️ [ReflectionWorker] getUnreflectedFeedback failed:', describeError(err));
        }
      }

      // 3. Run high-reasoning reflection in background
      const result = await this.reflectionEngine.evaluateThread({
        chatId,
        messages,
        moderationFeedback: feedback
      });

      // WA-018: acknowledge exactly what was evaluated. Wall-clock completion would ack
      // messages that arrived during the evaluation without ever being reflected on.
      const evaluatedUpTo = messages.reduce((max, m) => Math.max(max, m.timestamp), 0);
      record.lastReflectedAt = evaluatedUpTo;

      // The evaluation committed: acknowledge only the snapshotted local feedback.
      if (localSnapshot.length > 0) {
        const current = this.pendingFeedback.get(chatId) || [];
        const remaining = current.slice(localSnapshot.length);
        if (remaining.length > 0) {
          this.pendingFeedback.set(chatId, remaining);
        } else {
          this.pendingFeedback.delete(chatId);
        }
      }

      // 4. Record reflection in Postgres/Supabase store if available
      if (pg && 'saveReflectionRun' in pg && typeof pg.saveReflectionRun === 'function') {
        try {
          await pg.saveReflectionRun({
            brandId: this.brandId,
            chatId,
            triggerReason: reason,
            inputMessageCount: messages.length,
            selfCorrectionsCount: result.selfCorrectionsDetected,
            rulesAdded: result.rulesAdded,
            factsAdded: result.factsAdded,
            summary: result.summary,
            createdAt: Date.now()
          });
        } catch (err) {
          console.warn('⚠️ [ReflectionWorker] Postgres saveReflectionRun failed:', describeError(err));
        }

        if ('markFeedbackReflected' in pg && typeof pg.markFeedbackReflected === 'function') {
          await pg.markFeedbackReflected(chatId, this.brandId).catch((err) => {
            console.warn('⚠️ [ReflectionWorker] markFeedbackReflected failed:', describeError(err));
          });
        }
        if ('markThreadReflected' in pg && typeof pg.markThreadReflected === 'function') {
          await pg.markThreadReflected(this.brandId, chatId, record.lastReflectedAt).catch((err) => {
            console.warn('⚠️ [ReflectionWorker] markThreadReflected failed:', describeError(err));
          });
        }
      }

      return result;
    } catch (err: unknown) {
      logEvent('warn', 'reflection_failed', { chat: hashChatId(chatId), reason, error: describeError(err) });
      return null;
    } finally {
      record.isProcessing = false;
    }
  }

  /**
   * Starts periodic timer for background sweep.
   */
  startPeriodicSweep(intervalMs = 60_000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      this.sweepColdThreads().catch((err) => {
        console.warn('⚠️ [ReflectionWorker] Periodic sweep error:', describeError(err));
      });
    }, intervalMs);
  }

  /**
   * Stops periodic timer and drains any in-flight sweep before returning.
   */
  async stopPeriodicSweep(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    if (this.inFlightSweep) {
      await this.inFlightSweep.catch((err) => {
        console.warn('⚠️ [ReflectionWorker] In-flight sweep failed during shutdown:', describeError(err));
      });
    }
  }
}
