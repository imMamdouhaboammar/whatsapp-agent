import { rejects } from 'node:assert/strict';
import { describe, expect, it } from 'bun:test';
import { executeWithModelFallback } from '../src/ai/model-fallback';
import {
  createProviderResilience,
  classifyProviderError,
  parseRetryAfterMs
} from '../src/ai/provider-resilience';

function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    sleeps,
    random: () => 0 // jitter = 0 for determinism
  };
}

function createGate<T>() {
  let r!: (v: T) => void;
  const p = new Promise<T>((resolve) => { r = resolve; });
  return { p, r };
}

const transient429 = (): Error & { status: number; retryAfterMs?: number } =>
  Object.assign(new Error('RESOURCE_EXHAUSTED: quota exceeded'), { status: 429 });
const terminal401 = (): Error & { status: number } =>
  Object.assign(new Error('UNAUTHENTICATED: API key invalid'), { status: 401 });

describe('WA-012 classification and retry-after parsing', () => {
  it('classifies string failures and safely handles nonnumeric status values', () => {
    expect(classifyProviderError('quota exceeded')).toBe('transient');
    expect(classifyProviderError({ status: Symbol(), message: 'UNAUTHENTICATED quota exceeded' })).toBe('terminal');
  });

  it('classifies transient, terminal and model-not-found', () => {
    expect(classifyProviderError(transient429())).toBe('transient');
    expect(classifyProviderError(Object.assign(new Error('UNAVAILABLE'), { status: 503 }))).toBe('transient');
    expect(classifyProviderError(terminal401())).toBe('terminal');
    expect(classifyProviderError(Object.assign(new Error('PERMISSION_DENIED'), { status: 403 }))).toBe('terminal');
    expect(classifyProviderError(Object.assign(new Error('model gemini-x was not found'), { status: 404 }))).toBe('model_not_found');
  });

  it('parses retry-after hints from provider errors', () => {
    expect(parseRetryAfterMs({ status: 429, retryAfterMs: 1500 })).toBe(1500);
    expect(parseRetryAfterMs({ status: 429, retryAfter: 2 })).toBe(2000);
    expect(parseRetryAfterMs({ status: 429, retryDelay: '3s' })).toBe(3000);
    expect(parseRetryAfterMs({ status: 429, message: 'slow down' })).toBeUndefined();
  });
});

describe('WA-012 shared circuit has observable effect across invocations', () => {
  it('opens after the threshold and fails fast without invoking the provider', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random });
    let calls = 0;
    const invoker = async () => { calls++; throw transient429(); };

    // threshold 1: first invocation opens the circuit
    await rejects(
      executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-a', circuitBreakerThreshold: 1 }));
    const callsAfterFirst = calls;

    // second invocation must fail fast: circuit open, no new provider call
    await rejects(
      executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-a', circuitBreakerThreshold: 1 }), /circuit|unavailable|degraded/i);
    expect(calls).toBe(callsAfterFirst);
  });

  it('recovers through half-open after the cooldown', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random, cooldownMs: 5_000 });
    let fail = true;
    const invoker = async () => { if (fail) throw transient429(); return 'ok'; };

    await rejects(
      executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-b', circuitBreakerThreshold: 1 }));

    clock.advance(6_000); // cooldown elapsed -> half-open probe allowed
    fail = false;
    const outcome = await executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-b', circuitBreakerThreshold: 1 });
    expect(outcome.result).toBe('ok');

    // circuit closed again: further calls execute
    const again = await executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-b', circuitBreakerThreshold: 1 });
    expect(again.result).toBe('ok');
  });

  it('a half-open probe failure re-opens the circuit', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random, cooldownMs: 5_000 });
    let calls = 0;
    const invoker = async () => { calls++; throw transient429(); };

    await rejects(executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-c', circuitBreakerThreshold: 1 }));
    clock.advance(6_000);
    await rejects(executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-c', circuitBreakerThreshold: 1 }));
    const callsAfterProbe = calls;
    // re-opened: fail fast again without calling
    await rejects(executeWithModelFallback(['m1'], invoker, { resilience, provider: 'gemini-test-c', circuitBreakerThreshold: 1 }), /circuit|unavailable|degraded/i);
    expect(calls).toBe(callsAfterProbe);
  });
});

describe('WA-012 terminal errors never retry and never trip the circuit', () => {
  it('401 aborts the chain immediately and the circuit stays closed', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random });
    let calls = 0;
    await rejects(
      executeWithModelFallback(['m1', 'm2'], async () => { calls++; throw terminal401(); }, { resilience, provider: 'gemini-test-d', circuitBreakerThreshold: 1 }), /UNAUTHENTICATED/);
    expect(calls).toBe(1);

    // circuit unaffected: a healthy call still goes through
    const ok = await executeWithModelFallback(['m1'], async () => 'fine', { resilience, provider: 'gemini-test-d', circuitBreakerThreshold: 1 });
    expect(ok.result).toBe('fine');
  });
});

describe('WA-012 bounded attempts, retry-after and jitter', () => {
  it('honors retry-after before the next attempt', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random });
    let calls = 0;
    const outcome = await executeWithModelFallback(['m1', 'm2'], async () => {
      calls++;
      if (calls === 1) { const e = transient429(); e.retryAfterMs = 1200; throw e; }
      return 'recovered';
    }, { resilience, provider: 'gemini-test-e' });
    expect(outcome.result).toBe('recovered');
    expect(clock.sleeps.some((ms) => ms >= 1200)).toBe(true);
  });

  it('caps aggregate attempts across the chain', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random });
    let calls = 0;
    await rejects(
      executeWithModelFallback(['m1', 'm2', 'm3'], async () => { calls++; throw transient429(); }, { resilience, provider: 'gemini-test-f', maxAttempts: 2 }));
    expect(calls).toBe(2);
  });
});

describe('WA-012 concurrency budget and lanes', () => {
  it('bounds concurrent executions and lets interactive work through when background saturates', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random, maxConcurrent: 2, backgroundMax: 1 });
    const g1 = createGate<string>(); const g2 = createGate<string>();
    let bgStarted = 0;
    let interactiveStarted = 0;

    const bg1 = executeWithModelFallback(['m1'], () => { bgStarted++; return g1.p; }, { resilience, provider: 'gemini-test-g', lane: 'background' });
    const bg2 = executeWithModelFallback(['m1'], () => { bgStarted++; return g2.p; }, { resilience, provider: 'gemini-test-g', lane: 'background' });
    await clock.sleep(0);
    expect(bgStarted).toBe(1); // background lane capped at 1

    const fg = executeWithModelFallback(['m1'], async () => { interactiveStarted++; return 'fg'; }, { resilience, provider: 'gemini-test-g', lane: 'interactive' });
    await clock.sleep(0);
    expect(interactiveStarted).toBe(1); // interactive not starved by background
    expect((await fg)).toBeDefined();

    g1.r('bg1');
    await bg1;
    await clock.sleep(0);
    expect(bgStarted).toBe(2); // queued background proceeds after release
    g2.r('bg2');
    await bg2;
  });

  it('rejects queued work when the deadline expires while waiting', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random, maxConcurrent: 1 });
    const g1 = createGate<string>();
    let secondInvoked = false;

    const first = executeWithModelFallback(['m1'], () => g1.p, { resilience, provider: 'gemini-test-h' });
    const second = executeWithModelFallback(['m1'], async () => { secondInvoked = true; return 'late'; }, { resilience, provider: 'gemini-test-h', deadlineMs: 500 });
    await clock.sleep(0);
    clock.advance(600); // deadline passes while queued
    clock.advance(0);
    await rejects(second, /deadline|timeout|expired/i);
    expect(secondInvoked).toBe(false);
    g1.r('done');
    await first;
  });

  it('rejects immediately when the caller signal is aborted', async () => {
    const clock = fakeClock();
    const resilience = createProviderResilience({ now: clock.now, sleep: clock.sleep, random: clock.random });
    const controller = new AbortController();
    controller.abort();
    let invoked = false;
    await rejects(
      executeWithModelFallback(['m1'], async () => { invoked = true; return 'x'; }, { resilience, provider: 'gemini-test-i', signal: controller.signal }), /abort|cancel/i);
    expect(invoked).toBe(false);
  });
});
