import { rejects } from 'node:assert/strict';
import { describe, expect, it } from 'bun:test';
import { ConversationCoordinator } from '../src/agent/conversation-coordinator';
import { AgentTurnCoordinator } from '../src/agent/turn-coordinator';
import type { ChatMessage } from '../src/domain/types';

type DecisionResult = Awaited<ReturnType<AgentTurnCoordinator['processInboundMessage']>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  return { promise, resolve, reject };
}

/**
 * Bounded negative-assertion window. Long enough that a defective queue
 * (one that proceeds after its configured wait expires) would have run the
 * work; not a substitute for synchronization, only an upper bound on how
 * long we wait before asserting the work never started.
 */

const replyResult: DecisionResult = {
  decision: {
    action: 'reply',
    intent: 'test',
    replyText: 'ok',
    confidence: 1,
    simulatedDelayMs: 0,
    reasoning: 'test'
  },
  shouldSendImmediately: true
};

function makeMessage(id: string, chatId = 'chat1@s.whatsapp.net'): ChatMessage {
  return { id, chatId, sender: chatId, text: 'hello', timestamp: Date.now(), isFromMe: false, type: 'text' };
}

function makeTurnCoordinator(
  process: (message: ChatMessage) => Promise<DecisionResult>,
  turnTimeoutMs: number
) {
  return new AgentTurnCoordinator(
    {
      moderator: { processInboundMessage: process },
      memory: { getChat: () => undefined },
      operator: {
        resolve: async () => ({ status: 'answered' as const, reply: '', evidence: [], workflowId: 'none' })
      },
      enabled: false
    },
    { turnTimeoutMs }
  );
}

describe('ExecutionQueue per-chat admission bound', () => {
  it('rejects same-key callers beyond the per-chat bound until slots drain', async () => {
    const { ExecutionQueue } = await import('../src/agent/execution-queue');
    const queue = new ExecutionQueue({ timeoutMs: 10_000, maxQueuedPerKey: 2 });
    const gate = deferred<void>();
    const releaseOwner = await queue.acquire('chat1');
    // First waiter chains behind the owner (slot 2 of 2).
    const waiter = queue.acquire('chat1');
    // Third unsettled slot exceeds the bound: rejected immediately.
    await rejects(queue.acquire('chat1'), { reason: 'admission_full' });
    releaseOwner();
    await waiter.then((release) => release());
    // Slots drained: the key admits again.
    const release2 = await queue.acquire('chat1');
    release2();
    void gate;
  });
});

describe('WA-002 ConversationCoordinator queue integrity', () => {
  it('an expired queued task never runs, and successors still wait for the active predecessor', async () => {
    const coordinator = new ConversationCoordinator({ timeoutMs: 80 });
    const a = deferred<string>();
    const events: string[] = [];
    let bRan = false;

    const runA = coordinator.run('brand', 'contact', async () => {
      events.push('a:start');
      await a.promise;
      events.push('a:end');
      return 'a';
    });
    const runB = coordinator.run('brand', 'contact', async () => {
      bRan = true;
      return 'b';
    });

    // B's wait expires while A is still active: B must be rejected, not run.
    await rejects(runB, /timeout|expired/i);
    expect(bRan).toBe(false);

    // C arrives after B's expiry. A defective queue would have dropped B's
    // chain slot on expiry, letting C start next to the still-active A.
    let cRan = false;
    const runC = coordinator.run('brand', 'contact', async () => {
      cRan = true;
      events.push('c');
      return 'c';
    });

    // While A is held, C must not run, no matter how B's expiry was handled.
    // (40ms < the 80ms wait bound, so C is still legitimately waiting here.)
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(cRan).toBe(false);

    a.resolve('done');
    expect(await runA).toBe('a');
    expect(await runC).toBe('c');
    expect(events).toEqual(['a:start', 'a:end', 'c']);
    // Expired work must never execute later, even after the queue recovers.
    expect(bRan).toBe(false);
    expect(coordinator.activeConversations).toBe(0);
  });

  it('a failed predecessor does not block the queue', async () => {
    const coordinator = new ConversationCoordinator({ timeoutMs: 1000 });
    const gate = deferred<void>();

    const runA = coordinator.run('brand', 'contact', async () => {
      await gate.promise;
      throw new Error('boom');
    });
    const runB = coordinator.run('brand', 'contact', async () => 'b');

    gate.resolve();
    await rejects(runA, /boom/);
    expect(await runB).toBe('b');
    expect(coordinator.activeConversations).toBe(0);
  });

  it('independent conversations progress concurrently', async () => {
    const coordinator = new ConversationCoordinator({ timeoutMs: 1000 });
    const gateA = deferred<void>();
    const started: string[] = [];

    const runA = coordinator.run('brand', 'contact-a', async () => {
      started.push('a');
      await gateA.promise;
      return 'a';
    });
    const runB = coordinator.run('brand', 'contact-b', async () => {
      started.push('b');
      return 'b';
    });

    expect(await runB).toBe('b');
    expect(started).toEqual(['a', 'b']);
    gateA.resolve();
    expect(await runA).toBe('a');
    expect(coordinator.activeConversations).toBe(0);
  });

  it('repeated wait expiries clean up and the queue recovers', async () => {
    const coordinator = new ConversationCoordinator({ timeoutMs: 80 });
    const blocker = deferred<void>();

    const runA = coordinator.run('brand', 'contact', () => blocker.promise);
    await rejects(
      coordinator.run('brand', 'contact', async () => 'lost-1'), /timeout|expired/i);
    await rejects(
      coordinator.run('brand', 'contact', async () => 'lost-2'), /timeout|expired/i);

    blocker.resolve();
    await runA;
    expect(await coordinator.run('brand', 'contact', async () => 'after')).toBe('after');
    expect(coordinator.activeConversations).toBe(0);
  });
});

describe('WA-001 AgentTurnCoordinator turn ownership', () => {
  it('retains chat ownership until the timed-out turn actually settles; expired queued turns never process', async () => {
    const gate = deferred<DecisionResult>();
    let moderatorCalls = 0;
    const coordinator = makeTurnCoordinator(async () => {
      moderatorCalls += 1;
      await gate.promise;
      return replyResult;
    }, 30);

    // Turn 1 times out against the caller, but its processing continues.
    const r1 = await coordinator.processInboundMessage(makeMessage('m1'));
    expect(r1.decision.intent).toBe('processing_timeout');
    // A timed-out result must not masquerade as a persisted draft.
    expect(r1.decision.action).toBe('ignore');
    expect(r1.shouldSendImmediately).toBe(false);

    // The expired turn still owns the chat: m2 must fail closed, never process.
    const r2 = await coordinator.processInboundMessage(makeMessage('m2'));
    expect(r2.decision.intent).toBe('turn_queue_expired');
    expect(r2.decision.action).toBe('ignore');
    expect(r2.shouldSendImmediately).toBe(false);
    expect(moderatorCalls).toBe(1);

    // Once the expired turn actually settles, the chat recovers.
    gate.resolve(replyResult);
    const r3 = await coordinator.processInboundMessage(makeMessage('m3'));
    expect(r3.decision.action).toBe('reply');
    expect(moderatorCalls).toBe(2);
  });

  it('serializes overlapping messages for one chat while independent chats progress', async () => {
    const gates = new Map<string, ReturnType<typeof deferred<DecisionResult>>>();
    const active: string[] = [];
    const CHAT1 = 'chat1@s.whatsapp.net';
    let maxConcurrentChat1 = 0;
    let concurrentChat1 = 0;
    const coordinator = makeTurnCoordinator(async (message) => {
      if (message.chatId === CHAT1) {
        concurrentChat1 += 1;
        maxConcurrentChat1 = Math.max(maxConcurrentChat1, concurrentChat1);
      }
      active.push(message.id);
      const gate = deferred<DecisionResult>();
      gates.set(message.id, gate);
      const result = await gate.promise;
      if (message.chatId === CHAT1) concurrentChat1 -= 1;
      return result;
    }, 5000);

    const p1 = coordinator.processInboundMessage(makeMessage('m1'));
    const p2 = coordinator.processInboundMessage(makeMessage('m2'));
    const other = coordinator.processInboundMessage(makeMessage('x1', 'chat2@s.whatsapp.net'));

    // m2 is queued behind m1; the independent chat2 turn starts immediately.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(active.toSorted()).toEqual(['m1', 'x1']);

    const x1Gate = gates.get('x1');
    if (!x1Gate) throw new Error('Expected x1 gate');
    x1Gate.resolve(replyResult);
    await other;
    const m1Gate = gates.get('m1');
    if (!m1Gate) throw new Error('Expected m1 gate');
    m1Gate.resolve(replyResult);
    await p1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const m2Gate = gates.get('m2');
    if (!m2Gate) throw new Error('Expected m2 gate');
    m2Gate.resolve(replyResult);
    await p2;
    expect(maxConcurrentChat1).toBe(1);
  });

  it('discards the late result of an expired turn instead of publishing it', async () => {
    const gate = deferred<DecisionResult>();
    let calls = 0;
    const coordinator = makeTurnCoordinator(async () => {
      calls += 1;
      if (calls === 1) await gate.promise;
      return replyResult;
    }, 30);

    const r1 = await coordinator.processInboundMessage(makeMessage('m1'));
    expect(r1.decision.intent).toBe('processing_timeout');

    // The real result arrives after the caller already received the fallback.
    gate.resolve(replyResult);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The SAME coordinator processes the next message normally: the expired
    // turn kept ownership until it settled, then released it.
    const r2 = await coordinator.processInboundMessage(makeMessage('m2'));
    expect(r2.decision.action).toBe('reply');
    expect(calls).toBe(2);
  });

  it('ignores historical and replayed messages without queue interaction', async () => {
    let calls = 0;
    const coordinator = makeTurnCoordinator(async () => {
      calls += 1;
      return replyResult;
    }, 1000);

    const historical = await coordinator.processInboundMessage(makeMessage('h1'), { historical: true });
    const replayed = await coordinator.processInboundMessage(makeMessage('r1'), { replayed: true });
    expect(historical.decision.action).toBe('ignore');
    expect(replayed.decision.action).toBe('ignore');
    expect(calls).toBe(0);
  });
});
