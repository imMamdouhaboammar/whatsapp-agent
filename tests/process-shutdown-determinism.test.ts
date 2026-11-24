import { describe, expect, it } from 'bun:test';
import { ProcessLifecycleCoordinator } from '../src/server/lifecycle';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WA-006 deterministic process shutdown', () => {
  it('a failing shutdown task makes the exit code non-zero', async () => {
    const lifecycle = new ProcessLifecycleCoordinator({ timeoutMs: 5000 });
    lifecycle.register('broken_task', 'close_datastores', async () => {
      throw new Error('synthetic datastore failure');
    });
    const code = await lifecycle.shutdown('TEST');
    expect(code).toBe(1);
  });

  it('still returns 0 when every task succeeds', async () => {
    const lifecycle = new ProcessLifecycleCoordinator({ timeoutMs: 5000 });
    let ran = false;
    lifecycle.register('ok_task', 'stop_ingestion', () => { ran = true; });
    const code = await lifecycle.shutdown('TEST');
    expect(code).toBe(0);
    expect(ran).toBe(true);
  });

  it('continues remaining phases after a task failure and reports non-zero', async () => {
    const lifecycle = new ProcessLifecycleCoordinator({ timeoutMs: 5000 });
    const order: string[] = [];
    lifecycle.register('failing_drain', 'drain_queues', async () => {
      order.push('drain');
      throw new Error('synthetic drain failure');
    });
    lifecycle.register('datastore_close', 'close_datastores', () => {
      order.push('close');
    });
    const code = await lifecycle.shutdown('TEST');
    expect(order).toEqual(['drain', 'close']);
    expect(code).toBe(1);
  });

  it('a concurrent second shutdown awaits the in-flight one and shares its result', async () => {
    const lifecycle = new ProcessLifecycleCoordinator({ timeoutMs: 5000 });
    let resourcesClosed = false;
    lifecycle.register('slow_close', 'close_datastores', async () => {
      await sleep(60);
      resourcesClosed = true;
    });
    const first = lifecycle.shutdown('SIGTERM');
    await sleep(10);
    let secondResolvedEarly = false;
    const second = lifecycle.shutdown('SIGINT').then((code) => {
      // The second caller must not observe completion before resources close.
      if (!resourcesClosed) secondResolvedEarly = true;
      return code;
    });
    const [firstCode, secondCode] = await Promise.all([first, second]);
    expect(secondResolvedEarly).toBe(false);
    expect(secondCode).toBe(firstCode);
    expect(resourcesClosed).toBe(true);
  });
});
