import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CANARY_SECRET = 'CANARY-TOKEN-xk29fjs9';
const CANARY_URL = 'https://svc-user:svc-pass@db.internal.example.com:5432/prod';
const CANARY_PHONE = '201092677269';

let warnSpy: ReturnType<typeof spyOn>;
let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

function captured(): string {
  const all = [...warnSpy.mock.calls, ...logSpy.mock.calls, ...errSpy.mock.calls];
  return all.map((args) => args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' ')).join('\n');
}

function setupSpies() {
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  errSpy = spyOn(console, 'error').mockImplementation(() => {});
}
afterEach(() => {
  warnSpy?.mockRestore();
  logSpy?.mockRestore();
  errSpy?.mockRestore();
});

describe('WA-025 privacy-safe logging: no canary leaks, actionable codes remain', () => {
  it('hydration failures never log raw provider errors', async () => {
    setupSpies();
    const { DualMemoryManager } = await import('../src/domain/learning-memory');
    const dataDir = mkdtempSync(join(tmpdir(), 'wa-priv-'));
    try {
      const mgr = new DualMemoryManager({
        storageDir: dataDir,
        persistenceStore: {
          getLearningState: async () => {
            throw new Error(`connect ECONNREFUSED ${CANARY_URL} password=${CANARY_SECRET} phone ${CANARY_PHONE}`);
          }
        } as any
      });
      await mgr.hydrateFromPersistence();
      const out = captured();
      expect(out).not.toContain(CANARY_SECRET);
      expect(out).not.toContain(CANARY_URL);
      expect(out).not.toContain(CANARY_PHONE);
      expect(out).not.toContain('svc-pass');
      // actionable signal remains
      expect(out.length).toBeGreaterThan(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('sync failures never log raw provider error messages', async () => {
    setupSpies();
    const { DualMemoryManager } = await import('../src/domain/learning-memory');
    const dataDir = mkdtempSync(join(tmpdir(), 'wa-priv-'));
    try {
      const mgr = new DualMemoryManager({
        storageDir: dataDir,
        persistenceStore: {
          getLearningState: async () => {
            throw new Error(`FATAL: password authentication failed for user "${CANARY_SECRET}" at ${CANARY_URL}`);
          }
        } as any
      });
      await mgr.syncFromPersistenceStore();
      const out = captured();
      expect(out).not.toContain(CANARY_SECRET);
      expect(out).not.toContain('svc-pass');
      expect(out).not.toContain(CANARY_URL);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('turn failure reasoning never embeds raw provider error content', async () => {
    const { AgentTurnCoordinator } = await import('../src/agent/turn-coordinator');
    const moderator: any = {
      processInboundMessage: async () => {
        throw new Error(`Gemini API Error (400): echo of customer text with token ${CANARY_SECRET} and phone ${CANARY_PHONE}`);
      }
    };
    const coordinator = new AgentTurnCoordinator({
      moderator,
      memory: { getChat: () => undefined } as any,
      operator: { resolve: async () => undefined } as any,
      enabled: false
    } as any);
    const result = await coordinator.processInboundMessage(
      { id: 'm1', chatId: `${CANARY_PHONE}@s.whatsapp.net`, sender: `${CANARY_PHONE}@s.whatsapp.net`, text: 'hi', timestamp: 1, isFromMe: false, type: 'text' } as any
    );
    const reasoning = result.decision.reasoning ?? '';
    expect(reasoning).not.toContain(CANARY_SECRET);
    expect(reasoning).not.toContain(CANARY_PHONE);
  });

  it('describeError strips credential-bearing URLs and long digit runs', async () => {
    const { describeError, redactSensitiveText } = await import('../src/observability/safe-log');
    const raw = `Request failed: GET ${CANARY_URL} 401 token=${CANARY_SECRET} for ${CANARY_PHONE}`;
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain(CANARY_SECRET);
    expect(redacted).not.toContain('svc-user');
    expect(redacted).not.toContain('svc-pass');
    expect(redacted).not.toContain(CANARY_PHONE);
    expect(describeError(new Error(raw))).not.toContain(CANARY_SECRET);
  });
});
