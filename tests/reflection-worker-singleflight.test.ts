import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { ReflectionEngine } from '../src/ai/reflection-engine';
import { ReflectionWorker } from '../src/agent/reflection-worker';
import { MemoryStore } from '../src/domain/memory-store';

let testDir = './data/test-worker-' + Date.now();
const CHAT = '201018880010@s.whatsapp.net';
const stores: MemoryStore[] = [];

beforeEach(() => {
  testDir = './data/test-worker-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeWorker(evaluate: (params: any) => Promise<any>) {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  stores.push(memoryStore);
  const memoryManager = new DualMemoryManager({ storageDir: testDir, persistSqlite: false });
  const engine = { evaluateThread: evaluate } as unknown as ReflectionEngine;
  const worker = new ReflectionWorker({ memoryStore, memoryManager, reflectionEngine: engine, idleThresholdMs: 0 });
  return { memoryStore, memoryManager, worker };
}

const okResult = { selfCorrectionsDetected: 0, rulesAdded: 0, bestPracticesAdded: 0, factsAdded: 0, summary: 'ok' };

function addMessage(memoryStore: MemoryStore, id: string, timestamp: number) {
  memoryStore.saveInboundMessageWithJob({
    id, chatId: CHAT, sender: CHAT, text: 'hello ' + id,
    timestamp, isFromMe: false, type: 'text'
  }, { createJob: false });
}

describe('WA-018 reflection sweeps are single-flight with durable feedback', () => {
  it('a sweep tick while a sweep is in flight does not start a second evaluation', async () => {
    const gate = deferred<any>();
    let evaluations = 0;
    const { memoryStore, worker } = makeWorker(async () => { evaluations++; await gate.promise; return okResult; });
    addMessage(memoryStore, 'm1', Date.now() - 1000);
    worker.recordActivity(CHAT, Date.now() - 1000);

    const first = worker.sweepColdThreads();
    await new Promise((r) => setTimeout(r, 20));
    const second = await worker.sweepColdThreads(); // must skip, not queue
    expect(second.evaluatedCount).toBe(0);
    expect(evaluations).toBe(1);
    gate.resolve(okResult);
    await first;
    expect(evaluations).toBe(1);
  });

  it('feedback survives a failed evaluation and is delivered to the retry', async () => {
    let calls = 0;
    const seen: any[] = [];
    const { memoryStore, worker } = makeWorker(async (params) => {
      calls++;
      seen.push(params.moderationFeedback?.length ?? 0);
      if (calls === 1) throw new Error('model unavailable');
      return okResult;
    });
    addMessage(memoryStore, 'm1', Date.now() - 1000);
    worker.recordActivity(CHAT, Date.now() - 1000);
    worker.recordModerationFeedback({ chatId: CHAT, feedbackType: 'rejected', humanNote: 'too pushy' });

    await worker.reflectOnThread(CHAT, 'test');
    expect(calls).toBe(1);
    await worker.reflectOnThread(CHAT, 'test');
    expect(calls).toBe(2);
    expect(seen[1]).toBe(1); // the failed attempt did not consume the feedback
  });

  it('feedback arriving during an evaluation is not acknowledged by it', async () => {
    const gate = deferred<any>();
    const seen: any[] = [];
    const { memoryStore, worker } = makeWorker(async (params) => {
      seen.push(params.moderationFeedback?.length ?? 0);
      await gate.promise;
      return okResult;
    });
    addMessage(memoryStore, 'm1', Date.now() - 1000);
    worker.recordActivity(CHAT, Date.now() - 1000);
    worker.recordModerationFeedback({ chatId: CHAT, feedbackType: 'rejected', humanNote: 'first' });

    const inFlight = worker.reflectOnThread(CHAT, 'test');
    await new Promise((r) => setTimeout(r, 20));
    worker.recordModerationFeedback({ chatId: CHAT, feedbackType: 'edited', humanNote: 'second' });
    gate.resolve(okResult);
    await inFlight;

    // The late feedback must still be pending for the next reflection.
    seen.length = 0;
    await worker.reflectOnThread(CHAT, 'test');
    expect(seen[0]).toBe(1);
  });

  it('the reflected watermark is the exact evaluated snapshot, not wall-clock completion', async () => {
    const gate = deferred<any>();
    const t1 = Date.now() - 5000;
    const t2 = Date.now() - 4000;
    const { memoryStore, worker } = makeWorker(async () => { await gate.promise; return okResult; });
    addMessage(memoryStore, 'm1', t1);
    addMessage(memoryStore, 'm2', t2);
    worker.recordActivity(CHAT, t2);

    const inFlight = worker.reflectOnThread(CHAT, 'test');
    await new Promise((r) => setTimeout(r, 20));
    // A newer message arrives while the evaluation is still running.
    const t3 = Date.now();
    addMessage(memoryStore, 'm3', t3);
    worker.recordActivity(CHAT, t3);
    gate.resolve(okResult);
    await inFlight;

    const activity = worker.getThreadActivity(CHAT);
    expect(activity?.lastReflectedAt).toBe(t2); // NOT t3, NOT Date.now()
  });

  it('stopPeriodicSweep drains an in-flight sweep before returning', async () => {
    const gate = deferred<any>();
    const { memoryStore, worker } = makeWorker(async () => { await gate.promise; return okResult; });
    addMessage(memoryStore, 'm1', Date.now() - 1000);
    worker.recordActivity(CHAT, Date.now() - 1000);
    worker.startPeriodicSweep(10);
    await new Promise((r) => setTimeout(r, 30));
    const stopped = worker.stopPeriodicSweep();
    let drained = false;
    void stopped.then(() => { drained = true; });
    expect(drained).toBe(false);
    gate.resolve(okResult);
    await stopped;
    expect(drained).toBe(true);
  });
});
