import { describe, expect, it } from 'bun:test';
import { BurstAccumulator, type FusedBurst } from '../src/domain/burst-accumulator';
import type { ChatMessage } from '../src/domain/types';

function makeMessage(id: string, chatId = 'chat1@s.whatsapp.net'): ChatMessage {
  return { id, chatId, sender: chatId, text: `text ${id}`, timestamp: Date.now(), isFromMe: false, type: 'text' };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  return { promise, resolve, reject };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WA-007 burst drain integrity', () => {
  it('drain stays pending until an already-started callback completes', async () => {
    const gate = deferred();
    let finished = false;
    const acc = new BurstAccumulator({
      windowMs: 10,
      onBurst: async () => { await gate.promise; finished = true; }
    });

    acc.push(makeMessage('m1'));
    const drainP = acc.drain();

    // The callback has started but is blocked; drain must not report done.
    let drained = false;
    void drainP.then(() => { drained = true; return undefined; });
    await sleep(80);
    expect(finished).toBe(false);
    expect(drained).toBe(false);

    gate.resolve();
    await drainP;
    expect(finished).toBe(true);
    expect(drained).toBe(true);
  });

  it('stopIntake rejects later pushes without dropping already-buffered work', async () => {
    const delivered: FusedBurst[] = [];
    const acc = new BurstAccumulator({
      windowMs: 20,
      onBurst: (burst) => { delivered.push(burst); }
    });

    expect(acc.push(makeMessage('m1'))).toBe(true);
    acc.stopIntake();
    expect(acc.push(makeMessage('m2'))).toBe(false);
    expect(acc.hasPending('chat1@s.whatsapp.net')).toBe(true);

    await acc.drain();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('drain is idempotent and releases timers', async () => {
    const acc = new BurstAccumulator({ windowMs: 5_000, onBurst: () => {} });
    acc.push(makeMessage('m1'));

    await acc.drain();
    await acc.drain();
    expect(acc.hasPending('chat1@s.whatsapp.net')).toBe(false);
    expect(acc.timerCount).toBe(0);
    expect(acc.inFlightCount).toBe(0);
  });

  it('a callback that outlives the drain deadline is reported as undrained', async () => {
    const gate = deferred();
    const acc = new BurstAccumulator({
      windowMs: 10,
      onBurst: async () => { await gate.promise; }
    });

    acc.push(makeMessage('m1'));
    const result = await acc.drain({ deadlineMs: 60 });
    expect(result.completed).toBe(false);
    expect(result.inFlightChats).toContain('chat1@s.whatsapp.net');

    gate.resolve();
    await sleep(20);
  });
});
