export type SSEEventType =
  | 'state_change'
  | 'new_message'
  | 'message_status'
  | 'message_delivery_failed'
  | 'unsupported_content'
  | 'send_intent'
  | 'agent_thought'
  | 'new_draft'
  | 'draft_updated'
  | 'chat_updated'
  | 'message_reaction'
  | 'dossier_updated'
  | 'chat_deleted'
  | 'messages_cleared'
  | 'workspace_reset';

export interface SSEMessage {
  event: SSEEventType;
  data: any;
}

export type SSEDisconnectReason = 'overflow' | 'write_error' | 'closed';

export interface SSEStreamSubscriberOptions {
  /** Per-subscriber bound on queued-but-unwritten messages. */
  maxQueueSize?: number;
  /** Invoked when the broadcaster disconnects this subscriber. */
  onDisconnect?: (reason: SSEDisconnectReason) => void;
}

interface StreamSubscriber {
  writer: (msg: SSEMessage) => Promise<void>;
  queue: SSEMessage[];
  draining: boolean;
  disconnected: boolean;
  maxQueueSize: number;
  onDisconnect?: (reason: SSEDisconnectReason) => void;
}

const DEFAULT_MAX_CLIENTS = 50;
const DEFAULT_MAX_QUEUED_PER_CLIENT = 256;

export class SSEBroadcaster {
  private subscribers: Set<(msg: SSEMessage) => void> = new Set();
  private streamSubscribers: Set<StreamSubscriber> = new Set();
  private readonly maxClients: number;
  private readonly maxQueuedPerClient: number;

  constructor(options: { maxClients?: number; maxQueuedPerClient?: number } = {}) {
    this.maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
    this.maxQueuedPerClient = options.maxQueuedPerClient ?? DEFAULT_MAX_QUEUED_PER_CLIENT;
  }

  /** Fire-and-forget subscription for internal (non-stream) consumers. */
  subscribe(callback: (msg: SSEMessage) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * WA-019: bounded subscription for real SSE streams. Writes are serialized
   * and awaited per subscriber; pending messages are capped at maxQueueSize
   * and a subscriber that falls behind is disconnected (it reconnects and
   * resyncs from the authoritative snapshot). Returns null at capacity.
   */
  subscribeStream(
    writer: (msg: SSEMessage) => Promise<void>,
    options: SSEStreamSubscriberOptions = {}
  ): (() => void) | null {
    if (this.streamSubscribers.size >= this.maxClients) {
      return null;
    }
    const sub: StreamSubscriber = {
      writer,
      queue: [],
      draining: false,
      disconnected: false,
      maxQueueSize: options.maxQueueSize ?? this.maxQueuedPerClient,
      onDisconnect: options.onDisconnect
    };
    this.streamSubscribers.add(sub);
    return () => {
      this.removeStream(sub);
    };
  }

  get maxStreamClients(): number {
    return this.maxClients;
  }

  get streamClientCount(): number {
    return this.streamSubscribers.size;
  }

  broadcast(event: SSEEventType, data: any) {
    const payload: SSEMessage = { event, data };
    for (const sub of this.subscribers) {
      try {
        sub(payload);
      } catch {
        this.subscribers.delete(sub);
      }
    }
    for (const sub of this.streamSubscribers) {
      if (sub.disconnected) continue;
      if (sub.queue.length >= sub.maxQueueSize) {
        this.disconnectStream(sub, 'overflow');
        continue;
      }
      sub.queue.push(payload);
      void this.drain(sub);
    }
  }

  private async drain(sub: StreamSubscriber): Promise<void> {
    if (sub.draining) return;
    sub.draining = true;
    try {
      while (sub.queue.length > 0 && !sub.disconnected) {
        const msg = sub.queue[0];
        try {
          await sub.writer(msg);
          sub.queue.shift();
        } catch {
          this.disconnectStream(sub, 'write_error');
          return;
        }
      }
    } finally {
      sub.draining = false;
    }
  }

  private removeStream(sub: StreamSubscriber): void {
    sub.disconnected = true;
    sub.queue.length = 0;
    this.streamSubscribers.delete(sub);
  }

  private disconnectStream(sub: StreamSubscriber, reason: SSEDisconnectReason): void {
    if (sub.disconnected) return;
    this.removeStream(sub);
    try {
      sub.onDisconnect?.(reason);
    } catch {
      // Disconnect hooks must never break broadcast for other clients.
    }
  }

  get clientCount(): number {
    return this.subscribers.size + this.streamSubscribers.size;
  }

  close(): void {
    this.subscribers.clear();
    // disconnectStream mutates the set; drain via the first element.
    let sub = this.streamSubscribers.values().next().value as StreamSubscriber | undefined;
    while (sub) {
      this.disconnectStream(sub, 'closed');
      sub = this.streamSubscribers.values().next().value as StreamSubscriber | undefined;
    }
  }
}

export { SSEBroadcaster as SSEManager };

