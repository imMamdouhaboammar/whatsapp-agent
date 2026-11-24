import { describe, expect, it } from 'bun:test';
import { runDoctor, verifyBaileysPatch, type DoctorProbes } from '../src/doctor';
import { MemoryStore } from '../src/domain/memory-store';

function baseProbes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    bunVersion: '1.4.5',
    env: {},
    openStorage: () => 3,
    uiBuilt: () => true,
    gcloudAuthenticated: async () => false,
    sessionPaired: () => true,
    ...overrides
  };
}

describe('WA-011 doctor verification integrity', () => {
  it('a storage write probe returning false fails the check and the run', async () => {
    const report = await runDoctor(baseProbes({ testStorageWrite: () => false }));
    const check = report.checks.find((c) => c.id === 'storage-write');
    expect(check?.level).toBe('fail');
    expect(report.exitCode).toBe(1);
    expect(report.liveReady).toBe(false);
  });

  it('a storage write probe returning true passes', async () => {
    const report = await runDoctor(baseProbes({ testStorageWrite: () => true }));
    expect(report.checks.find((c) => c.id === 'storage-write')?.level).toBe('pass');
  });

  it('a present-but-invalid model key fails when verification rejects it', async () => {
    const report = await runDoctor(baseProbes({
      env: { GEMINI_API_KEY: 'AIza-invalid' },
      verifyModelKey: async () => false
    }));
    const check = report.checks.find((c) => c.id === 'model-auth');
    expect(check?.level).toBe('fail');
    expect(report.liveReady).toBe(false);
  });

  it('the verification probe is actually invoked for a configured key, and a verified key passes', async () => {
    let called = false;
    const report = await runDoctor(baseProbes({
      env: { GEMINI_API_KEY: 'AIza-valid' },
      verifyModelKey: async () => { called = true; return true; }
    }));
    expect(called).toBe(true);
    expect(report.checks.find((c) => c.id === 'model-auth')?.level).toBe('pass');
  });

  it('verifyBaileysPatch requires both patch targets, not just the passive flag', () => {
    const unpatched = 'const x = {\n        passive: true, pull: true,\n        lidDbMigrated: false\n};';
    const halfPatched = 'const x = {\n        passive: false,\n        pull: true,\n        lidDbMigrated: false\n};';
    const fullyPatched = 'const x = {\n        passive: false,\n        pull: true,\n        /* lidDbMigrated removed */\n};';
    expect(verifyBaileysPatch(unpatched)).toBe(false);
    expect(verifyBaileysPatch(halfPatched)).toBe(false);
    expect(verifyBaileysPatch(fullyPatched)).toBe(true);
  });

  it('MemoryStore exposes a real write-commit probe', () => {
    const store = new MemoryStore({ dataDir: ':memory:' });
    expect(store.verifyWriteCommit()).toBe(true);
  });
});
