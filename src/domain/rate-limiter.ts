export interface RateLimiterOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  charPerSecond?: number;
  maxMessagesPerMinute?: number;
}

export class HumanRateLimiter {
  private minDelayMs: number;
  private maxDelayMs: number;
  private charPerSecond: number;
  private maxMessagesPerMinute: number;
  private chatSendTimestamps: Map<string, number[]> = new Map();
  private sentMessageHashes: Map<string, number> = new Map();
  private sendQueues: Map<string, Promise<void>> = new Map();

  constructor(options: RateLimiterOptions = {}) {
    this.minDelayMs = options.minDelayMs ?? 1500;
    this.maxDelayMs = options.maxDelayMs ?? 4500;
    this.charPerSecond = options.charPerSecond ?? 30;
    this.maxMessagesPerMinute = options.maxMessagesPerMinute ?? 20;
  }

  /**
   * Calculates realistic human reading + typing delay in milliseconds
   */
  calculateTypingDelay(text: string): number {
    const chars = text?.trim().length || 10;
    const baseTime = (chars / this.charPerSecond) * 1000;
    // Add realistic cognitive pause between 800ms and 2000ms
    const cognitivePause = Math.random() * 1200 + 800;
    const total = baseTime + cognitivePause;
    return Math.min(Math.max(Math.round(total), this.minDelayMs), this.maxDelayMs);
  }

  /**
   * Checks if an outbound message is a duplicate of a recently sent one
   */
  isDuplicate(chatId: string, text: string): boolean {
    const key = `${chatId}:${text.trim().toLowerCase()}`;
    const now = Date.now();
    const lastSent = this.sentMessageHashes.get(key);
    if (lastSent && now - lastSent < 30_000) {
      return true;
    }
    this.sentMessageHashes.set(key, now);
    // Prune old entries
    if (this.sentMessageHashes.size > 1000) {
      for (const [k, time] of this.sentMessageHashes) {
        if (now - time > 60_000) this.sentMessageHashes.delete(k);
      }
    }
    return false;
  }

  /**
   * Checks rate limit threshold for chat
   */
  checkRateLimit(chatId: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (this.chatSendTimestamps.get(chatId) ?? []).filter((t) => t > windowStart);
    if (timestamps.length === 0) {
      this.chatSendTimestamps.delete(chatId);
    } else {
      this.chatSendTimestamps.set(chatId, timestamps);
    }

    if (timestamps.length >= this.maxMessagesPerMinute) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: this.maxMessagesPerMinute - timestamps.length };
  }

  /**
   * Schedules an action inside the per-chat serialized queue
   */
  async enqueue<T>(chatId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.sendQueues.get(chatId) ?? Promise.resolve();

    let result!: T;
    let actionError: any = null;

    const next = previous
      .catch((err) => {
        console.warn(`[HumanRateLimiter] Prior queued action failed for chat ${chatId}:`, err);
      })
      .then(async () => {
        try {
          result = await action();
          const list = this.chatSendTimestamps.get(chatId) ?? [];
          list.push(Date.now());
          this.chatSendTimestamps.set(chatId, list);
        } catch (err) {
          actionError = err;
        }
      })
      .finally(() => {
        if (this.sendQueues.get(chatId) === next) {
          this.sendQueues.delete(chatId);
        }
      });

    this.sendQueues.set(chatId, next);
    await next;

    if (actionError) throw actionError;
    return result;
  }
}
