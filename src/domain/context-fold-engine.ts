import { randomUUID } from 'node:crypto';
import { scrubCredentials } from './learning-memory';
import type { MemoryStore } from './memory-store';
import type { ChatMessage, ContextBudgetStatus, ConversationFold } from './types';
import { evaluateContextBudgetStatus } from './dynamic-context-window';

export interface FoldSummary {
  topic: string;
  summary: string;
  factsExtracted?: string[];
}

export interface FoldSummarizerRequest {
  chatId: string;
  tier: 1 | 2 | 3;
  messages?: ChatMessage[];
  folds?: ConversationFold[];
}

export type FoldSummarizer = (request: FoldSummarizerRequest) => Promise<FoldSummary>;

export interface ContextFoldOptions {
  memoryStore: MemoryStore;
  summarizer: FoldSummarizer;
  now?: () => number;
  keepRecentCount?: number;
  minRawCount?: number;
  idleThresholdMs?: number;
  tier2Threshold?: number;
  tier3Threshold?: number;
}

/**
 * Incrementally folds closed message epochs in the background with multi-tier LSM coalescing.
 * The caller injects its own budgeted summarizer; no model network calls occur here.
 */
export class ContextFoldEngine {
  private now: () => number;
  private keepRecentCount: number;
  private minRawCount: number;
  private idleThresholdMs: number;
  private tier2Threshold: number;
  private tier3Threshold: number;
  private inFlight = new Map<string, Promise<ConversationFold | null>>();
  private inFlightTier1 = new Map<string, Promise<ConversationFold | null>>();
  private inFlightTier2 = new Map<string, Promise<ConversationFold | null>>();
  private queue: Array<{ chatId: string; resolve: (fold: ConversationFold | null) => void }> = [];
  private activeJobs = 0;
  private readonly maxConcurrentJobs = 2;
  private readonly maxQueuedJobs = 64;

  constructor(private options: ContextFoldOptions) {
    this.now = options.now ?? Date.now;
    this.keepRecentCount = Math.max(10, Math.min(15, options.keepRecentCount ?? 10));
    this.minRawCount = Math.max(5, options.minRawCount ?? 15);
    this.idleThresholdMs = Math.max(60_000, options.idleThresholdMs ?? 2 * 60 * 60 * 1000);
    this.tier2Threshold = Math.max(2, Math.min(10, options.tier2Threshold ?? 5));
    this.tier3Threshold = Math.max(2, Math.min(10, options.tier3Threshold ?? 3));
  }

  private candidates(chatId: string): ChatMessage[] {
    const pending = this.options.memoryStore.getUnfoldedMessages(chatId, this.keepRecentCount);
    const first = pending[0];
    if (!first) return [];
    const window: ChatMessage[] = [first];
    for (const item of pending.slice(1, 32)) {
      const tail = window.at(-1);
      if (tail && item.timestamp - tail.timestamp > this.idleThresholdMs) break;
      window.push(item);
    }
    return window;
  }

  async shouldFold(chatId: string): Promise<boolean> {
    const all = this.candidates(chatId);
    const tail = all.at(-1);
    if (!tail) return false;
    const pendingCount = this.options.memoryStore.getUnfoldedMessages(chatId, this.keepRecentCount).length;
    return pendingCount >= this.minRawCount - this.keepRecentCount ||
      tail.timestamp + this.idleThresholdMs < this.now();
  }

  getContextBudgetStatus(chatId: string, modelName?: string): ContextBudgetStatus {
    const uncompressed = this.options.memoryStore.getUnfoldedMessages(chatId, this.keepRecentCount);
    const recent = this.options.memoryStore.getMessages(chatId, this.keepRecentCount);
    const folds = this.options.memoryStore.getFolds(chatId);
    return evaluateContextBudgetStatus({
      chatId,
      modelName,
      recentMessages: recent,
      folds,
      uncompressedCount: uncompressed.length
    });
  }

  async foldChatIncrement(chatId: string): Promise<ConversationFold | null> {
    if (!(await this.shouldFold(chatId))) return null;
    const messages = this.candidates(chatId);
    if (!messages.length) return null;
    // The fold service only sees redacted historical messages.
    const redacted: ChatMessage[] = messages.map(message => ({
      id: message.id,
      chatId: message.chatId,
      sender: message.isFromMe ? 'owner' : 'contact',
      isFromMe: message.isFromMe,
      type: message.type,
      timestamp: message.timestamp,
      text: scrubCredentials(message.text).slice(0, 2000),
      transcription: message.transcription ? scrubCredentials(message.transcription).slice(0, 2000) : undefined
    }));
    const result = await this.options.summarizer({ chatId, tier: 1, messages: redacted });
    if (!result?.topic?.trim() || !result?.summary?.trim()) return null;
    const verifiedFacts = (result.factsExtracted ?? [])
      .filter(fact => typeof fact === 'string')
      .map(fact => scrubCredentials(fact.trim()))
      .filter(fact => fact && !fact.includes('[REDACTED_CREDENTIAL]') &&
        redacted.some(message => message.text.includes(fact) || message.transcription?.includes(fact)))
      .slice(0, 20);
    const firstMessage = messages[0];
    const lastMessage = messages.at(-1);
    if (!firstMessage || !lastMessage) return null;
    const fold: ConversationFold = {
      id: randomUUID(),
      chatId, tier: 1,
      topic: result.topic,
      summary: scrubCredentials(result.summary),
      startMessageId: firstMessage.id,
      endMessageId: lastMessage.id,
      directMessageIds: messages.map(message => message.id),
      sourceFoldIds: [],
      messageCount: messages.length,
      factsExtracted: verifiedFacts,
      createdAt: this.now()
    };
    try {
      this.options.memoryStore.saveFold(fold);
      return this.options.memoryStore.getFold(fold.id) ?? fold;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('already coalesced')) {
        return null;
      }
      throw err;
    }
  }

  coalesceTier1Folds(chatId: string): Promise<ConversationFold | null> {
    const existing = this.inFlightTier1.get(chatId);
    if (existing) return existing;
    const task = this.executeCoalesceTier1(chatId);
    this.inFlightTier1.set(chatId, task);
    return task.finally(() => this.inFlightTier1.delete(chatId));
  }

  private async executeCoalesceTier1(chatId: string): Promise<ConversationFold | null> {
    const pending = this.options.memoryStore.getPendingTier1Folds(chatId, this.tier2Threshold);
    if (pending.length < this.tier2Threshold) return null;
    // Created timestamps can be identical in tests; sort by canonical message timestamps.
    const byOrder = pending.map(item => ({
      fold: item,
      timestamp: this.options.memoryStore.getMessage(chatId, item.startMessageId)?.timestamp
    })).filter((item): item is { fold: ConversationFold; timestamp: number } => item.timestamp !== undefined)
      .toSorted((a, b) => a.timestamp - b.timestamp);
    const selected = byOrder.slice(0, this.tier2Threshold).map(item => item.fold);
    if (selected.length !== this.tier2Threshold) return null;
    const ids = selected.flatMap(item => item.directMessageIds);
    const firstId = ids[0];
    const lastId = ids.at(-1);
    if (!firstId || !lastId) return null;
    // Both generated facts and summaries are treated as untrusted, non-authoritative context.
    const redactedFolds = selected.map(item => ({
      ...item,
      summary: scrubCredentials(item.summary),
      factsExtracted: item.factsExtracted.map(scrubCredentials)
    }));
    const result = await this.options.summarizer({ chatId, tier: 2, folds: redactedFolds });
    if (!result?.topic?.trim() || !result?.summary?.trim()) return null;
    const fold: ConversationFold = {
      id: randomUUID(), chatId, tier: 2,
      topic: result.topic,
      summary: scrubCredentials(result.summary),
      startMessageId: firstId, endMessageId: lastId,
      directMessageIds: ids, sourceFoldIds: selected.map(item => item.id),
      messageCount: ids.length,
      // Tier-two model outputs may synthesize details: retain only validated tier-one facts.
      factsExtracted: [...new Set(selected.flatMap(item => item.factsExtracted))].slice(0, 20),
      createdAt: this.now()
    };
    try {
      this.options.memoryStore.saveFold(fold);
      return this.options.memoryStore.getFold(fold.id) ?? fold;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('already coalesced')) {
        return null;
      }
      throw err;
    }
  }

  coalesceTier2Folds(chatId: string): Promise<ConversationFold | null> {
    const existing = this.inFlightTier2.get(chatId);
    if (existing) return existing;
    const task = this.executeCoalesceTier2(chatId);
    this.inFlightTier2.set(chatId, task);
    return task.finally(() => this.inFlightTier2.delete(chatId));
  }

  private async executeCoalesceTier2(chatId: string): Promise<ConversationFold | null> {
    const pending = this.options.memoryStore.getPendingTier2Folds(chatId, this.tier3Threshold);
    if (pending.length < this.tier3Threshold) return null;
    const byOrder = pending.map(item => ({
      fold: item,
      timestamp: this.options.memoryStore.getMessage(chatId, item.startMessageId)?.timestamp
    })).filter((item): item is { fold: ConversationFold; timestamp: number } => item.timestamp !== undefined)
      .toSorted((a, b) => a.timestamp - b.timestamp);
    const selected = byOrder.slice(0, this.tier3Threshold).map(item => item.fold);
    if (selected.length !== this.tier3Threshold) return null;
    const ids = selected.flatMap(item => item.directMessageIds);
    const firstId = ids[0];
    const lastId = ids.at(-1);
    if (!firstId || !lastId) return null;
    const redactedFolds = selected.map(item => ({
      ...item,
      summary: scrubCredentials(item.summary),
      factsExtracted: item.factsExtracted.map(scrubCredentials)
    }));
    const result = await this.options.summarizer({ chatId, tier: 3, folds: redactedFolds });
    if (!result?.topic?.trim() || !result?.summary?.trim()) return null;
    const fold: ConversationFold = {
      id: randomUUID(), chatId, tier: 3,
      topic: result.topic,
      summary: scrubCredentials(result.summary),
      startMessageId: firstId, endMessageId: lastId,
      directMessageIds: ids, sourceFoldIds: selected.map(item => item.id),
      messageCount: ids.length,
      factsExtracted: [...new Set(selected.flatMap(item => item.factsExtracted))].slice(0, 20),
      createdAt: this.now()
    };
    try {
      this.options.memoryStore.saveFold(fold);
      return this.options.memoryStore.getFold(fold.id) ?? fold;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('already coalesced')) {
        return null;
      }
      throw err;
    }
  }

  triggerFoldCheck(chatId: string): Promise<ConversationFold | null> {
    const existing = this.inFlight.get(chatId);
    if (existing) return existing;
    if (this.queue.length >= this.maxQueuedJobs) return Promise.resolve(null);
    let resolveJob!: (fold: ConversationFold | null) => void;
    const task = new Promise<ConversationFold | null>(resolve => { resolveJob = resolve; });
    this.inFlight.set(chatId, task);
    this.queue.push({ chatId, resolve: resolveJob });
    this.drain();
    return task;
  }

  private drain(): void {
    while (this.activeJobs < this.maxConcurrentJobs && this.queue.length) {
      const job = this.queue.shift();
      if (!job) break;
      const { chatId, resolve } = job;
      this.activeJobs++;
      void (async () => {
        try {
          const fold = await this.foldChatIncrement(chatId);
          const milestone = await this.coalesceTier1Folds(chatId);
          const archival = await this.coalesceTier2Folds(chatId);
          return archival ?? milestone ?? fold;
        } catch {
          // A model or stale-lineage failure must never block replies.
          return null;
        }
      })().then(resolve, () => resolve(null)).finally(() => {
        this.activeJobs--;
        this.inFlight.delete(chatId);
        this.drain();
      });
    }
  }
}
