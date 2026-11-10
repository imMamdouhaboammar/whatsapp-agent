import { describe, expect, it } from 'bun:test';
import { FunnelRegistry } from '../../src/funnel/registry';

describe('Funnel Registry', () => {
  it('registers and retrieves methods', () => {
    const registry = new FunnelRegistry();
    registry.registerMethod({
      method: 'INVENTORY_SYNC',
      description: 'Sync stock across 2 regional warehouses',
      mode: 'ALL_SETTLED',
      timeoutMs: 2000,
      targets: [
        { id: 'wh-cairo', name: 'Cairo WH', url: 'http://cairo.local/api', enabled: true },
        { id: 'wh-alex', name: 'Alexandria WH', url: 'http://alex.local/api', enabled: true }
      ]
    });

    const m = registry.getMethod('INVENTORY_SYNC');
    expect(m).toBeDefined();
    expect(m?.targets.length).toBe(2);
    expect(m?.mode).toBe('ALL_SETTLED');
  });

  it('validates API keys securely', () => {
    const registry = new FunnelRegistry({ apiKeys: ['secret-key-1', 'secret-key-2'] });

    expect(registry.validateKey('secret-key-1')).toBe(true);
    expect(registry.validateKey('secret-key-2')).toBe(true);
    expect(registry.validateKey('bad-key')).toBe(false);
    expect(registry.validateKey('')).toBe(false);
    expect(registry.validateKey(undefined)).toBe(false);

    const emptyRegistry = new FunnelRegistry();
    expect(emptyRegistry.validateKey('any-key')).toBe(false);
  });

  it('rejects duplicate or invalid method registrations', () => {
    const registry = new FunnelRegistry();
    registry.registerMethod({
      method: 'TEST_METHOD',
      description: 'test',
      mode: 'FIRST_SUCCESS',
      timeoutMs: 1000,
      targets: [{ id: 't1', name: 'T1', url: 'http://t1.test', enabled: true }]
    });

    // Re-registering updates/overwrites cleanly
    registry.registerMethod({
      method: 'TEST_METHOD',
      description: 'updated',
      mode: 'ALL_SETTLED',
      timeoutMs: 1500,
      targets: [{ id: 't1', name: 'T1', url: 'http://t1.test', enabled: true }]
    });

    expect(registry.getMethod('TEST_METHOD')?.description).toBe('updated');
  });

  it('filters out disabled targets from active execution', () => {
    const registry = new FunnelRegistry();
    registry.registerMethod({
      method: 'FALLBACK_LLM',
      description: 'Hedged LLM query',
      mode: 'FIRST_SUCCESS',
      timeoutMs: 1000,
      targets: [
        { id: 'gemini-primary', name: 'Gemini Primary', url: 'http://gemini.local', enabled: true },
        { id: 'gemini-staging', name: 'Gemini Staging', url: 'http://staging.local', enabled: false }
      ]
    });

    const activeTargets = registry.getActiveTargets('FALLBACK_LLM');
    expect(activeTargets.length).toBe(1);
    expect(activeTargets[0].id).toBe('gemini-primary');
  });
});
