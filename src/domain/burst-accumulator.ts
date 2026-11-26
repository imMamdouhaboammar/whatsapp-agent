import type { ChatMessage, QuotedMessageInfo } from './types';
import { describeError, hashChatId, logEvent } from '../observability/safe-log';

export interface FusedBurst {
  chatId: string;
  messages: ChatMessage[];
  fusedText: string;
  sender: string;
  senderName?: string;
  timestamp: number;
  lastMessageId: string;
  quotedMessage?: QuotedMessageInfo;
  replyToId?: string;
}

export interface BurstAccumulatorOptions {
  windowMs?: number;
  debounceMs?: number;
  maxBurstMessages?: number;
  maxWaitMs?: number;
  onBurst?: (burst: FusedBurst) => Promise<void> | void;
  onFlush?: (burst: FusedBurst) => Promise<void> | void;
}

export interface DrainOptions {
  /** Upper bound on how long drain waits for already-started callbacks. */
  deadlineMs?: number;
}

export interface DrainResult {
  /** True when every buffered burst was flushed and every started callback finished. */
  completed: boolean;
  /** Chats whose callback was still running when the deadline elapsed. */
  inFlightChats: string[];
}

export class BurstAccumulator {
  private windowMs: number;
  private maxBurstMessages: number;
  private onBurstCallback: (burst: FusedBurst) => Promise<void> | void;
  private buffers = new Map<string, ChatMessage[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<Promise<void>, string>();
  private intakeStopped = false;

  constructor(options: BurstAccumulatorOptions) {
    this.windowMs = options.windowMs ?? options.debounceMs ?? 2000;
    this.maxBurstMessages = options.maxBurstMessages ?? 6;
    this.onBurstCallback = options.onBurst ?? options.onFlush ?? (() => {});
  }

  /**
   * Pushes a new inbound message into the chat's burst window.
   * Returns false when intake has been stopped (shutdown in progress): the
   * caller keeps ownership of the message's durable job and a later recovery
   * pass will drive it, so rejecting here never loses work.
   */
  push(msg: ChatMessage): boolean {
    if (this.intakeStopped) return false;
    const chatId = msg.chatId;
    const current = this.buffers.get(chatId) ?? [];
    current.push(msg);
    this.buffers.set(chatId, current);

    // Cancel existing debounce timer for this chat
    if (this.timers.has(chatId)) {
      clearTimeout(this.timers.get(chatId));
      this.timers.delete(chatId);
    }

    // If buffer reaches max messages, flush immediately
    if (current.length >= this.maxBurstMessages) {
      void this.flush(chatId);
      return true;
    }

    // Set debounce timer
    const timer = setTimeout(() => {
      void this.flush(chatId);
    }, this.windowMs);

    this.timers.set(chatId, timer);
    return true;
  }

  /** Stops accepting new messages. Buffered and in-flight work is unaffected. */
  stopIntake(): void {
    this.intakeStopped = true;
  }

  /** Number of debounce timers still armed (observability for shutdown). */
  get timerCount(): number {
    return this.timers.size;
  }

  /** Number of callbacks currently running (observability for shutdown). */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Chats with a callback currently running. */
  get inFlightChats(): string[] {
    return Array.from(new Set(this.inFlight.values()));
  }

  /**
   * Flushes and delivers the accumulated burst for a chat
   */
  async flush(chatId: string): Promise<FusedBurst | null> {
    if (this.timers.has(chatId)) {
      clearTimeout(this.timers.get(chatId));
      this.timers.delete(chatId);
    }

    const messages = this.buffers.get(chatId);
    if (!messages || messages.length === 0) {
      this.buffers.delete(chatId);
      return null;
    }

    this.buffers.delete(chatId);

    // Combine texts into one coherent multi-line turn
    const textLines = messages
      .map((m) => m.text?.trim())
      .filter((t) => Boolean(t) && t !== '[رسالة]');

    const fusedText = textLines.join('\n');
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return null;

    // Preserve any quoted message found in the burst (preferring the latest)
    let quotedMessage: QuotedMessageInfo | undefined = undefined;
    let replyToId: string | undefined = undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (!candidate) continue;
      if (candidate.quotedMessage) {
        quotedMessage = candidate.quotedMessage;
        replyToId = candidate.replyToId || quotedMessage?.id;
        break;
      } else if (candidate.replyToId) {
        replyToId = candidate.replyToId;
        break;
      }
    }

    const burst: FusedBurst = {
      chatId,
      messages,
      fusedText: fusedText || lastMsg.text,
      sender: lastMsg.sender,
      senderName: lastMsg.senderName,
      timestamp: lastMsg.timestamp,
      lastMessageId: lastMsg.id,
      quotedMessage,
      replyToId
    };

    const callback = (async () => {
      try {
        await this.onBurstCallback(burst);
      } catch (err: unknown) {
        logEvent('error', 'burst_callback_error', { chat: hashChatId(chatId), error: describeError(err) });
      }
    })();
    this.inFlight.set(callback, chatId);
    try {
      await callback;
    } finally {
      this.inFlight.delete(callback);
    }

    return burst;
  }

  /**
   * Returns whether a chat has messages currently accumulating
   */
  hasPending(chatId: string): boolean {
    return (this.buffers.get(chatId)?.length ?? 0) > 0;
  }

  /**
   * Flushes every buffered burst, then waits for callbacks that were already
   * running (including ones started before this call) until they finish or
   * the deadline elapses. Idempotent: a second call while the first is still
   * settling observes the same in-flight set.
   */
  async drain(options: DrainOptions = {}): Promise<DrainResult> {
    // Start every pending flush concurrently; flush registers its callback in
    // the in-flight set synchronously before its first await, so by the time
    // these promises exist the tracking below observes every started callback,
    // including ones started before this drain call.
    const chatIds = Array.from(this.buffers.keys());
    const flushes = chatIds.map((chatId) => this.flush(chatId));
    const allSettled = Promise.allSettled(flushes);

    let timedOut = false;
    if (options.deadlineMs === undefined) {
      await allSettled;
    } else {
      const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), options.deadlineMs));
      timedOut = (await Promise.race([allSettled.then(() => 'done' as const), deadline])) === 'timeout';
    }

    const inFlightChats = timedOut ? this.inFlightChats : [];
    this.destroy();
    return { completed: !timedOut, inFlightChats };
  }

  /**
   * Cleans all active timers
   */
  destroy() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.buffers.clear();
  }
}
