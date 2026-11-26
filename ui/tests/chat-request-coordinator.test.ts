import { describe, expect, it } from 'bun:test';
import { ChatRequestCoordinator } from '../src/lib/chat-request-coordinator';
import { api } from '../src/api/client';

describe('WA-020 stale chat requests', () => {
  it('supersedes the previous chat cycle: select A then B, an A response must not apply', () => {
    const sync = new ChatRequestCoordinator();
    const tokenA = sync.begin('chat-a');
    const tokenB = sync.begin('chat-b');
    expect(tokenA.signal.aborted).toBe(true);
    expect(sync.isCurrent(tokenA)).toBe(false);
    expect(sync.isCurrent(tokenB)).toBe(true);
  });

  it('re-selecting the same chat supersedes the earlier cycle (monotonic generations)', () => {
    const sync = new ChatRequestCoordinator();
    const first = sync.begin('chat-a');
    const second = sync.begin('chat-a');
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(sync.isCurrent(first)).toBe(false);
    expect(sync.isCurrent(second)).toBe(true);
  });

  it('cancelAll invalidates outstanding cycles on unmount or deselect', () => {
    const sync = new ChatRequestCoordinator();
    const token = sync.begin('chat-a');
    sync.cancelAll();
    expect(token.signal.aborted).toBe(true);
    expect(sync.isCurrent(token)).toBe(false);
  });

  it('a late poll cycle from before a selection change is rejected', () => {
    const sync = new ChatRequestCoordinator();
    const pollToken = sync.begin('chat-a');
    // User switches chat while the poll fetch is in flight.
    sync.begin('chat-b');
    expect(sync.isCurrent(pollToken)).toBe(false);
  });

  it('getMessages forwards an AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    let seenSignal: AbortSignal | null | undefined;
    globalThis.fetch = async (_input: unknown, init?: RequestInit) => {
      seenSignal = init?.signal;
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    try {
      await api.getMessages('chat-a', { signal: controller.signal });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(seenSignal).toBe(controller.signal);
  });
});
