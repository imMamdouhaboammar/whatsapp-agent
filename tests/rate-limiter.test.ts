import { describe, expect, it } from 'bun:test';
import { HumanRateLimiter } from '../src/domain/rate-limiter';

describe('HumanRateLimiter', () => {
  it('calculates typing delay bounded by min and max limits', () => {
    const limiter = new HumanRateLimiter({ minDelayMs: 1000, maxDelayMs: 3000, charPerSecond: 20 });
    const shortDelay = limiter.calculateTypingDelay('hi');
    expect(shortDelay).toBeGreaterThanOrEqual(1000);
    expect(shortDelay).toBeLessThanOrEqual(3000);

    const longText = 'A'.repeat(500);
    const longDelay = limiter.calculateTypingDelay(longText);
    expect(longDelay).toBe(3000);
  });

  it('detects duplicate messages sent in rapid succession', () => {
    const limiter = new HumanRateLimiter();
    const chat = '12345@s.whatsapp.net';
    expect(limiter.isDuplicate(chat, 'Hello there')).toBe(false);
    expect(limiter.isDuplicate(chat, 'Hello there')).toBe(true);
    expect(limiter.isDuplicate(chat, 'Different message')).toBe(false);
  });

  it('serializes executions in the per-chat queue', async () => {
    const limiter = new HumanRateLimiter();
    const chat = 'user@s.whatsapp.net';
    const executed: number[] = [];

    await Promise.all([
      limiter.enqueue(chat, async () => {
        await new Promise((r) => setTimeout(r, 20));
        executed.push(1);
      }),
      limiter.enqueue(chat, async () => {
        executed.push(2);
      })
    ]);

    expect(executed).toEqual([1, 2]);
  });
});
