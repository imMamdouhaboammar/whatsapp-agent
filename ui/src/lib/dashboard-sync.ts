// WA-026: explicit dashboard data-freshness model.
//
// The cockpit must never present a failed refresh as an empty success:
// a network/auth failure keeps the last known good snapshot and flips the
// dashboard into `stale` (snapshot retained) or `error` (nothing loaded yet),
// never into a fake empty list. Reconnects are reconciled with a bounded
// retry budget so a dropped stream cannot cause a retry storm.

export type SyncHealth = 'loading' | 'live' | 'stale' | 'error' | 'unauthenticated';

export interface SyncErrorLike {
  status?: number;
}

const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;

export class DashboardSync {
  private retryAttempts = 0;
  private hasSnapshot = false;
  private healthValue: SyncHealth = 'loading';
  private lastErrorMessage: string | undefined;

  private readonly maxAutoRetries: number;

  constructor(maxAutoRetries: number = 5) {
    this.maxAutoRetries = maxAutoRetries;
  }

  get health(): SyncHealth {
    return this.healthValue;
  }

  get lastError(): string | undefined {
    return this.lastErrorMessage;
  }

  /** A successful response was applied; there is now a snapshot worth keeping. */
  noteSnapshot(): void {
    this.hasSnapshot = true;
  }

  private isAuthFailure(error: unknown): boolean {
    const status = (error as SyncErrorLike | undefined)?.status;
    return status === 401 || status === 403;
  }

  /** A refresh succeeded end to end. */
  noteLoadSuccess(): SyncHealth {
    this.hasSnapshot = true;
    this.healthValue = 'live';
    this.lastErrorMessage = undefined;
    this.retryAttempts = 0;
    return this.healthValue;
  }

  /**
   * A refresh failed. With a retained snapshot the dashboard is stale; with no
   * snapshot it is an explicit error. Auth failures are surfaced separately so
   * the UI can ask the owner to sign in again instead of retrying forever.
   */
  noteLoadFailure(error: unknown): SyncHealth {
    this.lastErrorMessage = error instanceof Error ? error.message : String(error);
    if (this.isAuthFailure(error)) {
      this.healthValue = 'unauthenticated';
    } else {
      this.healthValue = this.hasSnapshot ? 'stale' : 'error';
    }
    return this.healthValue;
  }

  /** The live event stream dropped; cached data may now be behind. */
  noteStreamDrop(): SyncHealth {
    if (this.healthValue !== 'unauthenticated') {
      this.healthValue = this.hasSnapshot ? 'stale' : this.healthValue;
    }
    return this.healthValue;
  }

  /** The live event stream (re)connected; a reconciliation resync may begin. */
  noteStreamOpen(): void {
    this.retryAttempts = 0;
  }

  /**
   * Delay before the next automatic resync attempt, or null once the bounded
   * budget is exhausted (a manual retry or a stream reconnect re-arms it).
   */
  nextRetryDelayMs(): number | null {
    if (this.retryAttempts >= this.maxAutoRetries) return null;
    const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** this.retryAttempts, MAX_RETRY_DELAY_MS);
    this.retryAttempts += 1;
    return delay;
  }

  /** Manual retry: forget the exhausted budget and try again immediately. */
  resetRetries(): void {
    this.retryAttempts = 0;
  }
}
