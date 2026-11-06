import { CircuitBreaker } from './circuit-breaker';
import type { FunnelRegistry } from './registry';
import type {
  CircuitBreakerStats,
  FunnelDispatchRequest,
  FunnelReceipt,
  FunnelTarget,
  TargetResult
} from './types';

export interface FableFunnelEngineOptions {
  registry: FunnelRegistry;
  fetcher?: typeof fetch;
}

export class FableFunnelEngine {
  readonly registry: FunnelRegistry;
  private readonly fetcher: typeof fetch;
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();

  constructor(options: FableFunnelEngineOptions) {
    this.registry = options.registry;
    this.fetcher = options.fetcher ?? fetch;
  }

  private getCircuitBreaker(target: FunnelTarget, threshold?: number, cooldownMs?: number): CircuitBreaker {
    let cb = this.circuitBreakers.get(target.id);
    if (!cb) {
      cb = new CircuitBreaker({
        targetId: target.id,
        failureThreshold: threshold ?? 3,
        cooldownMs: cooldownMs ?? 10_000
      });
      this.circuitBreakers.set(target.id, cb);
    }
    return cb;
  }

  async dispatch(req: FunnelDispatchRequest): Promise<FunnelReceipt> {
    const traceId = req.traceId || crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startTime = performance.now();

    const methodConfig = this.registry.getMethod(req.method);
    if (!methodConfig) {
      return {
        traceId,
        method: req.method,
        mode: 'ALL_SETTLED',
        startedAt,
        totalDurationMs: Math.round(performance.now() - startTime),
        success: false,
        successfulCount: 0,
        failedCount: 0,
        results: [],
        error: `Unknown funnel method '${req.method}'`
      };
    }

    const targets = this.registry.getActiveTargets(req.method);
    if (targets.length === 0) {
      return {
        traceId,
        method: req.method,
        mode: methodConfig.mode,
        startedAt,
        totalDurationMs: Math.round(performance.now() - startTime),
        success: false,
        successfulCount: 0,
        failedCount: 0,
        results: [],
        error: `No active targets configured for method '${req.method}'`
      };
    }

    const timeoutMs = req.timeoutMs ?? methodConfig.timeoutMs ?? 5000;

    if (methodConfig.mode === 'FIRST_SUCCESS') {
      return this.dispatchHedgedRace(req, methodConfig, targets, traceId, startedAt, startTime, timeoutMs);
    }

    return this.dispatchScatterGather(req, methodConfig, targets, traceId, startedAt, startTime, timeoutMs);
  }

  private async dispatchScatterGather(
    req: FunnelDispatchRequest,
    config: any,
    targets: FunnelTarget[],
    traceId: string,
    startedAt: string,
    startTime: number,
    timeoutMs: number
  ): Promise<FunnelReceipt> {
    const promises = targets.map((target) =>
      this.executeTarget(target, req, timeoutMs, config.circuitBreakerThreshold, config.circuitBreakerCooldownMs)
    );

    const settled = await Promise.allSettled(promises);
    const results: TargetResult[] = settled.map((s, idx) => {
      if (s.status === 'fulfilled') return s.value;
      return {
        targetId: targets[idx].id,
        targetName: targets[idx].name,
        url: targets[idx].url,
        statusCode: 500,
        durationMs: 0,
        success: false,
        error: String((s as PromiseRejectedResult).reason?.message || 'Execution error')
      };
    });

    const successfulCount = results.filter((r) => r.success).length;
    const failedCount = results.length - successfulCount;

    let overallSuccess = false;
    if (config.mode === 'QUORUM') {
      const required = config.quorumCount ?? (Math.floor(targets.length / 2) + 1);
      overallSuccess = successfulCount >= required;
    } else {
      // ALL_SETTLED: considered successful if at least one target succeeded without critical global failure
      overallSuccess = successfulCount > 0;
    }

    return {
      traceId,
      method: req.method,
      mode: config.mode,
      startedAt,
      totalDurationMs: Math.round(performance.now() - startTime),
      success: overallSuccess,
      successfulCount,
      failedCount,
      results
    };
  }

  private async dispatchHedgedRace(
    req: FunnelDispatchRequest,
    config: any,
    targets: FunnelTarget[],
    traceId: string,
    startedAt: string,
    startTime: number,
    timeoutMs: number
  ): Promise<FunnelReceipt> {
    const parentController = new AbortController();
    const globalTimeout = setTimeout(() => parentController.abort(), timeoutMs);

    const results: TargetResult[] = [];
    let winningTargetId: string | undefined;

    try {
      const targetPromises = targets.map(async (target) => {
        const targetController = new AbortController();
        const onParentAbort = () => targetController.abort();
        parentController.signal.addEventListener('abort', onParentAbort, { once: true });

        try {
          const res = await this.executeTarget(
            target,
            req,
            target.timeoutMs ?? timeoutMs,
            config.circuitBreakerThreshold,
            config.circuitBreakerCooldownMs,
            targetController.signal
          );
          results.push(res);
          if (res.success && !winningTargetId) {
            winningTargetId = target.id;
            parentController.abort(); // Cancel pending sibling requests immediately
          }
          return res;
        } catch (err: any) {
          const errRes: TargetResult = {
            targetId: target.id,
            targetName: target.name,
            url: target.url,
            statusCode: 500,
            durationMs: 0,
            success: false,
            error: err.message
          };
          results.push(errRes);
          return errRes;
        } finally {
          parentController.signal.removeEventListener('abort', onParentAbort);
        }
      });

      await Promise.allSettled(targetPromises);
    } finally {
      clearTimeout(globalTimeout);
    }

    const successfulCount = results.filter((r) => r.success).length;
    const failedCount = results.length - successfulCount;

    return {
      traceId,
      method: req.method,
      mode: 'FIRST_SUCCESS',
      startedAt,
      totalDurationMs: Math.round(performance.now() - startTime),
      success: successfulCount > 0,
      successfulCount,
      failedCount,
      winningTargetId,
      results
    };
  }

  private async executeTarget(
    target: FunnelTarget,
    req: FunnelDispatchRequest,
    timeoutMs: number,
    threshold?: number,
    cooldownMs?: number,
    externalSignal?: AbortSignal
  ): Promise<TargetResult> {
    const cb = this.getCircuitBreaker(target, threshold, cooldownMs);
    const start = performance.now();

    if (!cb.canExecute()) {
      return {
        targetId: target.id,
        targetName: target.name,
        url: target.url,
        statusCode: 503,
        durationMs: 0,
        success: false,
        error: `Circuit breaker OPEN for target '${target.id}'`
      };
    }

    try {
      return await cb.execute(async () => {
        const urlObj = new URL(target.url);
        if (req.queryParams) {
          for (const [k, v] of Object.entries(req.queryParams)) {
            urlObj.searchParams.set(k, v);
          }
        }

        const httpMethod = target.method || (req.payload ? 'POST' : 'GET');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Funnel-Trace-Id': req.traceId || crypto.randomUUID(),
          ...(target.headers || {}),
          ...(req.headers || {})
        };

        if (target.authHeader) {
          headers['Authorization'] = target.authHeader;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
          if (externalSignal.aborted) {
            clearTimeout(timeoutId);
            throw new Error('Aborted by hedged race');
          }
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }

        try {
          const res = await this.fetcher(urlObj.toString(), {
            method: httpMethod,
            headers,
            body: req.payload && httpMethod !== 'GET' ? JSON.stringify(req.payload) : undefined,
            signal: controller.signal
          });

          const durationMs = Math.round(performance.now() - start);
          const isSuccess = res.status >= 200 && res.status < 300;

          let data: unknown;
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            data = await res.json().catch(() => null);
          } else {
            const rawText = await res.text().catch(() => '');
            try {
              data = JSON.parse(rawText);
            } catch {
              data = rawText;
            }
          }

          if (!isSuccess) {
            throw new Error(`Target returned HTTP ${res.status}`);
          }

          return {
            targetId: target.id,
            targetName: target.name,
            url: target.url,
            statusCode: res.status,
            durationMs,
            success: true,
            data
          };
        } finally {
          clearTimeout(timeoutId);
          if (externalSignal) {
            externalSignal.removeEventListener('abort', onExternalAbort);
          }
        }
      });
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - start);
      return {
        targetId: target.id,
        targetName: target.name,
        url: target.url,
        statusCode: err.name === 'AbortError' ? 504 : 500,
        durationMs,
        success: false,
        error: err.message
      };
    }
  }

  getCircuitBreakerStats(): CircuitBreakerStats[] {
    return Array.from(this.circuitBreakers.values()).map((cb) => cb.getStats());
  }

  resetCircuitBreaker(targetId: string): boolean {
    const cb = this.circuitBreakers.get(targetId);
    if (cb) {
      cb.reset();
      return true;
    }
    return false;
  }
}
