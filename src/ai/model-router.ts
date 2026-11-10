/**
 * Jev Intelligent Model Router
 *
 * Optional TypeSafe System One classification before Gemini inference.
 * Separately evaluates reasoning complexity and consequential action risk.
 */

import { scrubCredentials } from '../domain/learning-memory';

export type RouterTier = 'trivial' | 'standard' | 'complex';
export type GeminiModelName = 'gemini-3.8-flash' | 'gemini-3.1-pro' | 'gemini-4-argon' | string;

export interface RoutingDecision {
  selectedModel: GeminiModelName;
  tier: RouterTier;
  confidence: number;
  routerLatencyMs: number;
  reason: string;
  bypassed?: boolean;
}

export interface JevRouteRequest {
  message: string;
  threadContext?: string[];
  senderName?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  confidenceThreshold?: number;
  enabled?: boolean;
  fetchFn?: typeof fetch;
  externalRoutingAllowed?: boolean;
}

export const ROUTER_MODEL_MAP: Record<RouterTier, GeminiModelName> = {
  trivial: 'gemini-3.8-flash',
  standard: 'gemini-3.8-flash',
  complex: 'gemini-4-argon',
};

export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai/v1';
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
export const DEFAULT_ROUTER_TIMEOUT_MS = 800;
export const DEFAULT_BYPASS_MODEL: GeminiModelName = 'gemini-3.8-flash';

type ChoiceResult<T extends string> = { choice: T; confidence: number };

function parseChoice<T extends string>(
  answers: Record<string, unknown>,
  key: string,
  choices: readonly T[]
): ChoiceResult<T> {
  const value = answers[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid TypeSafe response: missing ${key}`);
  }
  const answer = value as Record<string, unknown>;
  if (answer.type !== 'choice' ||
      typeof answer.choice !== 'string' || !choices.includes(answer.choice as T) ||
      typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 || answer.confidence > 1) {
    throw new Error(`Invalid TypeSafe response: malformed ${key}`);
  }

  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) {
    throw new Error(`Invalid TypeSafe response: missing ${key} probabilities`);
  }
  const entries = Object.entries(probabilities);
  if (entries.length !== choices.length ||
      !entries.every(([name, probability]) =>
        choices.includes(name as T) && typeof probability === 'number' &&
        Number.isFinite(probability) && probability >= 0 && probability <= 1)) {
    throw new Error(`Invalid TypeSafe response: malformed ${key} probabilities`);
  }
  return { choice: answer.choice as T, confidence: answer.confidence };
}

/**
 * Parse the documented System One answers contract. Never synthesize confidence.
 */
export function parseJevResponse(
  data: Record<string, unknown>,
  latencyMs: number,
  confidenceThreshold: number
): RoutingDecision {
  const answers = data?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('Invalid TypeSafe response: missing answers');
  }

  const parsed = answers as Record<string, unknown>;
  const reasoning = parseChoice(parsed, 'route', ['trivial', 'standard', 'complex'] as const);
  const risk = parseChoice(parsed, 'action_risk', ['routine', 'consequential'] as const);

  if (risk.choice === 'consequential' || risk.confidence < confidenceThreshold) {
    return {
      selectedModel: ROUTER_MODEL_MAP.complex,
      tier: 'complex',
      confidence: risk.confidence,
      routerLatencyMs: latencyMs,
      reason: risk.choice === 'consequential'
        ? 'Consequential action requires stronger reasoning'
        : 'Uncertain action risk requires stronger reasoning',
      bypassed: false
    };
  }

  if (reasoning.confidence < confidenceThreshold) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: reasoning.confidence,
      routerLatencyMs: latencyMs,
      reason: `Low confidence override to standard (score ${reasoning.confidence.toFixed(2)} < threshold ${confidenceThreshold})`,
      bypassed: false
    };
  }

  return {
    selectedModel: ROUTER_MODEL_MAP[reasoning.choice],
    tier: reasoning.choice,
    confidence: reasoning.confidence,
    routerLatencyMs: latencyMs,
    reason: `Classified as ${reasoning.choice} by Jev (${Math.round(reasoning.confidence * 100)}% confidence)`,
    bypassed: false
  };
}

function scrubRoutingState(message: string): string {
  return scrubCredentials(message)
    .replace(/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/(?<!\w)\+?\d[\d\s().\-]{7,}\d(?!\w)/g, '[REDACTED_PHONE]')
    .slice(0, 1000);
}

/**
 * Routes an inbound message turn to the optimal model using TypeSafe Jev.
 *
 * Rules:
 * 1. Missing TYPESAFE_API_KEY or JEV_ROUTER_ENABLED=false -> immediate bypass to gemini-3.8-flash.
 * 2. High confidence trivial / standard -> gemini-3.8-flash.
 * 3. High confidence complex -> gemini-4-argon.
 * 4. Confidence < JEV_CONFIDENCE_THRESHOLD -> overrides to standard (gemini-3.8-flash).
 * 5. Router errors/timeouts -> fail open to gemini-3.8-flash.
 * 6. Send screened message content only after explicit external-routing opt-in.
 * 7. No conversation history, sender identity, or raw provider errors are transmitted.
 */
export async function routeTurnModel(input: JevRouteRequest): Promise<RoutingDecision> {
  const apiKey = input.apiKey ?? process.env.TYPESAFE_API_KEY;
  const enabled = input.enabled ?? (process.env.JEV_ROUTER_ENABLED !== 'false' && Boolean(apiKey));
  const externalRoutingAllowed = input.externalRoutingAllowed ?? (process.env.JEV_EXTERNAL_ROUTING_ALLOWED === 'true');

  // Fast fail-open bypass if disabled or API key absent
  if (!enabled || !apiKey || !externalRoutingAllowed) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 0,
      routerLatencyMs: 0,
      reason: 'Jev router bypassed (disabled, missing configuration, or external routing not permitted)',
      bypassed: true
    };
  }

  const threshold = input.confidenceThreshold ?? (
    process.env.JEV_CONFIDENCE_THRESHOLD
      ? Number(process.env.JEV_CONFIDENCE_THRESHOLD)
      : DEFAULT_CONFIDENCE_THRESHOLD
  );

  const timeoutMs = input.timeoutMs ?? (
    process.env.JEV_ROUTER_TIMEOUT_MS
      ? Number(process.env.JEV_ROUTER_TIMEOUT_MS)
      : DEFAULT_ROUTER_TIMEOUT_MS
  );

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 0,
      routerLatencyMs: 0,
      reason: 'Invalid optional router configuration',
      bypassed: true
    };
  }

  const baseUrl = input.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? DEFAULT_JEV_BASE_URL;
  const fetchImpl = input.fetchFn ?? globalThis.fetch;
  const state = scrubRoutingState(input.message || '');
  if (!state.trim()) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 0,
      routerLatencyMs: 0,
      reason: 'No usable routing content after screening',
      bypassed: true
    };
  }

  const start = performance.now();
  const endpoint = baseUrl.endsWith('/systemone') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/systemone`;
  const parsedEndpoint = URL.canParse(endpoint) ? new URL(endpoint) : null;
  if (!parsedEndpoint || parsedEndpoint.protocol !== 'https:' ||
      parsedEndpoint.username || parsedEndpoint.password) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 0,
      routerLatencyMs: 0,
      reason: 'Optional router endpoint must use HTTPS',
      bypassed: true
    };
  }

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'whatsapp-agent-jev-router/1.0'
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions: {
          route: {
            type: 'choice',
            instructions: 'Classify the reasoning complexity of this customer turn.',
            criteria: {
              trivial: 'Greeting, acknowledgment, or simple courtesy with no requested action',
              standard: 'Ordinary questions, prices, availability, or scheduling requiring routine answers',
              complex: 'Intricate inquiry or ambiguous reasoning requiring multi-step analysis'
            }
          },
          action_risk: {
            type: 'choice',
            instructions: 'Does responding require a consequential business decision, authorization, refund, commitment, or sensitive action?',
            criteria: {
              routine: 'Information-only reply without financial or operational commitment',
              consequential: 'Financial/refund action, disputed transaction, binding commitment, personal data disclosure, or account change'
            }
          }
        }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      console.warn(`[JevRouter] Optional classifier returned HTTP ${res.status}; using ${DEFAULT_BYPASS_MODEL}.`);
      return {
        selectedModel: DEFAULT_BYPASS_MODEL,
        tier: 'standard',
        confidence: 0,
        routerLatencyMs: latencyMs,
        reason: `Router HTTP error ${res.status}; failed open to ${DEFAULT_BYPASS_MODEL}`,
        bypassed: true
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return parseJevResponse(data, latencyMs, threshold);
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    console.warn('[JevRouter] Optional classifier failed or timed out; using local Gemini fallback.');
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 0,
      routerLatencyMs: latencyMs,
      reason: `Router exception; failed open to ${DEFAULT_BYPASS_MODEL}`,
      bypassed: true
    };
  }
}

/**
 * Class-based Jev Model Router wrapper for dependency injection.
 */
export class JevModelRouter {
  constructor(private readonly defaultOptions: Partial<JevRouteRequest> = {}) {}

  async route(message: string, threadContext?: string[], options?: Partial<JevRouteRequest>): Promise<RoutingDecision> {
    return routeTurnModel({
      message,
      threadContext,
      ...this.defaultOptions,
      ...options
    });
  }
}
