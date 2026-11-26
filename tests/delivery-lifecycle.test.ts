import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/domain/memory-store';
import { SendIntentService } from '../src/domain/send-intent-service';
import type { SendIntentInput } from '../src/domain/send-ledger';

/**
 * Restart and ambiguous-delivery lifecycle against a real SQLite file.
 * The transport is a fake: these tests prove ledger behavior, not live WhatsApp or Meta delivery.
 */
const CHAT = '201111111111@s.whatsapp.net';
const dirs: string[] = [];
const open: MemoryStore[] = [];

function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wa-lifecycle-'));
  dirs.push(dir);
  return join(dir, 'messages.sqlite');
}
const store = (path: string) => {
  const s = new MemoryStore({ dataDir: ':memory:', dbPath: path });
  open.push(s);
  return s;
};
const input = (over: Partial<SendIntentInput> = {}): SendIntentInput => ({
  sourceKind: 'ui', sourceId: 'm-1', sourceRevision: 1, actionKind: 'text',
  chatId: CHAT, text: 'Hello', policyRevision: 1, ...over
});

afterEach(() => {
  for (const s of open.splice(0)) { try { s.close(); } catch { /* already closed */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('delivery lifecycle across restarts', () => {
  it('a crash after the network call started becomes uncertain after the lease and is never resent', async () => {
    const path = dbPath();
    const first = store(path);
    const ledger = first.getSendLedger();
    const intent = ledger.createIntent(input());
    const t0 = Date.now();
    const claimed = ledger.claim(intent.id, 'dead-worker', t0, 30_000);
    if (!claimed) throw new Error('Expected claim');
    expect(ledger.tryMarkNetworkStarted(intent.id, claimed.attempt.id, t0 + 1)).toBe(true);
    first.close(); // process dies here: no outcome recorded

    let calls = 0;
    const restarted = new SendIntentService({
      memoryStore: store(path),
      sendText: async () => { calls++; return { messageId: 'should-not-happen' }; }
    });
    // Inside the lease the attempt is still owned: nothing happens.
    expect((await restarted.dispatchDue(t0 + 10_000)).length).toBe(0);
    expect(restarted['options'].memoryStore.getSendLedger().getIntent(intent.id)?.state).toBe('attempting');
    // After lease expiry it is uncertain, and dispatchDue does not send it.
    expect((await restarted.dispatchDue(t0 + 40_000)).length).toBe(0);
    const after = restarted['options'].memoryStore.getSendLedger();
    expect(after.getIntent(intent.id)?.state).toBe('uncertain');
    expect(after.getAttempts(intent.id)[0]?.failureCode).toBe('process_interrupted');
    expect(calls).toBe(0);
  });

  it('a queued pre-network retry survives a restart and is sent exactly once', async () => {
    const path = dbPath();
    const first = store(path);
    let calls = 0;
    const flaky = new SendIntentService({
      memoryStore: first,
      retryBaseMs: 1,
      sendText: async () => { calls++; throw Object.assign(new Error('offline'), { code: 'WHATSAPP_NOT_CONNECTED' }); }
    });
    const queued = await flaky.sendText(input());
    expect(queued.intent.state).toBe('queued');
    first.close();

    const sent: string[] = [];
    const restarted = new SendIntentService({
      memoryStore: store(path),
      sendText: async (_chat, text) => { sent.push(text); return { messageId: 'native-1' }; }
    });
    const results = await restarted.dispatchDue(Date.now() + 120_000);
    expect(results.map((r) => r.intent.state)).toEqual(['accepted']);
    // A second sweep finds nothing to do.
    expect(await restarted.dispatchDue(Date.now() + 120_000)).toHaveLength(0);
    expect(sent).toEqual(['Hello']);
    expect(calls).toBe(1);
  });

  it('two workers on the same database never both send one intent', async () => {
    const path = dbPath();
    const a = store(path);
    const b = store(path);
    const created = a.getSendLedger().createIntent(input());
    let calls = 0;
    const slow = async () => { calls++; await new Promise((_resolve) => setTimeout(_resolve, 20)); return { messageId: `native-${calls}` }; };
    const serviceA = new SendIntentService({ memoryStore: a, sendText: slow });
    const serviceB = new SendIntentService({ memoryStore: b, sendText: slow });
    const [ra, rb] = await Promise.all([serviceA.dispatch(created.id), serviceB.dispatch(created.id)]);
    expect(calls).toBe(1);
    expect([ra.intent.state, rb.intent.state].filter((s) => s === 'accepted').length).toBeGreaterThanOrEqual(1);
    expect(a.getSendLedger().getAttempts(created.id)).toHaveLength(1);
  });

  it('a provider failure after acceptance survives a restart and cannot be revived by a later receipt', async () => {
    const path = dbPath();
    const first = store(path);
    const svc = new SendIntentService({ memoryStore: first, sendText: async () => ({ messageId: 'wamid-1' }) });
    const sent = await svc.sendText(input());
    expect(sent.intent.state).toBe('accepted');
    first.close();

    const restarted = new SendIntentService({ memoryStore: store(path), sendText: async () => ({ messageId: 'never' }) });
    expect(restarted.deliveryFailed(CHAT, 'wamid-1')?.state).toBe('failed');
    expect(restarted.receipt(CHAT, 'wamid-1', 'delivered')).toBeUndefined();
    expect(restarted.receipt(CHAT, 'wamid-1', 'read')).toBeUndefined();
    expect(restarted['options'].memoryStore.getSendLedger().getIntent(sent.intent.id)?.state).toBe('failed');
    // A failure for an unknown or other-chat native ID changes nothing.
    expect(restarted.deliveryFailed('other@s.whatsapp.net', 'wamid-1')).toBeUndefined();
  });

  it('out-of-order receipts after a restart only move forward', async () => {
    const path = dbPath();
    const first = store(path);
    const svc = new SendIntentService({ memoryStore: first, sendText: async () => ({ messageId: 'wamid-2' }) });
    await svc.sendText(input({ sourceId: 'm-2' }));
    first.close();
    const restarted = new SendIntentService({ memoryStore: store(path), sendText: async () => ({ messageId: 'x' }) });
    expect(restarted.receipt(CHAT, 'wamid-2', 'read')?.state).toBe('read');
    expect(restarted.receipt(CHAT, 'wamid-2', 'delivered')).toBeUndefined();
    expect(restarted.receipt(CHAT, 'wamid-2', 'sent')).toBeUndefined();
    // Re-read from a fresh connection: the stored state must still be `read`, not merely unreturned.
    const created = store(path).getSendLedger();
    expect(created.advanceReceipt(CHAT, 'wamid-2', 'read')).toBeUndefined();
    expect(created.getDiagnosticsSummary().states.read).toBe(1);
  });

  it('explicit retry of an uncertain send after a restart creates exactly one child and is idempotent per mutation ID', async () => {
    const path = dbPath();
    const first = store(path);
    const svc = new SendIntentService({ memoryStore: first, sendText: async () => { throw new Error('unknown'); } });
    const original = await svc.sendText(input({ sourceId: 'm-3' }));
    expect(original.intent.state).toBe('uncertain');
    first.close();

    let calls = 0;
    const restarted = new SendIntentService({
      memoryStore: store(path),
      sendText: async () => { calls++; return { messageId: 'wamid-retry' }; }
    });
    const retry = await restarted.retryUncertain(original.intent.id, 'user-approved-1');
    const again = await restarted.retryUncertain(original.intent.id, 'user-approved-1');
    expect(retry.intent.id).toBe(again.intent.id);
    expect(retry.intent.state).toBe('accepted');
    expect(calls).toBe(1);
  });

  it('a send that outlives its lease records its native ID instead of staying uncertain', async () => {
    const path = dbPath();
    const s = store(path);
    let calls = 0;
    const svc = new SendIntentService({
      memoryStore: s,
      sendText: async () => { calls++; await new Promise((_resolve) => setTimeout(_resolve, 30)); return { messageId: 'late-native' }; }
    });
    const created = s.getSendLedger().createIntent(input({ sourceId: 'm-4' }));
    const pending = svc.dispatch(created.id);
    await new Promise((_resolve) => setTimeout(_resolve, 5));
    // A sweeper in a second process runs after the lease while the first send is still in flight.
    store(path).getSendLedger().recoverInterrupted(Date.now() + 60_000);
    const result = await pending;
    expect(calls).toBe(1);
    expect(result.intent.state).toBe('accepted');
    expect(result.intent.nativeMessageId).toBe('late-native');
    expect(s.getSendLedger().getAttempts(created.id)).toHaveLength(1);
    const events = s.getSendLedger().getEvents(created.id).map((e) => e.reason);
    expect(events).toContain('process_interrupted');
    expect(events).toContain('late_transport_acceptance');
    // Receipts now correlate, which they could not while the ID was lost.
    expect(svc.receipt(CHAT, 'late-native', 'delivered')?.state).toBe('delivered');
  });

  it('late acceptance is refused for any other attempt or an intent already retried', () => {
    const s = store(dbPath());
    const ledger = s.getSendLedger();
    const created = ledger.createIntent(input({ sourceId: 'm-5' }));
    const claimed = ledger.claim(created.id, 'w', Date.now(), 1);
    if (!claimed) throw new Error('Expected claim');
    ledger.recoverInterrupted(Date.now() + 10);
    expect(ledger.accepted(created.id, 'some-other-attempt', 'native-x')).toBeUndefined();
    expect(ledger.getIntent(created.id)?.state).toBe('uncertain');
    expect(ledger.accepted(created.id, claimed.attempt.id, 'native-ok')?.state).toBe('accepted');
    // Second acceptance for the same attempt cannot overwrite.
    expect(ledger.accepted(created.id, claimed.attempt.id, 'native-other')).toBeUndefined();
    expect(ledger.getIntent(created.id)?.nativeMessageId).toBe('native-ok');
  });

  it('late acceptance cancels a queued retry child so the customer gets one copy', () => {
    const s = store(dbPath());
    const ledger = s.getSendLedger();
    const created = ledger.createIntent(input({ sourceId: 'm-6' }));
    const claimed = ledger.claim(created.id, 'w', Date.now(), 1);
    if (!claimed) throw new Error('Expected claim');
    ledger.recoverInterrupted(Date.now() + 10);
    const child = ledger.createRetryIntent({ ...input({ sourceId: 'm-6-retry' }), parentIntentId: created.id });
    expect(ledger.accepted(created.id, claimed.attempt.id, 'native-late')?.state).toBe('accepted');
    expect(ledger.getIntent(child.id)?.state).toBe('failed');
    expect(ledger.getEvents(child.id).map((e) => e.reason)).toContain('superseded_by_late_acceptance');
    expect(ledger.claim(child.id, 'w2')).toBeUndefined();
  });

  it('late acceptance never timestamps before the interruption, even if the clock went backwards', () => {
    const s = store(dbPath());
    const ledger = s.getSendLedger();
    const created = ledger.createIntent(input({ sourceId: 'm-7' }));
    const claimed = ledger.claim(created.id, 'w', 1_000, 1);
    if (!claimed) throw new Error('Expected claim');
    ledger.recoverInterrupted(5_000);
    const accepted = ledger.accepted(created.id, claimed.attempt.id, 'native-t', 2_000);
    if (!accepted) throw new Error('Expected accepted');
    expect(accepted.updatedAt).toBeGreaterThanOrEqual(5_000);
  });
});
