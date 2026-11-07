import type { MemoryStore } from '../domain/memory-store';
import type { DualMemoryManager, LearningPersistenceStore } from '../domain/learning-memory';
import type { ReflectionEngine, ModerationFeedbackEvent, ReflectionResult } from '../ai/reflection-engine';
import type { PostgresLearningStore } from '../persistence/postgres/learning-store';

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
  private memoryManager: DualMemoryManager;
  private reflectionEngine: ReflectionEngine;
  private persistenceStore?: PostgresLearningStore | LearningPersistenceStore;
  private brandId: string;
  private idleThresholdMs: number;
  private maxBatchPerSweep: number;

  private activityMap = new Map<string, ThreadActivityRecord>();
  private pendingFeedback = new Map<string, ModerationFeedbackEvent[]>();
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(options: ReflectionWorkerOptions) {
    this.memoryStore = options.memoryStore;
    this.memoryManager = options.memoryManager;
    this.reflectionEngine = options.reflectionEngine;
    this.persistenceStore = options.persistenceStore;
    this.brandId = options.brandId ?? 'default';
    this.idleThresholdMs = options.idleThresholdMs ?? 15 * 60 * 1000; // 15 mins default
    this.maxBatchPerSweep = options.maxBatchPerSweep ?? 5;
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
    const pg = this.persistenceStore as PostgresLearningStore | undefined;
    if (pg && typeof pg.updateThreadActivity === 'function') {
      void pg.updateThreadActivity(this.brandId, chatId, timestamp).catch((err) => {
        console.warn('⚠️ [ReflectionWorker] Postgres thread activity update failed:', err.message);
      });
    }
  }

  /**
   * Enqueues explicit human moderation feedback for the next reflection cycle.
   */
  recordModerationFeedback(feedback: ModerationFeedbackEvent): void {
    const list = this.pendingFeedback.get(feedback.chatId) || [];
    list.push(feedback);
    this.pendingFeedback.set(feedback.chatId, list);
    this.recordActivity(feedback.chatId, Date.now());

    // Mirror to Postgres/Supabase store if available
    const pg = this.persistenceStore as PostgresLearningStore | undefined;
    if (pg && typeof pg.recordModerationFeedback === 'function') {
      void pg.recordModerationFeedback({ ...feedback, brandId: this.brandId }).catch((err) => {
        console.warn('⚠️ [ReflectionWorker] Postgres moderation feedback save failed:', err.message);
      });
    }
  }

  /**
   * Sweeps threads that have exceeded the idle threshold (cold threads) or have explicit feedback.
   */
  async sweepColdThreads(): Promise<{ evaluatedCount: number; results: ReflectionResult[] }> {
    const now = Date.now();
    const candidates: string[] = [];

    // Check Postgres/Supabase store for cold threads first if available
    const pg = this.persistenceStore as PostgresLearningStore | undefined;
    if (pg && typeof pg.getColdThreads === 'function') {
      try {
        const pgCandidates = await pg.getColdThreads(this.brandId, this.idleThresholdMs, this.maxBatchPerSweep);
        for (const c of pgCandidates) {
          if (!this.activityMap.get(c)?.isProcessing) {
            candidates.push(c);
          }
        }
      } catch (err: any) {
        console.warn('⚠️ [ReflectionWorker] Failed to query cold threads from Postgres:', err.message);
      }
    }

    if (candidates.length === 0) {
      for (const [chatId, record] of this.activityMap.entries()) {
        if (record.isProcessing) continue;

        const isCold = (now - record.lastActivityAt) >= this.idleThresholdMs;
        const hasUnreflectedMessages = record.lastActivityAt > record.lastReflectedAt;
        const hasFeedback = (this.pendingFeedback.get(chatId)?.length ?? 0) > 0;

        if ((isCold && hasUnreflectedMessages) || hasFeedback) {
          candidates.push(chatId);
          if (candidates.length >= this.maxBatchPerSweep) break;
        }
      }
    }

    const results: ReflectionResult[] = [];
    for (const chatId of candidates) {
      const res = await this.reflectOnThread(chatId, 'idle_sweep');
      if (res) results.push(res);
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

      // 2. Fetch pending moderation feedback
      let feedback = this.pendingFeedback.get(chatId) || [];
      this.pendingFeedback.delete(chatId);

      const pg = this.persistenceStore as PostgresLearningStore | undefined;
      if (pg && typeof pg.getUnreflectedFeedback === 'function') {
        try {
          const pgFeedback = await pg.getUnreflectedFeedback(chatId);
          if (pgFeedback.length > 0) {
            feedback = [...feedback, ...pgFeedback];
          }
        } catch (err) {
          console.warn('⚠️ [ReflectionWorker] getUnreflectedFeedback failed:', err instanceof Error ? err.message : String(err));
        }
      }

      // 3. Run high-reasoning reflection in background
      const result = await this.reflectionEngine.evaluateThread({
        chatId,
        messages,
        moderationFeedback: feedback
      });

      record.lastReflectedAt = Date.now();

      // 4. Record reflection in Postgres/Supabase store if available
      if (pg && typeof pg.saveReflectionRun === 'function') {
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
        }).catch((err) => {
          console.warn('⚠️ [ReflectionWorker] Postgres saveReflectionRun failed:', err.message);
        });

        if (typeof pg.markFeedbackReflected === 'function') {
          await pg.markFeedbackReflected(chatId).catch((err) => {
            console.warn('⚠️ [ReflectionWorker] markFeedbackReflected failed:', err instanceof Error ? err.message : String(err));
          });
        }
        if (typeof pg.markThreadReflected === 'function') {
          await pg.markThreadReflected(this.brandId, chatId, record.lastReflectedAt).catch((err) => {
            console.warn('⚠️ [ReflectionWorker] markThreadReflected failed:', err instanceof Error ? err.message : String(err));
          });
        }
      }

      return result;
    } catch (err: any) {
      console.warn(`⚠️ [ReflectionWorker] Failed reflection for ${chatId} (${reason}):`, err.message);
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
        console.warn('⚠️ [ReflectionWorker] Periodic sweep error:', err.message);
      });
    }, intervalMs);
  }

  /**
   * Stops periodic timer.
   */
  stopPeriodicSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }
}
