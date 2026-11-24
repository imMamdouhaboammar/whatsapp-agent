import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveRuntimeProfile } from '../src/runtime-profile';
import { createFableWhatsAppAgent } from '../src/index';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'wa-profile-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const fakeMetaConfig = {
  graphVersion: 'v21.0',
  phoneNumberId: '12345678901',
  businessAccountId: '456',
  accessToken: 'fake-token',
  appSecret: 'fake-secret',
  webhookVerifyToken: 'fake-verify'
};

describe('WA-023 resolveRuntimeProfile', () => {
  it('parses explicit profiles and defaults to FULL', () => {
    const minimal = resolveRuntimeProfile('CORE_MINIMAL');
    expect(minimal.name).toBe('CORE_MINIMAL');
    expect(minimal.reflectionEnabled).toBe(false);
    expect(minimal.funnelEnabled).toBe(false);
    expect(minimal.voiceEnabled).toBe(false);
    expect(minimal.proactiveEnabled).toBe(false);

    const full = resolveRuntimeProfile('FULL');
    expect(full.name).toBe('FULL');
    expect(full.reflectionEnabled).toBe(true);
    expect(full.funnelEnabled).toBe(true);
    expect(full.voiceEnabled).toBe(true);

    expect(resolveRuntimeProfile(undefined).name).toBe('FULL');
  });

  it('rejects unknown profile names', () => {
    expect(() => resolveRuntimeProfile('EVERYTHING')).toThrow(/profile/i);
  });

  it('the Baileys wrapper belongs only to the baileys transport', () => {
    const full = resolveRuntimeProfile('FULL');
    expect(full.baileysWrapperEnabled('baileys')).toBe(true);
    expect(full.baileysWrapperEnabled('meta-cloud')).toBe(false);
  });
});

describe('WA-023 profiled bootstrap', () => {
  it('meta-cloud mode never constructs the Baileys wrapper', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: tmp(),
      autoConnect: false,
      transport: 'meta-cloud',
      capabilityAutopilotBrandId: 'test-brand',
      metaCloud: { config: fakeMetaConfig, fetch: (async () => new Response('{}')) as typeof fetch, now: () => 1_700_000_000_000 }
    });
    expect(agent.metaClient).toBeDefined();
    expect(agent.whatsappClient).toBeUndefined();
  }, 15_000);

  it('CORE_MINIMAL creates no reflection engine/worker or funnel engine', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: tmp(),
      autoConnect: false,
      transport: 'baileys',
      runtimeProfile: 'CORE_MINIMAL'
    });
    expect(agent.whatsappClient).toBeDefined(); // selected transport stays
    expect(agent.reflectionWorker).toBeUndefined();
    expect(agent.reflectionEngine).toBeUndefined();
    expect(agent.funnelEngine).toBeUndefined();
    expect(agent.runtimeProfile).toBe('CORE_MINIMAL');
  }, 15_000);

  it('FULL preserves the current eager behavior', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: tmp(),
      autoConnect: false,
      transport: 'baileys',
      runtimeProfile: 'FULL'
    });
    expect(agent.reflectionWorker).toBeDefined();
    expect(agent.funnelEngine).toBeDefined();
    expect(agent.runtimeProfile).toBe('FULL');
  }, 15_000);

  it('exposes a capability matrix reflecting the profile', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: tmp(),
      autoConnect: false,
      transport: 'baileys',
      runtimeProfile: 'CORE_MINIMAL'
    });
    const matrix = agent.capabilityMatrix;
    expect(Array.isArray(matrix)).toBe(true);
    const reflection = matrix.find((r: any) => r.capability === 'reflection');
    expect(reflection?.enabled).toBe(false);
    const transport = matrix.find((r: any) => r.capability === 'transport:baileys');
    expect(transport?.enabled).toBe(true);
  }, 15_000);
});
