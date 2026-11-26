/**
 * Resilient Model Fallback Engine
 *
 * Provides intelligent, zero-downtime model fallback for LLM operations.
 * Intercepts transient quota exhaustion (429), server errors (500, 502, 503),
 * and missing model errors (404), while strictly failing closed on authentication
 * or authorization failures (401, 403).
 */

import {
  createProviderResilience,
  getProviderResilience,
  classifyProviderError,
  parseRetryAfterMs,
  ProviderAbortedError,
  ProviderDeadlineExceededError
} from './provider-resilience';

export const DEFAULT_GEMINI_FALLBACK_CHAIN: readonly string[] = [
  'gemini-3.8-flash',
  'gemini-3.1-pro',
  'gemini-4-argon'
];

export const GEMINI_4_FALLBACK_CHAIN: readonly string[] = [
  'gemini-4-carbon',
  'gemini-4-argon',
  'gemini-4-hydrogen',
  'gemini-4-neon',
  'gemini-3.8-flash',
  'gemini-3.1-pro'
];

export interface FallbackOptions {
  onFallback?: (fromModel: string, toModel: string, error: unknown) => void;
  circuitBreakerThreshold?: number;
  preferredModel?: string;
  /** WA-012: shared per-provider circuit/budget. Passing `provider` joins the process-wide
   * shared resilience for that provider; passing `resilience` uses that instance (tests).
   * With neither, an ephemeral per-call instance preserves pre-WA-012 semantics. */
  provider?: string;
  lane?: 'interactive' | 'background';
  deadlineMs?: number;
  signal?: AbortSignal;
  /** Aggregate cap on invoker calls across the whole chain. Defaults to chain length. */
  maxAttempts?: number;
  resilience?: import('./provider-resilience').ProviderResilience;
}

export interface FallbackResult<T> {
  result: T;
  activeModel: string;
  attempts: number;
}

export function isFallbackEligibleError(error: unknown): boolean {
  if (!error) return false;

  const err = error as Record<string, any>;
  const status = Number(err.status ?? err.code ?? err.statusCode);
  const msg = String(err.message ?? err.error?.message ?? err);

  // Strictly NOT eligible for fallback: authentication / permission errors
  if (status === 401 || status === 403 || /PERMISSION_DENIED|UNAUTHENTICATED|API_KEY_INVALID/i.test(msg)) {
    return false;
  }

  // Strictly NOT eligible: caller validation errors
  if (status === 400 && !/model (?:was )?not found|model does not exist/i.test(msg)) {
    return false;
  }

  // Eligible: Rate limit, quota, server errors, or model not found
  if (status === 429 || [500, 502, 503, 504].includes(status) || status === 404) {
    return true;
  }

  return (
    /\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|RESOURCE_EXHAUSTED|quota exceeded|rate.?limit|UNAVAILABLE|high demand|overloaded|temporarily unavailable|model.*not found|model does not exist/i.test(
      msg
    )
  );
}

export function parseModelChain(primary: string, ...fallbacks: Array<string | string[] | undefined>): string[] {
  const all: string[] = [primary];

  for (const item of fallbacks) {
    if (!item) continue;
    if (Array.isArray(item)) {
      all.push(...item);
    } else {
      all.push(...item.split(","));
    }
  }

  return [...new Set(all.map((m) => m.trim()).filter((m) => m.length > 0))];
}

/**
 * Resolves a model fallback chain starting with the dynamically preferred model,
 * followed by standard resilient Gemini models without duplicate entries.
 */
export function resolveModelChain(
  preferredModel?: string,
  ...fallbacks: Array<string | string[] | undefined>
): string[] {
  const primary = preferredModel?.trim() || DEFAULT_GEMINI_FALLBACK_CHAIN[0];
  const defaultChain = primary.startsWith('gemini-4') && primary !== 'gemini-4-argon'
    ? [...GEMINI_4_FALLBACK_CHAIN]
    : [...DEFAULT_GEMINI_FALLBACK_CHAIN];
  return parseModelChain(primary, ...fallbacks, defaultChain);
}

export async function executeWithModelFallback<T>(
  models: string[],
  invoker: (model: string) => Promise<T>,
  options?: FallbackOptions
): Promise<FallbackResult<T>> {
  const initial = options?.preferredModel ? [options.preferredModel, ...models] : models;
  const chain = [...new Set(initial.map((m) => m.trim()).filter((m) => m.length > 0))];

  if (chain.length === 0) {
    throw new Error("Model fallback chain is empty.");
  }

  let lastError: unknown;

  // WA-012: shared provider circuit, concurrency lane, deadline and cancellation.
  const resilience = options?.resilience
    ?? (options?.provider ? getProviderResilience(options.provider) : createProviderResilience());
  if (options?.circuitBreakerThreshold) resilience.configureThreshold(options.circuitBreakerThreshold);
  const lane = options?.lane ?? 'interactive';
  const providerName = options?.provider ?? 'ephemeral';
  const deadlineAt = options?.deadlineMs !== undefined ? resilience.now() + options.deadlineMs : undefined;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? chain.length);
  let attemptsUsed = 0;

  for (let i = 0; i < chain.length; i++) {
    if (options?.signal?.aborted) throw new ProviderAbortedError();
    if (deadlineAt !== undefined && resilience.now() >= deadlineAt) {
      throw lastError ?? new ProviderDeadlineExceededError();
    }
    if (attemptsUsed >= maxAttempts) break;

    const currentModel = chain[i];
    // WA-012: fail fast on an open circuit before consuming a budget slot.
    resilience.assertCanExecute(providerName);
    const release = await resilience.acquire(lane, deadlineAt);
    try {
      attemptsUsed++;
      const result = await invoker(currentModel);
      resilience.recordSuccess();
      return {
        result,
        activeModel: currentModel,
        attempts: attemptsUsed,
      };
    } catch (error) {
      lastError = error;
      const cls = classifyProviderError(error);
      if (cls === 'transient') resilience.recordTransientFailure();

      // If this is an auth error or client defect, abort immediately (terminal errors
      // never trip the circuit and never retry: owner action is required).
      if (!isFallbackEligibleError(error)) {
        throw error;
      }

      const hasNext = i + 1 < chain.length && attemptsUsed < maxAttempts;
      if (!hasNext) break;

      // Honor provider retry-after hints; otherwise bounded exponential backoff with jitter.
      if (cls === 'transient') {
        const hint = parseRetryAfterMs(error);
        const base = Math.min(500 * Math.pow(2, i), 8_000);
        let delay = (hint ?? base) + resilience.jitter(250);
        if (deadlineAt !== undefined) {
          const remaining = deadlineAt - resilience.now();
          if (remaining <= 0) break;
          delay = Math.min(delay, remaining);
        }
        await resilience.sleep(delay);
      }

      const nextModel = chain[i + 1];
      options?.onFallback?.(currentModel, nextModel, error);
    } finally {
      release();
    }
  }

  // If all models failed, throw the last error
  throw lastError;
}
