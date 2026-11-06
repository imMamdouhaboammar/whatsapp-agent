export type SSEEventType =
  | 'state_change'
  | 'new_message'
  | 'message_status'
  | 'agent_thought'
  | 'new_draft'
  | 'draft_updated'
  | 'chat_updated'
  | 'message_reaction'
  | 'dossier_updated';

export interface SSEMessage {
  event: SSEEventType;
  data: any;
}

export class SSEBroadcaster {
  private subscribers: Set<(msg: SSEMessage) => void> = new Set();

  subscribe(callback: (msg: SSEMessage) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
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
  }

  get clientCount(): number {
    return this.subscribers.size;
  }
}
