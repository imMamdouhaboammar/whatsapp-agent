import type { BaileysEventMap } from '@whiskeysockets/baileys';

type Listeners<M> = {
  [K in keyof M]?: Array<(payload: M[K]) => void | Promise<void>>;
};

/** A deterministic event port: callback promises are awaited by the test driver. */
export class FakeSocketEvents<M = BaileysEventMap> {
  private readonly listeners: Listeners<M> = {};
  readonly removedEvents: Array<keyof M> = [];

  on<K extends keyof M>(event: K, callback: (payload: M[K]) => void): void {
    const callbacks: Array<(payload: M[K]) => void | Promise<void>> = this.listeners[event] ?? [];
    callbacks.push(callback);
    this.listeners[event] = callbacks;
  }

  removeAllListeners(event: keyof M): void {
    this.removedEvents.push(event);
    delete this.listeners[event];
  }

  snapshot<K extends keyof M>(event: K): Array<(payload: M[K]) => void | Promise<void>> {
    return [...(this.listeners[event] ?? [])];
  }

  async emit<K extends keyof M>(event: K, payload: M[K]): Promise<void> {
    for (const callback of this.snapshot(event)) await callback(payload);
  }
}
