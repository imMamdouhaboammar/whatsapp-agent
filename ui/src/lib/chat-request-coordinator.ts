/**
 * WA-020: coordinates in-flight chat-message requests so a stale response can
 * never overwrite the currently selected conversation. Each selection begins a
 * new generation and aborts the previous one; responses are applied only while
 * their token is still current.
 */
export interface ChatRequestToken {
  readonly chatId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
}

export class ChatRequestCoordinator {
  private generation = 0;
  private currentChatId: string | null = null;
  private controller: AbortController | null = null;

  /** Begin a request cycle for `chatId`; aborts and supersedes any previous cycle. */
  begin(chatId: string): ChatRequestToken {
    this.controller?.abort();
    this.controller = new AbortController();
    this.currentChatId = chatId;
    this.generation += 1;
    return { chatId, generation: this.generation, signal: this.controller.signal };
  }

  /** True only while `token` is the latest cycle for the currently selected chat. */
  isCurrent(token: ChatRequestToken): boolean {
    return (
      token.generation === this.generation &&
      token.chatId === this.currentChatId &&
      !token.signal.aborted
    );
  }

  /** Invalidate every outstanding cycle (deselect or unmount). */
  cancelAll(): void {
    this.controller?.abort();
    this.controller = null;
    this.currentChatId = null;
    this.generation += 1;
  }
}
