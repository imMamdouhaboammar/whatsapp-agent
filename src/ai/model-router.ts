import { isRecord } from './response-validation';

/**
 * Jev Intelligent Model Router
 *
 * Optional TypeSafe System One classification before Gemini inference.
 * Separately evaluates reasoning complexity and consequential action risk.
 */

import { scrubCredentials } from '../domain/learning-memory';

export type RouterTier = 'trivial' | 'standard' | 'complex';
export type GeminiModelName = string;

export const GEMINI_4_MODELS = [
  'gemini-4-carbon',
  'gemini-4-argon',
  'gemini-4-hydrogen',
  'gemini-4-neon',
  'gemini-4-flash',
  'gemini-4-pro'
] as const;

export type Gemini4ModelName = typeof GEMINI_4_MODELS[number];

export interface GeminiModelDescriptor {
  id: string;
  name: string;
  generation: 4 | 3;
  tier: 'flagship' | 'frontier' | 'workhorse' | 'multimodal' | 'legacy';
  description: string;
  recommendedRole: string;
  defaultThinkingLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const SUPPORTED_GEMINI_MODELS: readonly GeminiModelDescriptor[] = [
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    generation: 4,
    tier: 'flagship',
    description: 'Flagship frontier model for deep reasoning, multi-step logic, complex architectures, and advanced problem-solving.',
    recommendedRole: 'Deep reasoning, dispute resolution, architecture, advanced math & logic',
    defaultThinkingLevel: 'HIGH'
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    generation: 4,
    tier: 'frontier',
    description: 'Balanced frontier workhorse for software engineering, long-document context, and complex conversation moderation.',
    recommendedRole: 'Primary agent persona, complex inquiries, long conversation context',
    defaultThinkingLevel: 'MEDIUM'
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    generation: 4,
    tier: 'workhorse',
    description: 'High-speed execution model built for rapid agentic workflows, low latency, and efficient high-frequency turns.',
    recommendedRole: 'Fast agent turns, standard inquiries, high-throughput routing',
    defaultThinkingLevel: 'LOW'
  },
  {
    id: 'gemini-4-neon',
    name: 'Gemini 4 Neon',
    generation: 4,
    tier: 'multimodal',
    description: 'Low-latency multimodal execution engine designed for high-performance vision, document, and audio workflows.',
    recommendedRole: 'Multimodal analysis, audio transcription, image inspection'
  },
  {
    id: 'gemini-4-flash',
    name: 'Gemini 4 Flash',
    generation: 4,
    tier: 'workhorse',
    description: 'Optimized high-speed execution tier for fast everyday interactions.',
    recommendedRole: 'General fast execution'
  },
  {
    id: 'gemini-4-pro',
    name: 'Gemini 4 Pro',
    generation: 4,
    tier: 'frontier',
    description: 'Advanced pro tier for enterprise reasoning and complex conversational workflows.',
    recommendedRole: 'Enterprise reasoning & compliance'
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    generation: 3,
    tier: 'legacy',
    description: 'Fast standard model from previous generation.',
    recommendedRole: 'Legacy fallback & high-speed backup'
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    generation: 3,
    tier: 'legacy',
    description: 'Capable reasoning model from previous generation.',
    recommendedRole: 'Legacy reasoning backup'
  }
];

export function isGemini4Model(model: string): boolean {
  return model.startsWith('gemini-4') || (GEMINI_4_MODELS as readonly string[]).includes(model);
}

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
  trivial: process.env.GEMINI_ROUTER_TRIVIAL_MODEL || 'gemini-3.8-flash',
  standard: process.env.GEMINI_ROUTER_STANDARD_MODEL || 'gemini-3.8-flash',
  complex: process.env.GEMINI_ROUTER_COMPLEX_MODEL || 'gemini-4-argon',
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
  if (!isRecord(value)) {
    throw new Error(`Invalid TypeSafe response: missing ${key}`);
  }
  const answer = value;
  const choice = choices.find((candidate) => candidate === answer.choice);
  if (answer.type !== 'choice' ||
      choice === undefined ||
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
        choices.some((candidate) => candidate === name) && typeof probability === 'number' &&
        Number.isFinite(probability) && probability >= 0 && probability <= 1)) {
    throw new Error(`Invalid TypeSafe response: malformed ${key} probabilities`);
  }
  return { choice, confidence: answer.confidence };
}

/**
 * Parse the documented System One answers contract. Never synthesize confidence.
 */
export function parseJevResponse(
  data: unknown,
  latencyMs: number,
  confidenceThreshold: number
): RoutingDecision {
  const answers = isRecord(data) ? data.answers : undefined;
  if (!isRecord(answers)) {
    throw new Error('Invalid TypeSafe response: missing answers');
  }

  const reasoning = parseChoice(answers, 'route', ['trivial', 'standard', 'complex'] as const);
  const risk = parseChoice(answers, 'action_risk', ['routine', 'consequential'] as const);

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

const MAX_RECURSION_DEPTH = 32;

/** Maps Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) digits to ASCII. */
export function normalizeDigits(value: string, depth = 0): string {
  if (depth > MAX_RECURSION_DEPTH) return value;
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(((d.codePointAt(0) ?? 0) & 0xF)));
}

function scrubRoutingState(message: string): string {
  // Normalize digits first so labeled OTPs written in Arabic-Indic digits match the ASCII credential patterns.
  return scrubCredentials(normalizeDigits(message))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, '[REDACTED_PHONE]')
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

    const data: unknown = await res.json();
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
