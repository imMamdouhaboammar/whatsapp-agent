import { afterEach, describe, expect, test } from 'bun:test';
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SendIntentService } from '../src/domain/send-intent-service';
import { SendLedger, type SendIntentInput } from '../src/domain/send-ledger';
import { DiagnosticsCore } from '../src/observability/diagnostics-core';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';

const stores: MemoryStore[] = [];
const ownerToken = 'owner-only-test-authorization-value';
const chatId = '201123456789@s.whatsapp.net';
const messageText = 'Sensitive customer message for diagnostics test';
const sourceId = 'private-client-mutation';
const nativeId = 'native-remote-message-id';

function memory() {
  const store = new MemoryStore({ dataDir: ':memory:' });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const intent = (overrides: Partial<SendIntentInput> = {}): SendIntentInput => ({
  sourceKind: 'ui',
  sourceId,
  sourceRevision: 1,
  actionKind: 'text',
  chatId,
  text: messageText,
  policyRevision: 1,
  ...overrides
});

function api(store: MemoryStore, diagnostics: DiagnosticsCore) {
  const whatsappClient = new WhatsAppSocketClient();
  const moderatorAgent = new ModeratorAgent({ generateContent: async () => {
    throw new Error('Unexpected model call in diagnostics test');
  } }, store);
  return createApiServer({
    dashboardToken: ownerToken,
    memoryStore: store,
    diagnostics,
    whatsappClient,
    moderatorAgent,
    sse: new SSEBroadcaster()
  });
}

describe('S08 and S01 durable send diagnostics integration', () => {
  test('follows a durable UI send through correlated stages without duplicating events', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    let sends = 0;
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => ({ messageId: `${nativeId}-${++sends}` })
    });

    const first = await service.sendText(intent());
    const duplicate = await service.sendText(intent());
    expect(first.intent.id).toBe(duplicate.intent.id);
    expect(first.intent.state).toBe('accepted');
    expect(sends).toBe(1);
    expect(store.getSendLedger().getAttempts(first.intent.id)[0]?.traceId).toBe(first.intent.id);
    expect(diagnostics.getTrace(first.intent.id).map(event => event.stage)).toEqual([
      'intent_created', 'sending', 'accepted'
    ]);
    expect(diagnostics.snapshot().metrics.receiptStates.accepted).toBe(1);
    expect(diagnostics.snapshot().metrics.sendQueueLatencyMs.samples).toBe(1);
  });

  test('replaying a queued intent from an earlier process never invents a fresh creation timestamp', async () => {
    const store = memory();
    const previous = store.getSendLedger().createIntent(intent(), Date.now() - 60_000);
    const diagnostics = new DiagnosticsCore();
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => ({ messageId: nativeId })
    });
    const result = await service.sendText(intent());
    expect(result.intent.id).toBe(previous.id);
    expect(result.intent.state).toBe('accepted');
    expect(diagnostics.getTrace(previous.id).map(event => event.stage)).toEqual(['sending', 'accepted']);
    expect(diagnostics.snapshot().metrics.sendQueueLatencyMs.samples).toBe(0);
  });

  test('replaying a previously queued explicit retry does not restart its creation clock', async () => {
    const store = memory();
    const ledger = store.getSendLedger();
    const original = ledger.createIntent(intent());
    const claim = ledger.claim(original.id, 'prior-process-worker', Date.now());
    expect(claim).toBeDefined();
    if (!claim) throw new Error('Expected claim');
    ledger.uncertain(original.id, claim.attempt.id);
    const retry = ledger.createRetryIntent(intent({
      parentIntentId: original.id,
      sourceId: `retry:${original.id}:owner-retry`
    }));
    const diagnostics = new DiagnosticsCore();
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => ({ messageId: nativeId })
    });
    const result = await service.retryUncertain(original.id, 'owner-retry');
    expect(result.intent.id).toBe(retry.id);
    expect(result.intent.state).toBe('accepted');
    expect(diagnostics.getTrace(retry.id).map(event => event.stage)).toEqual(['sending', 'accepted']);
    expect(diagnostics.snapshot().metrics.sendQueueLatencyMs.samples).toBe(0);
  });

  test('ambiguous network outcomes remain uncertain through repeat requests, without any replay', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    let sends = 0;
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => {
        sends++;
        throw new Error('private socket stack output');
      }
    });
    const first = await service.sendText(intent());
    const again = await service.sendText(intent());
    expect(first.intent.state).toBe('uncertain');
    expect(again.intent.state).toBe('uncertain');
    expect(sends).toBe(1);
    expect(diagnostics.getTrace(first.intent.id).at(-1)).toMatchObject({
      stage: 'sending', outcome: 'uncertain'
    });
    expect(diagnostics.snapshot().metrics.uncertainSends.count).toBe(1);
    const json = JSON.stringify(diagnostics.snapshot());
    for (const sensitive of [chatId, messageText, sourceId, nativeId, 'private socket stack output']) {
      expect(json).not.toContain(sensitive);
    }
  });

  test('receipt advances only after exact durable correlation and never downgrades read', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => ({ messageId: nativeId })
    });
    const sent = await service.sendText(intent());
    expect(service.receipt('different-chat-id', nativeId, 'read')).toBeUndefined();
    expect(service.receipt(chatId, 'wrong-native-id', 'read')).toBeUndefined();
    expect(diagnostics.snapshot().metrics.receiptStates.read).toBe(0);
    expect(service.receipt(chatId, nativeId, 'read')?.state).toBe('read');
    expect(service.receipt(chatId, nativeId, 'delivered')).toBeUndefined();
    expect(store.getSendLedger().getIntent(sent.intent.id)?.state).toBe('read');
    expect(diagnostics.snapshot().metrics.receiptStates).toEqual({
      accepted: 0, delivered: 0, read: 1
    });
    expect(diagnostics.getTrace(sent.intent.id).filter(event => event.stage === 'receipt_updated')).toHaveLength(1);
  });

  test('a buffered early read becomes a correlated receipt after acceptance is saved', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => {
        store.addMessage({
          id: nativeId, chatId, sender: 'me', text: messageText,
          timestamp: Date.now(), isFromMe: true, type: 'text', status: 'read'
        });
        return { messageId: nativeId };
      }
    });
    const result = await service.sendText(intent());
    expect(result.intent.state).toBe('read');
    expect(diagnostics.snapshot().metrics.receiptStates.read).toBe(1);
    expect(diagnostics.getTrace(result.intent.id).map(event => event.receiptState).filter(Boolean)).toEqual(['read']);
  });

  test('telemetry exceptions cannot block transport or change durable state', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    const realStart = diagnostics.startTrace.bind(diagnostics);
    let deliveries = 0;
    diagnostics.startTrace = () => { throw new Error('instrumentation unavailable'); };
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      sendText: async () => ({ messageId: ++deliveries === 1 ? nativeId : nativeId + '-second' })
    });
    const result = await service.sendText(intent());
    expect(result.intent.state).toBe('accepted');
    expect(store.getSendLedger().getIntent(result.intent.id)?.state).toBe('accepted');

    diagnostics.startTrace = realStart;
    diagnostics.recordStage = () => { throw new Error('instrumentation unavailable'); };
    const second = await service.sendText(intent({ sourceId: 'another-independent-intent' }));
    expect(second.intent.state).toBe('accepted');
    diagnostics.recordReceipt = () => { throw new Error('instrumentation unavailable'); };
    expect(service.receipt(chatId, nativeId, 'read')?.state).toBe('read');
    expect(store.getSendLedger().getIntent(result.intent.id)?.state).toBe('read');
  });

  test('owner endpoint labels SQLite counts separately from volatile process samples', async () => {
    const store = memory();
    const initialDiagnostics = new DiagnosticsCore();
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics: initialDiagnostics,
      sendText: async () => { throw new Error('ambiguous private transport issue'); }
    });
    await service.sendText(intent());
    const app = api(store, new DiagnosticsCore());
    const forbidden = await app.request('/api/diagnostics');
    expect(forbidden.status).toBe(401);
    const response = await app.request('/api/diagnostics', {
      headers: { authorization: 'Bearer ' + ownerToken }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      persisted: { source: 'sqlite_send_ledger', states: { uncertain: 1 }, totalIntents: 1 },
      process: { scope: 'current_process', snapshot: { metrics: { uncertainSends: { count: 0 } } } }
    });
    const json = JSON.stringify(body);
    for (const sensitive of [chatId, messageText, sourceId, nativeId, 'ambiguous private transport issue']) {
      expect(json).not.toContain(sensitive);
    }
  });

  test('diagnostics snapshot failure leaves persisted owner data available without leaking exceptions', async () => {
    const store = memory();
    store.getSendLedger().createIntent(intent());
    const diagnostics = new DiagnosticsCore();
    diagnostics.snapshot = () => { throw new Error('private instrumentation unavailable'); };
    const response = await api(store, diagnostics).request('/api/diagnostics', {
      headers: { authorization: 'Bearer ' + ownerToken }
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      persisted: { states: { queued: 1 } },
      process: { status: 'unavailable', snapshot: null }
    });
    expect(JSON.stringify(body)).not.toContain('private instrumentation unavailable');
  });

  test('explicit offline failures may retry or exhaust, without false acceptance or uncertainty metrics', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    let calls = 0;
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      maxAttempts: 2,
      retryBaseMs: 1,
      sendText: async () => {
        calls++;
        throw Object.assign(new Error('connection is offline'), { code: 'WHATSAPP_NOT_CONNECTED' });
      }
    });
    const first = await service.sendText(intent());
    expect(first.intent.state).toBe('queued');
    expect(store.getSendLedger().getDiagnosticsSummary().states.queued).toBe(1);
    expect(diagnostics.snapshot().metrics.uncertainSends.count).toBe(0);
    expect(diagnostics.snapshot().metrics.receiptStates.accepted).toBe(0);
    const second = await service.dispatch(first.intent.id, Date.now() + 1000);
    expect(second.intent.state).toBe('failed');
    expect(calls).toBe(2);
    expect(store.getSendLedger().getDiagnosticsSummary().states.failed).toBe(1);
    expect(diagnostics.snapshot().metrics.uncertainSends.count).toBe(0);
    expect(diagnostics.snapshot().metrics.receiptStates.accepted).toBe(0);
  });

  test('voice preparation failure is durable but never represented as a network send', async () => {
    const store = memory();
    const diagnostics = new DiagnosticsCore();
    const service = new SendIntentService({
      memoryStore: store,
      diagnostics,
      maxAttempts: 1,
      prepareVoice: async () => { throw new Error('private voice preparation error'); },
      sendVoice: async () => { throw new Error('network must never be called'); },
      sendText: async () => { throw new Error('text not configured'); }
    });
    const result = await service.sendVoice(intent({ sourceId: 'voice-preparation', actionKind: 'voice' }));
    expect(result.intent.state).toBe('failed');
    expect(diagnostics.getTrace(result.intent.id).map(event => event.stage)).toEqual(['intent_created']);
    expect(store.getSendLedger().getAttempts(result.intent.id)[0]?.networkStartedAt).toBeUndefined();
  });

  test('an actual SQLite reopen retains uncertain counts while a new process has no traces', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wa-diagnostics-'));
    const dbPath = join(directory, 'ledger.sqlite');
    let first: MemoryStore | undefined;
    let reopened: MemoryStore | undefined;
    try {
      first = new MemoryStore({ dataDir: ':memory:', dbPath });
      const sender = new SendIntentService({
        memoryStore: first,
        diagnostics: new DiagnosticsCore(),
        sendText: async () => { throw new Error('ambiguous delivery'); }
      });
      expect((await sender.sendText(intent())).intent.state).toBe('uncertain');
      first.close();
      first = undefined;
      reopened = new MemoryStore({ dataDir: ':memory:', dbPath });
      const response = await api(reopened, new DiagnosticsCore()).request('/api/diagnostics', {
        headers: { authorization: 'Bearer ' + ownerToken }
      });
      const body: unknown = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        persisted: { states: { uncertain: 1 } },
        process: { snapshot: { traceCount: 0 } }
      });
    } finally {
      first?.close();
      reopened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('SQLite diagnostic counts and oldest uncertainty come from one read snapshot during concurrent writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wa-diagnostics-snapshot-'));
    const dbPath = join(directory, 'ledger.sqlite');
    const raw = new Database(dbPath);
    const writer = new Database(dbPath);
    try {
      raw.run('PRAGMA journal_mode=WAL');
      writer.run('PRAGMA journal_mode=WAL');
      let raced = false;
      let targetId = '';
      const prepare = raw.prepare.bind(raw);
      raw.prepare = <Row, Params extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: Params) => {
        const statement = prepare<Row, Params>(sql, params);
        if (sql.includes('SELECT state, COUNT(*) AS count FROM send_intents')) {
          const all = statement.all.bind(statement);
          statement.all = (...bindings) => {
            const counts = all(...bindings);
            if (!raced) {
              raced = true;
              writer.prepare("UPDATE send_intents SET state='read' WHERE id=?").run(targetId);
            }
            return counts;
          };
        }
        return statement;
      };
      const ledger = new SendLedger(raw);
      const entry = ledger.createIntent(intent(), 100);
      targetId = entry.id;
      const claim = ledger.claim(entry.id, 'worker', 500);
      if (!claim) throw new Error('Expected claim');
      ledger.uncertain(entry.id, claim.attempt.id, 'ambiguous', 1_000);
      const summary = ledger.getDiagnosticsSummary(60_000);
      expect(raced).toBe(true);
      expect(summary.states.uncertain).toBe(1);
      expect(summary.oldestUncertainAgeMs).toBe(59_000);
      expect(writer.prepare('SELECT state FROM send_intents WHERE id=?').get(entry.id)).toMatchObject({ state: 'read' });
    } finally {
      writer.close();
      raw.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('SQLite state totals include queued, accepted and read independently of current process traces', async () => {
    const store = memory();
    const ledger = store.getSendLedger();
    const queued = ledger.createIntent(intent({ sourceId: 'queued-mutation' }));
    const accepted = ledger.createIntent(intent({ sourceId: 'accepted-mutation' }));
    const claimed = ledger.claim(accepted.id, 'test-worker', Date.now());
    if (!claimed) throw new Error('Expected claim');
    expect(ledger.tryMarkNetworkStarted(accepted.id, claimed.attempt.id)).toBe(true);
    ledger.accepted(accepted.id, claimed.attempt.id, nativeId);
    ledger.advanceReceipt(chatId, nativeId, 'read');

    const diagnostics = new DiagnosticsCore();
    const body: unknown = await (await api(store, diagnostics).request('/api/diagnostics', {
      headers: { authorization: 'Bearer ' + ownerToken }
    })).json();
    expect(body).toMatchObject({
      persisted: { states: { queued: 1, read: 1, accepted: 0, uncertain: 0 }, totalIntents: 2 },
      process: { snapshot: { traceCount: 0 } }
    });
    expect(queued.state).toBe('queued');
  });
});
