import { describe, expect, it } from 'bun:test';
import { DashboardSync } from '../src/lib/dashboard-sync';
import { api, ApiError } from '../src/api/client';

describe('WA-026 dashboard sync health', () => {
  it('a failed initial load is an explicit error, never an empty success', () => {
    const sync = new DashboardSync();
    expect(sync.health).toBe('loading');
    expect(sync.noteLoadFailure(new Error('Failed to list chats'))).toBe('error');
    expect(sync.health).toBe('error');
  });

  it('a failed refresh with a retained snapshot is stale, not empty', () => {
    const sync = new DashboardSync();
    sync.noteLoadSuccess();
    expect(sync.noteLoadFailure(new Error('network down'))).toBe('stale');
    expect(sync.health).toBe('stale');
  });

  it('401/403 failures surface as unauthenticated instead of retrying forever', () => {
    const sync = new DashboardSync();
    sync.noteLoadSuccess();
    expect(sync.noteLoadFailure(new ApiError('Owner access required', 401))).toBe('unauthenticated');
    expect(sync.noteLoadFailure(new ApiError('Forbidden', 403))).toBe('unauthenticated');
  });

  it('a successful resync after a stale period returns to live and re-arms retries', () => {
    const sync = new DashboardSync(2);
    sync.noteLoadSuccess();
    sync.noteLoadFailure(new Error('boom'));
    expect(sync.nextRetryDelayMs()).not.toBeNull();
    expect(sync.nextRetryDelayMs()).not.toBeNull();
    expect(sync.nextRetryDelayMs()).toBeNull();
    expect(sync.noteLoadSuccess()).toBe('live');
    expect(sync.nextRetryDelayMs()).not.toBeNull();
  });

  it('automatic resync retries are bounded with capped exponential backoff', () => {
    const sync = new DashboardSync(4);
    const delays = [sync.nextRetryDelayMs(), sync.nextRetryDelayMs(), sync.nextRetryDelayMs(), sync.nextRetryDelayMs()];
    expect(delays).toEqual([2000, 4000, 8000, 16000]);
    expect(sync.nextRetryDelayMs()).toBeNull();
    sync.resetRetries();
    expect(sync.nextRetryDelayMs()).toBe(2000);
  });

  it('backoff is capped so a long outage cannot schedule absurd delays', () => {
    const sync = new DashboardSync(10);
    let last = 0;
    for (let i = 0; i < 10; i += 1) {
      last = sync.nextRetryDelayMs() ?? -1;
    }
    expect(last).toBeLessThanOrEqual(30000);
  });

  it('a dropped event stream marks retained data stale; reconnect re-arms retries', () => {
    const sync = new DashboardSync(1);
    sync.noteLoadSuccess();
    expect(sync.noteStreamDrop()).toBe('stale');
    sync.nextRetryDelayMs();
    expect(sync.nextRetryDelayMs()).toBeNull();
    sync.noteStreamOpen();
    expect(sync.nextRetryDelayMs()).not.toBeNull();
  });

  it('a stream drop does not mask an unauthenticated state', () => {
    const sync = new DashboardSync();
    sync.noteLoadFailure(new ApiError('Owner access required', 401));
    expect(sync.noteStreamDrop()).toBe('unauthenticated');
  });
});

describe('WA-026 API error classification', () => {
  const originalFetch = globalThis.fetch;

  it('HTTP failures carry their status so the dashboard can classify them', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 })
    ) as typeof fetch;
    try {
      await api.listChats();
      throw new Error('listChats should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(503);
      expect((err as Error).message).toBe('Service unavailable');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
