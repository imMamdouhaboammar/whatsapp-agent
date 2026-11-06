import type { CircuitBreakerState, CircuitBreakerStats } from './types';

export interface CircuitBreakerOptions {
  targetId: string;
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  readonly targetId: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;

  constructor(options: CircuitBreakerOptions) {
    this.targetId = options.targetId;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 10_000;
  }

  getState(): CircuitBreakerState {
    if (this.state === 'OPEN' && this.lastFailureTime) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const s = this.getState();
    return s === 'CLOSED' || s === 'HALF_OPEN';
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const remaining = this.lastFailureTime ? Math.max(0, this.cooldownMs - (Date.now() - this.lastFailureTime)) : this.cooldownMs;
      throw new Error(`Circuit breaker OPEN for target '${this.targetId}'. Cooldown remaining: ${remaining}ms`);
    }

    this.totalCalls++;
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private recordSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }

  private recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.totalFailures++;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    if (this.state === 'CLOSED' && this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = undefined;
  }

  getStats(): CircuitBreakerStats {
    const currentState = this.getState();
    const remaining = (currentState === 'OPEN' && this.lastFailureTime)
      ? Math.max(0, this.cooldownMs - (Date.now() - this.lastFailureTime))
      : 0;

    return {
      targetId: this.targetId,
      state: currentState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      cooldownRemainingMs: remaining
    };
  }
}
