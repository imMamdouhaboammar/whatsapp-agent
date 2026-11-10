/**
 * Resilient Model Fallback Engine
 *
 * Provides intelligent, zero-downtime model fallback for LLM operations.
 * Intercepts transient quota exhaustion (429), server errors (500, 502, 503),
 * and missing model errors (404), while strictly failing closed on authentication
 * or authorization failures (401, 403).
 */

export const DEFAULT_GEMINI_FALLBACK_CHAIN: readonly string[] = [
  'gemini-3.8-flash',
  'gemini-3.1-pro',
  'gemini-4-argon'
];

export interface FallbackOptions {
  onFallback?: (fromModel: string, toModel: string, error: unknown) => void;
  circuitBreakerThreshold?: number;
  preferredModel?: string;
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
  return parseModelChain(primary, ...fallbacks, [...DEFAULT_GEMINI_FALLBACK_CHAIN]);
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

  for (let i = 0; i < chain.length; i++) {
    const currentModel = chain[i];
    try {
      const result = await invoker(currentModel);
      return {
        result,
        activeModel: currentModel,
        attempts: i + 1,
      };
    } catch (error) {
      lastError = error;

      // If this is an auth error or client defect, abort immediately
      if (!isFallbackEligibleError(error)) {
        throw error;
      }

      // If we have another model to try, alert handler and proceed
      if (i + 1 < chain.length) {
        const nextModel = chain[i + 1];
        options?.onFallback?.(currentModel, nextModel, error);
      }
    }
  }

  // If all models failed, throw the last error
  throw lastError;
}
