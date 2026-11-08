/**
 * Serializes active planner turns for one brand/contact within this process.
 * Promise tails are removed after the last turn, so inactive conversations
 * consume no retained coordinator state.
 */
export class ConversationCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(brandId: string, contactId: string, task: () => Promise<T>): Promise<T> {
    const key = String(brandId.length) + ':' + brandId + contactId;
    const previous = this.tails.get(key);
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);

    try {
      await previous;
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }

  get activeConversations(): number {
    return this.tails.size;
  }
}
