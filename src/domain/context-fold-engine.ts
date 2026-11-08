import { randomUUID } from 'node:crypto';
import { scrubCredentials } from './learning-memory';
import type { MemoryStore } from './memory-store';
import type { ChatMessage, ConversationFold } from './types';

export interface FoldSummary {
  topic: string;
  summary: string;
  factsExtracted?: string[];
}

export interface FoldSummarizerRequest {
  chatId: string;
  tier: 1 | 2;
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
}

/**
 * Incrementally folds closed message epochs in the background.
 * The caller injects its own budgeted summarizer; no model network calls occur here.
 */
export class ContextFoldEngine {
  private now: () => number;
  private keepRecentCount: number;
  private minRawCount: number;
  private idleThresholdMs: number;
  private tier2Threshold: number;
  private inFlight = new Map<string, Promise<ConversationFold | null>>();
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
  }

  private candidates(chatId: string): ChatMessage[] {
    const pending = this.options.memoryStore.getUnfoldedMessages(chatId, this.keepRecentCount);
    if (!pending.length) return [];
    const window: ChatMessage[] = [pending[0]!];
    for (const item of pending.slice(1, 32)) {
      if (item.timestamp - window.at(-1)!.timestamp > this.idleThresholdMs) break;
      window.push(item);
    }
    return window;
  }

  async shouldFold(chatId: string): Promise<boolean> {
    const all = this.candidates(chatId);
    if (!all.length) return false;
    const pendingCount = this.options.memoryStore.getUnfoldedMessages(chatId, this.keepRecentCount).length;
    return pendingCount >= this.minRawCount - this.keepRecentCount ||
      all.at(-1)!.timestamp + this.idleThresholdMs < this.now();
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
    const fold: ConversationFold = {
      id: randomUUID(),
      chatId, tier: 1,
      topic: result.topic,
      summary: scrubCredentials(result.summary),
      startMessageId: messages[0]!.id,
      endMessageId: messages.at(-1)!.id,
      directMessageIds: messages.map(message => message.id),
      sourceFoldIds: [],
      messageCount: messages.length,
      factsExtracted: verifiedFacts,
      createdAt: this.now()
    };
    this.options.memoryStore.saveFold(fold);
    return this.options.memoryStore.getFold(fold.id)!;
  }

  async coalesceTier1Folds(chatId: string): Promise<ConversationFold | null> {
    const source = this.options.memoryStore.getFolds(chatId, 1);
    const used = new Set(this.options.memoryStore.getFolds(chatId, 2).flatMap(item => item.sourceFoldIds));
    const pending = source.filter(item => !used.has(item.id));
    if (pending.length < this.tier2Threshold) return null;
    // Created timestamps can be identical in tests; sort by canonical message timestamps.
    const byOrder = pending.map(item => ({
      fold: item,
      timestamp: this.options.memoryStore.getMessage(chatId, item.startMessageId)?.timestamp
    })).filter(item => item.timestamp !== undefined)
      .sort((a, b) => a.timestamp! - b.timestamp!);
    const selected = byOrder.slice(0, this.tier2Threshold).map(item => item.fold);
    if (selected.length !== this.tier2Threshold) return null;
    const ids = selected.flatMap(item => item.directMessageIds);
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
      startMessageId: ids[0]!, endMessageId: ids.at(-1)!,
      directMessageIds: ids, sourceFoldIds: selected.map(item => item.id),
      messageCount: ids.length,
      // Tier-two model outputs may synthesize details: retain only validated tier-one facts.
      factsExtracted: [...new Set(selected.flatMap(item => item.factsExtracted))].slice(0, 20),
      createdAt: this.now()
    };
    this.options.memoryStore.saveFold(fold);
    return this.options.memoryStore.getFold(fold.id)!;
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
      const { chatId, resolve } = this.queue.shift()!;
      this.activeJobs++;
      void (async () => {
        try {
          const fold = await this.foldChatIncrement(chatId);
          const milestone = await this.coalesceTier1Folds(chatId);
          return milestone ?? fold;
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
