import type { MemoryStore } from '../domain/memory-store';
import type { DualMemoryManager } from '../domain/learning-memory';
import type { ReflectionEngine, ModerationFeedbackEvent, ReflectionResult } from '../ai/reflection-engine';

export interface ReflectionWorkerOptions {
  memoryStore: MemoryStore;
  memoryManager: DualMemoryManager;
  reflectionEngine: ReflectionEngine;
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
  private idleThresholdMs: number;
  private maxBatchPerSweep: number;

  private activityMap = new Map<string, ThreadActivityRecord>();
  private pendingFeedback = new Map<string, ModerationFeedbackEvent[]>();
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(options: ReflectionWorkerOptions) {
    this.memoryStore = options.memoryStore;
    this.memoryManager = options.memoryManager;
    this.reflectionEngine = options.reflectionEngine;
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
  }

  /**
   * Enqueues explicit human moderation feedback for the next reflection cycle.
   */
  recordModerationFeedback(feedback: ModerationFeedbackEvent): void {
    const list = this.pendingFeedback.get(feedback.chatId) || [];
    list.push(feedback);
    this.pendingFeedback.set(feedback.chatId, list);
    this.recordActivity(feedback.chatId, Date.now());
  }

  /**
   * Sweeps threads that have exceeded the idle threshold (cold threads) or have explicit feedback.
   */
  async sweepColdThreads(): Promise<{ evaluatedCount: number; results: ReflectionResult[] }> {
    const now = Date.now();
    const candidates: string[] = [];

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
      const feedback = this.pendingFeedback.get(chatId) || [];
      this.pendingFeedback.delete(chatId);

      // 3. Run high-reasoning reflection in background
      const result = await this.reflectionEngine.evaluateThread({
        chatId,
        messages,
        moderationFeedback: feedback
      });

      record.lastReflectedAt = Date.now();
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
