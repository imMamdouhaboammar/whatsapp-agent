import type { ChatMessage, QuotedMessageInfo } from './types';

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

export class BurstAccumulator {
  private windowMs: number;
  private maxBurstMessages: number;
  private onBurstCallback: (burst: FusedBurst) => Promise<void> | void;
  private buffers = new Map<string, ChatMessage[]>();
  private timers = new Map<string, any>();

  constructor(options: BurstAccumulatorOptions) {
    this.windowMs = options.windowMs ?? options.debounceMs ?? 2000;
    this.maxBurstMessages = options.maxBurstMessages ?? 6;
    this.onBurstCallback = options.onBurst ?? options.onFlush ?? (() => {});
  }

  /**
   * Pushes a new inbound message into the chat's burst window
   */
  push(msg: ChatMessage) {
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
      return;
    }

    // Set debounce timer
    const timer = setTimeout(() => {
      void this.flush(chatId);
    }, this.windowMs);

    this.timers.set(chatId, timer);
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

    // Preserve any quoted message found in the burst (preferring the latest)
    let quotedMessage: QuotedMessageInfo | undefined = undefined;
    let replyToId: string | undefined = undefined;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].quotedMessage) {
        quotedMessage = messages[i].quotedMessage;
        replyToId = messages[i].replyToId || quotedMessage.id;
        break;
      } else if (messages[i].replyToId) {
        replyToId = messages[i].replyToId;
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

    try {
      await this.onBurstCallback(burst);
    } catch (err: any) {
      console.error(`❌ [BurstAccumulator] Error in burst callback for ${chatId}:`, err.message);
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
