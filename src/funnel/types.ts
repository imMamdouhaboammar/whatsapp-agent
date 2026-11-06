/**
 * Feature Reconstruction: Scatter-Gather API Funnel Engine
 * Based on KraytonOG/funnel-script reverse-engineering
 * Re-architected for Fable Agentic WhatsApp
 */

export type FunnelExecutionMode = 'ALL_SETTLED' | 'FIRST_SUCCESS' | 'QUORUM';

export interface FunnelTarget {
  id: string;
  name: string;
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  timeoutMs?: number;
  weight?: number;
  retries?: number;
  authHeader?: string;
  enabled: boolean;
}

export interface FunnelMethodConfig {
  method: string;
  description: string;
  mode: FunnelExecutionMode;
  targets: FunnelTarget[];
  timeoutMs: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
  quorumCount?: number;
}

export interface TargetResult {
  targetId: string;
  targetName: string;
  url: string;
  statusCode: number;
  durationMs: number;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface FunnelReceipt {
  traceId: string;
  method: string;
  mode: FunnelExecutionMode;
  startedAt: string;
  totalDurationMs: number;
  success: boolean;
  successfulCount: number;
  failedCount: number;
  results: TargetResult[];
  winningTargetId?: string;
  error?: string;
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  targetId: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  cooldownRemainingMs?: number;
}

export interface FunnelDispatchRequest {
  method: string;
  payload?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  traceId?: string;
  timeoutMs?: number;
}
