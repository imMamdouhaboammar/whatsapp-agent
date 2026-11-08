import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';

export type SendIntentState = 'queued' | 'attempting' | 'accepted' | 'delivered' | 'read' | 'uncertain' | 'failed';

/** Persisted SQLite state counts; values are authoritative across process restarts. */
export interface PersistedSendSummary {
  source: 'sqlite_send_ledger';
  totalIntents: number;
  states: Record<SendIntentState, number>;
  oldestUncertainAgeMs: number;
}
export type SendActionKind = 'text' | 'voice';

export interface SendIntentInput {
  sourceKind: 'ui' | 'mcp' | 'autopilot' | 'draft';
  sourceId: string;
  sourceRevision: number;
  parentIntentId?: string;
  actionKind: SendActionKind;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  simulatedDelayMs?: number;
  policyRevision: number;
  expiresAt?: number;
}

export interface SendIntent extends SendIntentInput {
  id: string;
  payloadHash: string;
  state: SendIntentState;
  nativeMessageId?: string;
  attemptCount: number;
  nextAttemptAt: number;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SendAttempt {
  id: string;
  intentId: string;
  leaseOwner: string;
  startedAt: number;
  networkStartedAt?: number;
  finishedAt?: number;
  outcome: 'attempting' | 'accepted' | 'pre_send_failed' | 'uncertain';
  failureCode?: string;
  traceId: string;
}

export interface SendEvent {
  id: string;
  intentId: string;
  fromState?: SendIntentState;
  toState: SendIntentState;
  reason: string;
  createdAt: number;
}

const RECEIPT_RANK: Partial<Record<SendIntentState, number>> = {
  accepted: 0,
  delivered: 1,
  read: 2
};

export class SendIntentConflictError extends Error {
  constructor() {
    super('Send intent conflict: the same source revision has a different payload');
    this.name = 'SendIntentConflictError';
  }
}

const payloadHash = (input: SendIntentInput): string => createHash('sha256')
  .update(JSON.stringify([
    input.chatId, input.actionKind, input.text, input.replyToMessageId ?? null,
    input.policyRevision, input.parentIntentId ?? null
  ]))
  .digest('hex');

export class SendLedger {
  constructor(private readonly db: Database) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS send_intents (
        id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_revision INTEGER NOT NULL,
        parent_intent_id TEXT,
        action_kind TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        policy_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        native_message_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        lease_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        UNIQUE(source_kind, source_id, source_revision, action_kind)
      )
    `);
    const columns = this.db.prepare('PRAGMA table_info(send_intents)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'parent_intent_id')) {
      this.db.run('ALTER TABLE send_intents ADD COLUMN parent_intent_id TEXT');
    }
    this.db.run('CREATE INDEX IF NOT EXISTS idx_send_intents_due ON send_intents(state, next_attempt_at)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_send_intents_native ON send_intents(chat_id, native_message_id)');
    this.db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_send_intents_retry_parent ON send_intents(parent_intent_id) WHERE parent_intent_id IS NOT NULL');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS send_attempts (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL REFERENCES send_intents(id),
        lease_owner TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        network_started_at INTEGER,
        finished_at INTEGER,
        outcome TEXT NOT NULL,
        failure_code TEXT,
        trace_id TEXT NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_send_attempts_intent ON send_attempts(intent_id, started_at)');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS send_intent_events (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL REFERENCES send_intents(id),
        from_state TEXT,
        to_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_send_events_intent ON send_intent_events(intent_id, created_at)');
  }

  private atomic<T>(work: () => T): T {
    // Bun's declared transaction.immediate return is void, but runtime returns the callback result.
    return this.db.transaction(work).immediate() as unknown as T;
  }

  private event(id: string, from: SendIntentState | undefined, to: SendIntentState, reason: string, at: number) {
    this.db.prepare(`
      INSERT INTO send_intent_events (id, intent_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), id, from ?? null, to, reason, at);
  }

  private rowToIntent(row: any): SendIntent {
    const data = JSON.parse(row.payload_json) as { text: string; replyToMessageId?: string; simulatedDelayMs?: number };
    return {
      id: row.id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceRevision: row.source_revision,
      parentIntentId: row.parent_intent_id ?? undefined,
      actionKind: row.action_kind,
      chatId: row.chat_id,
      text: data.text,
      replyToMessageId: data.replyToMessageId,
      simulatedDelayMs: data.simulatedDelayMs,
      policyRevision: row.policy_revision,
      expiresAt: row.expires_at ?? undefined,
      payloadHash: row.payload_hash,
      state: row.state,
      nativeMessageId: row.native_message_id ?? undefined,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  getIntent(id: string): SendIntent | undefined {
    const row = this.db.prepare('SELECT * FROM send_intents WHERE id = ? LIMIT 1').get(id);
    return row ? this.rowToIntent(row) : undefined;
  }

  getBySource(input: Pick<SendIntentInput, 'sourceKind' | 'sourceId' | 'sourceRevision' | 'actionKind'>): SendIntent | undefined {
    const row = this.db.prepare(`
      SELECT * FROM send_intents WHERE source_kind=? AND source_id=? AND source_revision=? AND action_kind=? LIMIT 1
    `).get(input.sourceKind, input.sourceId, input.sourceRevision, input.actionKind);
    return row ? this.rowToIntent(row) : undefined;
  }

  private insertIntent(input: SendIntentInput, now: number): SendIntent {
    const existing = this.getBySource(input);
    if (existing) {
      if (existing.payloadHash !== payloadHash(input)) throw new SendIntentConflictError();
      return existing;
    }
    const validJid = /^[0-9A-Za-z._:\-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(input.chatId);
    if (!input.sourceId.trim() || !input.text.trim() || !validJid) {
      throw new Error('Invalid send intent identity, recipient, or text');
    }
    if (!Number.isSafeInteger(input.sourceRevision) || !Number.isSafeInteger(input.policyRevision)) {
      throw new Error('Invalid send intent revision');
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO send_intents (
        id, source_kind, source_id, source_revision, parent_intent_id, action_kind, chat_id,
        payload_hash, payload_json, policy_revision, state, next_attempt_at,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
    `).run(
      id, input.sourceKind, input.sourceId, input.sourceRevision, input.parentIntentId ?? null, input.actionKind,
      input.chatId, payloadHash(input),
      JSON.stringify({ text: input.text, replyToMessageId: input.replyToMessageId, simulatedDelayMs: input.simulatedDelayMs }),
      input.policyRevision, now, now, input.expiresAt ?? null
    );
    this.event(id, undefined, 'queued', 'intent_created', now);
    return this.getIntent(id)!;
  }

  createIntent(input: SendIntentInput, now = Date.now()): SendIntent {
    return this.atomic(() => this.insertIntent(input, now));
  }

  createRetryIntent(input: SendIntentInput, now = Date.now()): SendIntent {
    const parentIntentId = input.parentIntentId;
    if (!parentIntentId) throw new Error('Retry must reference its original send intent');
    return this.atomic(() => {
      const parent = this.getIntent(parentIntentId);
      if (!parent || parent.state !== 'uncertain') throw new Error('Retry parent is not uncertain');
      const existing = this.db.prepare('SELECT * FROM send_intents WHERE parent_intent_id=? LIMIT 1')
        .get(parentIntentId);
      if (existing) return this.rowToIntent(existing);
      return this.insertIntent(input, now);
    });
  }

  failQueued(id: string, reason: string, now = Date.now()): SendIntent | undefined {
    return this.atomic(() => {
      const intent = this.getIntent(id);
      if (!intent || intent.state !== 'queued') return undefined;
      const changed = this.db.prepare(`UPDATE send_intents SET state='failed', updated_at=? WHERE id=? AND state='queued'`).run(now, id);
      if (changed.changes !== 1) return undefined;
      this.event(id, 'queued', 'failed', reason, now);
      return this.getIntent(id);
    });
  }

  claim(id: string, owner: string, now = Date.now(), leaseMs = 30_000): { intent: SendIntent; attempt: SendAttempt } | undefined {
    return this.atomic(() => {
      const intent = this.getIntent(id);
      if (!intent || intent.state !== 'queued' || intent.nextAttemptAt > now) return undefined;
      if (intent.expiresAt && intent.expiresAt <= now) {
        this.db.prepare(`UPDATE send_intents SET state='failed', updated_at=? WHERE id=?`).run(now, id);
        this.event(id, 'queued', 'failed', 'expired', now);
        return undefined;
      }
      const changed = this.db.prepare(`
        UPDATE send_intents SET state='attempting', attempt_count=attempt_count+1,
        lease_expires_at=?, updated_at=? WHERE id=? AND state='queued'
      `).run(now + leaseMs, now, id);
      if (changed.changes !== 1) return undefined;
      const attempt: SendAttempt = {
        id: randomUUID(), intentId: id, leaseOwner: owner, startedAt: now,
        outcome: 'attempting', traceId: id
      };
      this.db.prepare(`
        INSERT INTO send_attempts (id, intent_id, lease_owner, started_at, outcome, trace_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(attempt.id, id, owner, now, attempt.outcome, id);
      this.event(id, 'queued', 'attempting', 'claimed', now);
      return { intent: this.getIntent(id)!, attempt };
    });
  }

  markNetworkStarted(attemptId: string, now = Date.now()): void {
    this.db.prepare(`
      UPDATE send_attempts SET network_started_at=? WHERE id=? AND outcome='attempting'
    `).run(now, attemptId);
  }

  private transitionAttempt(
    id: string, attemptId: string, state: SendIntentState,
    outcome: SendAttempt['outcome'], reason: string, now: number,
    nativeMessageId?: string, retryAt = 0
  ): SendIntent | undefined {
    return this.atomic(() => {
      const intent = this.getIntent(id);
      if (!intent || intent.state !== 'attempting') return undefined;
      const updated = this.db.prepare(`
        UPDATE send_attempts SET outcome=?, finished_at=?, failure_code=?,
          network_started_at=CASE WHEN ?='pre_send_failed' THEN NULL ELSE network_started_at END
        WHERE id=? AND intent_id=? AND outcome='attempting'
      `).run(outcome, now, reason, outcome, attemptId, id);
      if (updated.changes !== 1) return undefined;
      this.db.prepare(`
        UPDATE send_intents SET state=?, native_message_id=COALESCE(?, native_message_id),
        next_attempt_at=?, lease_expires_at=NULL, updated_at=? WHERE id=?
      `).run(state, nativeMessageId ?? null, retryAt, now, id);
      this.event(id, 'attempting', state, reason, now);
      return this.getIntent(id);
    });
  }

  accepted(id: string, attemptId: string, nativeMessageId: string, now = Date.now()): SendIntent | undefined {
    if (!nativeMessageId.trim()) throw new Error('Native message ID required');
    return this.transitionAttempt(id, attemptId, 'accepted', 'accepted', 'transport_accepted', now, nativeMessageId);
  }

  uncertain(id: string, attemptId: string, reason = 'ambiguous_failure', now = Date.now()): SendIntent | undefined {
    return this.transitionAttempt(id, attemptId, 'uncertain', 'uncertain', reason, now);
  }

  preSendFailure(id: string, attemptId: string, retryAt: number, maxAttempts: number, now = Date.now()): SendIntent | undefined {
    const intent = this.getIntent(id);
    if (!intent || intent.state !== 'attempting') return undefined;
    const willRetry = intent.attemptCount < maxAttempts;
    return this.transitionAttempt(
      id, attemptId, willRetry ? 'queued' : 'failed', 'pre_send_failed',
      willRetry ? 'pre_network_retry' : 'pre_network_attempts_exhausted',
      now, undefined, willRetry ? retryAt : 0
    );
  }

  recoverInterrupted(now = Date.now()): number {
    return this.atomic(() => {
      const rows = this.db.prepare(`
        SELECT id FROM send_intents WHERE state='attempting' AND lease_expires_at <= ? LIMIT 1000
      `).all(now) as Array<{ id: string }>;
      for (const { id } of rows) {
        this.db.prepare(`
          UPDATE send_attempts SET outcome='uncertain', finished_at=?, failure_code='process_interrupted'
          WHERE intent_id=? AND outcome='attempting'
        `).run(now, id);
        this.db.prepare(`
          UPDATE send_intents SET state='uncertain', lease_expires_at=NULL, updated_at=?
          WHERE id=?
        `).run(now, id);
        this.event(id, 'attempting', 'uncertain', 'process_interrupted', now);
      }
      return rows.length;
    });
  }

  due(now = Date.now(), limit = 20): SendIntent[] {
    const rows = this.db.prepare(`
      SELECT * FROM send_intents WHERE state='queued' AND next_attempt_at <= ?
      ORDER BY created_at ASC LIMIT ?
    `).all(now, limit) as any[];
    return rows.map((r) => this.rowToIntent(r));
  }

  advanceReceipt(chatId: string, nativeMessageId: string, status: 'sent' | 'delivered' | 'read', now = Date.now()): SendIntent | undefined {
    return this.atomic(() => {
      const row = this.db.prepare(`
        SELECT * FROM send_intents WHERE chat_id=? AND native_message_id=?
        ORDER BY created_at DESC LIMIT 1
      `).get(chatId, nativeMessageId);
      if (!row) return undefined;
      const intent = this.rowToIntent(row);
      const next = status === 'sent' ? 'accepted' : status;
      const beforeRank = RECEIPT_RANK[intent.state];
      const nextRank = RECEIPT_RANK[next];
      if (beforeRank === undefined || nextRank === undefined || nextRank <= beforeRank) return undefined;
      this.db.prepare('UPDATE send_intents SET state=?, updated_at=? WHERE id=?').run(next, now, intent.id);
      this.event(intent.id, intent.state, next, 'whatsapp_receipt', now);
      return this.getIntent(intent.id);
    });
  }

  approveDraft(draftId: string, text: string, policyRevision: number, now = Date.now(), actionKind: SendActionKind = 'text'): { created: boolean; intent?: SendIntent } {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT * FROM drafts WHERE id=?').get(draftId) as any;
      if (!row) return { created: false };
      const identity: SendIntentInput = {
        sourceKind: 'draft', sourceId: draftId, sourceRevision: 1,
        actionKind, chatId: row.chat_id,
        text, replyToMessageId: row.incoming_message_id, policyRevision
      };
      if (row.status !== 'pending') {
        return { created: false, intent: this.getBySource(identity) };
      }
      const updated = this.db.prepare(`
        UPDATE drafts SET status='approved', proposed_reply=? WHERE id=? AND status='pending'
      `).run(text, draftId);
      if (updated.changes !== 1) return { created: false, intent: this.getBySource(identity) };
      const intent = this.insertIntent(identity, now);
      return { created: true, intent };
    });
  }

  getOutstanding(chatId: string): SendIntent[] {
    const rows = this.db.prepare(`
      SELECT parent.* FROM send_intents AS parent
      WHERE parent.chat_id=? AND parent.state IN ('queued', 'attempting', 'uncertain', 'failed')
        AND NOT EXISTS (
          SELECT 1 FROM send_intents AS retry WHERE retry.parent_intent_id=parent.id
        )
      ORDER BY parent.created_at DESC LIMIT 100
    `).all(chatId) as any[];
    return rows.map((row) => this.rowToIntent(row));
  }

  /** Read-only aggregate with no message, recipient, source or native IDs. */
  getDiagnosticsSummary(now = Date.now()): PersistedSendSummary {
    const states: PersistedSendSummary['states'] = {
      queued: 0, attempting: 0, accepted: 0, delivered: 0,
      read: 0, uncertain: 0, failed: 0
    };
    const rows = this.db.prepare('SELECT state, COUNT(*) AS count FROM send_intents GROUP BY state')
      .all() as Array<{ state: SendIntentState; count: number }>;
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(states, row.state)) {
        states[row.state] = row.count;
      }
    }
    const oldest = this.db.prepare("SELECT MIN(updated_at) AS at FROM send_intents WHERE state='uncertain'")
      .get() as { at: number | null };
    return {
      source: 'sqlite_send_ledger',
      totalIntents: Object.values(states).reduce((total, count) => total + count, 0),
      states,
      oldestUncertainAgeMs: oldest.at === null ? 0 : Math.max(0, now - oldest.at)
    };
  }

  getAttempts(id: string): SendAttempt[] {
    const rows = this.db.prepare('SELECT * FROM (SELECT * FROM send_attempts WHERE intent_id=? ORDER BY started_at DESC, id DESC LIMIT 100) ORDER BY started_at ASC, id ASC').all(id) as any[];
    return rows.map((r) => ({
      id: r.id, intentId: r.intent_id, leaseOwner: r.lease_owner, startedAt: r.started_at,
      networkStartedAt: r.network_started_at ?? undefined, finishedAt: r.finished_at ?? undefined,
      outcome: r.outcome, failureCode: r.failure_code ?? undefined, traceId: r.trace_id
    }));
  }

  getEvents(id: string): SendEvent[] {
    const rows = this.db.prepare('SELECT * FROM (SELECT *, rowid AS event_order FROM send_intent_events WHERE intent_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100) ORDER BY created_at ASC, event_order ASC').all(id) as any[];
    return rows.map((r) => ({
      id: r.id, intentId: r.intent_id, fromState: r.from_state ?? undefined,
      toState: r.to_state, reason: r.reason, createdAt: r.created_at
    }));
  }

  closeForTesting(): void {
    this.db.close();
  }
}
