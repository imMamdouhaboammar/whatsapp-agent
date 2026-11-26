import { describe, expect, it } from 'bun:test';
import { createDefaultFunnelEngine } from '../src/funnel/default-engine';

describe('default funnel engine', () => {
  it('registers the two built-in methods', () => {
    const methods = createDefaultFunnelEngine({ port: 3000 }).registry.listMethods();
    expect(methods.map((m) => m.method).toSorted()).toEqual(['INVENTORY_DISPATCH', 'WEBHOOK_FANOUT']);
  });

  it('points the internal stock target at the configured port', () => {
    const inventory = createDefaultFunnelEngine({ port: 4123 }).registry.listMethods().find((m) => m.method === 'INVENTORY_DISPATCH');
    if (!inventory) throw new Error('Expected INVENTORY_DISPATCH method');
    expect(inventory.targets[0]?.url).toBe('http://127.0.0.1:4123/api/brand/stock');
  });

  it('builds independent engines so circuit-breaker state is not shared', () => {
    const a = createDefaultFunnelEngine({ port: 3000 });
    const b = createDefaultFunnelEngine({ port: 3000 });
    expect(a).not.toBe(b);
    expect(a.registry).not.toBe(b.registry);
  });
});

it('does not dispatch to the nonexistent built-in inventory endpoint before configuration', () => {
  const engine = createDefaultFunnelEngine({ port: 4123 });
  expect(engine.registry.getActiveTargets('INVENTORY_DISPATCH')).toEqual([]);
});
