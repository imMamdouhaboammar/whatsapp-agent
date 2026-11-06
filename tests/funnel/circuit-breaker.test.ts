import { describe, expect, it } from 'bun:test';
import { CircuitBreaker } from '../../src/funnel/circuit-breaker';

describe('Funnel CircuitBreaker', () => {
  it('starts in CLOSED state and allows successful execution', async () => {
    const cb = new CircuitBreaker({
      targetId: 'target-1',
      failureThreshold: 3,
      cooldownMs: 100
    });

    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);

    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('trips to OPEN after consecutive failures reach threshold', async () => {
    const cb = new CircuitBreaker({
      targetId: 'target-2',
      failureThreshold: 2,
      cooldownMs: 50
    });

    // 1st failure
    await expect(cb.execute(async () => { throw new Error('fail 1'); })).rejects.toThrow('fail 1');
    expect(cb.getState()).toBe('CLOSED');

    // 2nd failure -> trips
    await expect(cb.execute(async () => { throw new Error('fail 2'); })).rejects.toThrow('fail 2');
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);

    // Fast-fails while OPEN
    await expect(cb.execute(async () => 'should not run')).rejects.toThrow(/Circuit breaker OPEN/);
  });

  it('transitions to HALF_OPEN after cooldown and recovers on success', async () => {
    const cb = new CircuitBreaker({
      targetId: 'target-3',
      failureThreshold: 1,
      cooldownMs: 20
    });

    // Trip it
    await expect(cb.execute(async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 25));

    // Can execute trial run
    expect(cb.canExecute()).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');

    // Successful trial closes the breaker
    const res = await cb.execute(async () => 'recovered');
    expect(res).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('resets manually on operator request', async () => {
    const cb = new CircuitBreaker({
      targetId: 'target-4',
      failureThreshold: 1,
      cooldownMs: 10000
    });

    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
  });
});
