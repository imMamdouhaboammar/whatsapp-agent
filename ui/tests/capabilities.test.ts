import { describe, expect, it } from 'bun:test';
import { featureEnabled } from '../src/lib/capabilities';

describe('WA-024 UI capability gating', () => {
  it('hides an action only when the row is explicitly disabled', () => {
    const rows = [
      { capability: 'feature:reactions', enabled: false, reason: 'not exposed by the Meta Cloud transport' },
      { capability: 'feature:text', enabled: true, reason: 'supported' }
    ];
    expect(featureEnabled(rows, 'feature:reactions', true)).toBe(false);
    expect(featureEnabled(rows, 'feature:text', true)).toBe(true);
  });

  it('falls back when the row is absent (older backend)', () => {
    expect(featureEnabled([], 'feature:reactions', true)).toBe(true);
    expect(featureEnabled([], 'feature:reactions', false)).toBe(false);
  });
});
