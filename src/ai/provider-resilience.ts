import { isRecord } from './response-validation';

/**
 * WA-012: shared provider resilience - per-provider circuit state, concurrency budget with
 * interactive/background lanes, deadlines, retry-after honoring and bounded jitter.
 *
 * The circuit is shared across invocations for a provider so independent callers cannot
 * amplify quota exhaustion: once transient failures trip the threshold, later calls fail
 * fast until the cooldown elapses and a half-open probe succeeds.
 */

export type ProviderErrorClass = 'transient' | 'terminal' | 'model_not_found';

function parseDelay(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : n * 1000;
}

export const readProviderError = (error: unknown): { status: number; message: string } => {
  const err = isRecord(error) ? error : {};
  const nested = isRecord(err.error) ? err.error : undefined;
  const rawStatus = err.status ?? err.code ?? err.statusCode;
  const status = typeof rawStatus === 'number' || typeof rawStatus === 'string' ? Number(rawStatus) : NaN;
  const message = [err.message, nested?.message, error].find((value) => typeof value === 'string') ?? '';
  return { status, message };
};

export function classifyProviderError(error: unknown): ProviderErrorClass {
  const { status, message: msg } = readProviderError(error);

  if (status === 401 || status === 403 || /PERMISSION_DENIED|UNAUTHENTICATED|API_KEY_INVALID/i.test(msg)) {
    return 'terminal';
  }
  if (status === 404 || /model (?:was )?not found|model does not exist|model.*not found/i.test(msg)) {
    return 'model_not_found';
  }
  if (
    status === 429 || [500, 502, 503, 504].includes(status) ||
    /\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|RESOURCE_EXHAUSTED|quota exceeded|rate.?limit|UNAVAILABLE|high demand|overloaded|temporarily unavailable/i.test(msg)
  ) {
    return 'transient';
  }
  return 'terminal';
}

export function parseRetryAfterMs(error: unknown): number | undefined {
  const err = isRecord(error) ? error : {};
  if (typeof err.retryAfterMs === 'number' && Number.isFinite(err.retryAfterMs)) return Math.max(0, err.retryAfterMs);
  if (typeof err.retryAfter === 'number' && Number.isFinite(err.retryAfter)) return Math.max(0, err.retryAfter * 1000);
  const direct = parseDelay(err.retryDelay);
  if (direct !== undefined) return direct;
  const nestedError = isRecord(err.error) ? err.error : undefined;
  const details = Array.isArray(err.details) ? err.details : Array.isArray(nestedError?.details) ? nestedError.details : [];
  for (const d of details) {
    if (!isRecord(d)) continue;
    const parsed = parseDelay(d.retryDelay);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export class ProviderCircuitOpenError extends Error {
  readonly provider: string;
  readonly retryAfterMs: number;
  constructor(provider: string, retryAfterMs: number) {
    super(`Provider circuit OPEN for '${provider}' (degraded); owner action may be required. Retry in ${Math.max(1, Math.round(retryAfterMs / 1000))}s.`);
    this.name = 'ProviderCircuitOpenError';
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ProviderDeadlineExceededError extends Error {
  constructor(message = 'Provider call deadline expired before the request could run') {
    super(message);
    this.name = 'ProviderDeadlineExceededError';
  }
}

export class ProviderAbortedError extends Error {
  constructor() {
    super('Provider call aborted by caller cancellation');
    this.name = 'ProviderAbortedError';
  }
}

export interface ProviderResilienceOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  failureThreshold?: number;
  cooldownMs?: number;
  maxConcurrent?: number;
  backgroundMax?: number;
}

type CircuitState = 'closed' | 'open' | 'half_open';

export interface ProviderResilience {
  now(): number;
  sleep(ms: number): Promise<void>;
  jitter(maxMs: number): number;
  circuitState(): CircuitState;
  configureThreshold(failureThreshold: number): void;
  assertCanExecute(provider: string): void;
  recordSuccess(): void;
  recordTransientFailure(): void;
  acquire(lane: 'interactive' | 'background', deadlineAt?: number): Promise<() => void>;
}

export function createProviderResilience(options: ProviderResilienceOptions = {}): ProviderResilience {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? (() => Math.random());
  let failureThreshold = options.failureThreshold ?? 3;
  const cooldownMs = options.cooldownMs ?? 10_000;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const backgroundMax = Math.max(1, options.backgroundMax ?? Math.floor(maxConcurrent / 2));

  let state: CircuitState = 'closed';
  let consecutiveFailures = 0;
  let openedAt = 0;
  let halfOpenInFlight = false;
  let activeInteractive = 0;
  let activeBackground = 0;

  const hasCapacity = (lane: 'interactive' | 'background') => {
    const total = activeInteractive + activeBackground;
    if (total >= maxConcurrent) return false;
    if (lane === 'background' && activeBackground >= backgroundMax) return false;
    return true;
  };

  return {
    now,
    sleep,
    jitter: (maxMs: number) => Math.floor(random() * Math.max(1, maxMs)),
    circuitState: () => {
      if (state === 'open' && now() - openedAt >= cooldownMs) return 'half_open';
      return state;
    },
    configureThreshold: (n: number) => {
      if (Number.isFinite(n) && n > 0) failureThreshold = Math.floor(n);
    },
    assertCanExecute: (provider: string) => {
      if (state === 'open') {
        if (now() - openedAt >= cooldownMs) {
          state = 'half_open';
          halfOpenInFlight = false;
        } else {
          throw new ProviderCircuitOpenError(provider, Math.max(0, cooldownMs - (now() - openedAt)));
        }
      }
      if (state === 'half_open') {
        if (halfOpenInFlight) {
          throw new ProviderCircuitOpenError(provider, cooldownMs);
        }
        halfOpenInFlight = true;
      }
    },
    recordSuccess: () => {
      state = 'closed';
      consecutiveFailures = 0;
      halfOpenInFlight = false;
    },
    recordTransientFailure: () => {
      consecutiveFailures++;
      if (state === 'half_open') {
        state = 'open';
        openedAt = now();
        halfOpenInFlight = false;
        return;
      }
      if (consecutiveFailures >= failureThreshold) {
        state = 'open';
        openedAt = now();
        halfOpenInFlight = false;
      }
    },
    acquire: async (lane, deadlineAt) => {
      while (!hasCapacity(lane)) {
        if (deadlineAt !== undefined && now() >= deadlineAt) {
          throw new ProviderDeadlineExceededError();
        }
        await sleep(Math.min(50, deadlineAt !== undefined ? Math.max(1, deadlineAt - now()) : 50));
        if (deadlineAt !== undefined && now() >= deadlineAt && !hasCapacity(lane)) {
          throw new ProviderDeadlineExceededError();
        }
      }
      if (lane === 'background') activeBackground++; else activeInteractive++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (lane === 'background') activeBackground--; else activeInteractive--;
      };
    }
  };
}

const shared = new Map<string, ProviderResilience>();

/** Process-wide shared resilience per provider (e.g. 'gemini'). */
export function getProviderResilience(provider: string): ProviderResilience {
  let r = shared.get(provider);
  if (!r) {
    r = createProviderResilience();
    shared.set(provider, r);
  }
  return r;
}
