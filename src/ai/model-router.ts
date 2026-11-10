/**
 * Jev Intelligent Model Router
 *
 * Ultra-fast System 1 discriminative routing layer using TypeSafe AI's Jev model.
 * Classifies incoming conversational turns (<300ms nominal, 800ms max timeout)
 * to route to the optimal Gemini model (gemini-3.8-flash vs gemini-4-argon),
 * preventing unnecessary latency and token expenditure for simple turns.
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

/**
 * Parses and validates Jev classification JSON output into a strongly-typed RoutingDecision.
 */
export function parseJevResponse(
  data: Record<string, unknown>,
  latencyMs: number,
  confidenceThreshold: number
): RoutingDecision {
  const classification = data.classification as Record<string, unknown> | undefined;
  const rawLabel = String(
    data.label ?? data.tier ?? data.prediction ?? classification?.label ?? 'standard'
  ).toLowerCase().trim();

  const tier: RouterTier = rawLabel === 'trivial' || rawLabel === 'complex' ? rawLabel : 'standard';

  let confidence = Number(
    data.confidence ?? data.score ?? data.probability ?? classification?.confidence ?? 1.0
  );
  if (Number.isNaN(confidence) || confidence < 0) confidence = 0.5;
  if (confidence > 1) confidence = 1.0;

  // Confidence threshold override: low confidence defaults to standard gemini-3.8-flash
  if (confidence < confidenceThreshold) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence,
      routerLatencyMs: latencyMs,
      reason: `Low confidence override to standard (score ${confidence.toFixed(2)} < threshold ${confidenceThreshold})`,
      bypassed: false
    };
  }

  const selectedModel = ROUTER_MODEL_MAP[tier];
  const reason = typeof data.reason === 'string'
    ? data.reason
    : typeof data.reasoning === 'string'
      ? data.reasoning
      : `Classified as ${tier} by Jev (${Math.round(confidence * 100)}% confidence)`;

  return {
    selectedModel,
    tier,
    confidence,
    routerLatencyMs: latencyMs,
    reason,
    bypassed: false
  };
}

/**
 * Routes an inbound message turn to the optimal model using TypeSafe Jev.
 *
 * Rules:
 * 1. Missing TYPESAFE_API_KEY or JEV_ROUTER_ENABLED=false -> immediate bypass to gemini-3.8-flash.
 * 2. High confidence trivial / standard -> gemini-3.8-flash.
 * 3. High confidence complex -> gemini-4-argon.
 * 4. Confidence < JEV_CONFIDENCE_THRESHOLD -> overrides to standard (gemini-3.8-flash).
 * 5. Router timeout (>800ms) or 429/5xx -> fail open to gemini-3.8-flash.
 * 6. Scrub sensitive credentials before payload reaches external classifier.
 */
export async function routeTurnModel(input: JevRouteRequest): Promise<RoutingDecision> {
  const apiKey = input.apiKey ?? process.env.TYPESAFE_API_KEY;
  const enabled = input.enabled ?? (process.env.JEV_ROUTER_ENABLED !== 'false' && Boolean(apiKey));

  // Fast fail-open bypass if disabled or API key absent
  if (!enabled || !apiKey) {
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 1.0,
      routerLatencyMs: 0,
      reason: 'Jev router bypassed (API key not configured or router disabled)',
      bypassed: true
    };
  }

  const threshold = input.confidenceThreshold ?? (
    process.env.JEV_CONFIDENCE_THRESHOLD
      ? Number.parseFloat(process.env.JEV_CONFIDENCE_THRESHOLD)
      : DEFAULT_CONFIDENCE_THRESHOLD
  );

  const timeoutMs = input.timeoutMs ?? (
    process.env.JEV_ROUTER_TIMEOUT_MS
      ? Number.parseInt(process.env.JEV_ROUTER_TIMEOUT_MS, 10)
      : DEFAULT_ROUTER_TIMEOUT_MS
  );

  const baseUrl = input.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? DEFAULT_JEV_BASE_URL;
  const fetchImpl = input.fetchFn ?? globalThis.fetch;

  // Strict credential scrubbing: prevent passwords, tokens, API keys from leaking
  const scrubbedMessage = scrubCredentials(input.message || '');
  const scrubbedContext = (input.threadContext || []).map((msg) => scrubCredentials(msg));

  const start = performance.now();
  const endpoint = baseUrl.endsWith('/classify') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/classify`;

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'whatsapp-agent-jev-router/1.0'
      },
      body: JSON.stringify({
        model: 'jev-1',
        task: 'routing',
        input: scrubbedMessage,
        context: scrubbedContext,
        candidates: ['trivial', 'standard', 'complex'],
        system: "You are Jev, a high-speed discriminative model router. Classify incoming customer messages into 'trivial' (simple greetings, acknowledgments, basic FAQs), 'standard' (regular questions, pricing, product queries, scheduling), or 'complex' (complaints, angry escalation, financial/refund negotiation, intricate issues)."
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      console.warn(`[JevRouter] Jev API responded with HTTP ${res.status}: ${res.statusText}. Failing open to ${DEFAULT_BYPASS_MODEL}.`);
      return {
        selectedModel: DEFAULT_BYPASS_MODEL,
        tier: 'standard',
        confidence: 0,
        routerLatencyMs: latencyMs,
        reason: `Router HTTP error ${res.status} (${res.statusText}); failed open to ${DEFAULT_BYPASS_MODEL}`,
        bypassed: true
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return parseJevResponse(data, latencyMs, threshold);
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[JevRouter] Routing request failed or timed out (${errMsg}). Failing open to ${DEFAULT_BYPASS_MODEL}.`);
    return {
      selectedModel: DEFAULT_BYPASS_MODEL,
      tier: 'standard',
      confidence: 0,
      routerLatencyMs: latencyMs,
      reason: `Router exception (${errMsg}); failed open to ${DEFAULT_BYPASS_MODEL}`,
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
