import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, QuotedMessageInfo } from './types';
import { isRecord, isStringArray, readChoice, sqliteTransaction, readSqliteRow, readSqliteText, readSqliteNumber, readNullableSqliteNumber, readNullableSqliteText } from './sqlite-values';

export type InboundJobState = 'pending' | 'claimed' | 'completed' | 'failed';

export interface InboundJob {
  id: string;
  chatId: string;
  messageId: string;
  payload: ChatMessage;
  state: InboundJobState;
  attemptCount: number;
  nextAttemptAt: number;
  leaseExpiresAt?: number;
  leaseOwner?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface InboundJobEvent {
  id: string;
  jobId: string;
  fromState?: InboundJobState;
  toState: InboundJobState;
  reason: string;
  createdAt: number;
}

interface InboundJobRow {
  id: string;
  chat_id: string;
  message_id: string;
  payload_json: string;
  state: string;
  attempt_count: number;
  next_attempt_at: number;
  lease_expires_at: number | null;
  lease_owner: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function readInboundJobRow(value: unknown): InboundJobRow {
  const row = readSqliteRow(value);
  return {
    id: readSqliteText(row, 'id'),
    chat_id: readSqliteText(row, 'chat_id'),
    message_id: readSqliteText(row, 'message_id'),
    payload_json: readSqliteText(row, 'payload_json'),
    state: readSqliteText(row, 'state'),
    attempt_count: readSqliteNumber(row, 'attempt_count'),
    next_attempt_at: readSqliteNumber(row, 'next_attempt_at'),
    lease_expires_at: readNullableSqliteNumber(row, 'lease_expires_at'),
    lease_owner: readNullableSqliteText(row, 'lease_owner'),
    last_error: readNullableSqliteText(row, 'last_error'),
    created_at: readSqliteNumber(row, 'created_at'),
    updated_at: readSqliteNumber(row, 'updated_at'),
  };
}

interface InboundEventRow {
  id: string;
  job_id: string;
  from_state: string | null;
  to_state: string;
  reason: string;
  created_at: number;
}

function readInboundEventRow(value: unknown): InboundEventRow {
  const row = readSqliteRow(value);
  return {
    id: readSqliteText(row, 'id'),
    job_id: readSqliteText(row, 'job_id'),
    from_state: readNullableSqliteText(row, 'from_state'),
    to_state: readSqliteText(row, 'to_state'),
    reason: readSqliteText(row, 'reason'),
    created_at: readSqliteNumber(row, 'created_at'),
  };
}

function decodeState(value: unknown): InboundJobState {
  return readChoice(value, ['pending', 'claimed', 'completed', 'failed'], 'inbound job state');
}

function isQuotedMessage(value: unknown): value is QuotedMessageInfo {
  return isRecord(value) && typeof value.id === 'string' && typeof value.sender === 'string'
    && typeof value.text === 'string' && (value.senderName === undefined || typeof value.senderName === 'string')
    && (value.type === undefined || typeof value.type === 'string');
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function decodeMedia(value: unknown): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Invalid inbound job payload media');
  if (value.type === 'Buffer' && Array.isArray(value.data) && value.data.every(isByte)) {
    return Buffer.from(value.data);
  }
  // JSON.stringify represents Uint8Array as an object with contiguous numeric keys.
  const entries = Object.entries(value);
  return Uint8Array.from(entries.map(([key, byte], index) => {
    if (key !== String(index) || !isByte(byte)) throw new Error('Invalid inbound job payload media');
    return byte;
  }));
}

function decodePayload(raw: string, row: InboundJobRow): ChatMessage {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.id !== row.message_id || value.chatId !== row.chat_id
      || typeof value.sender !== 'string' || typeof value.text !== 'string'
      || typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)
      || typeof value.isFromMe !== 'boolean') throw new Error('Invalid inbound job payload');

  const optionalText = (key: string): string | undefined => {
    const field = value[key];
    if (field === undefined || typeof field === 'string') return field;
    throw new Error(`Invalid inbound job payload ${key}`);
  };
  const { quotedMessage, reactions, lastAttemptAt } = value;
  if ((quotedMessage !== undefined && !isQuotedMessage(quotedMessage))
      || (reactions !== undefined && !isStringArray(reactions))
      || (lastAttemptAt !== undefined && (typeof lastAttemptAt !== 'number' || !Number.isFinite(lastAttemptAt)))) {
    throw new Error('Invalid inbound job payload fields');
  }
  return {
    id: row.message_id,
    chatId: row.chat_id,
    sender: value.sender,
    senderName: optionalText('senderName'),
    text: value.text,
    timestamp: value.timestamp,
    isFromMe: value.isFromMe,
    type: readChoice(value.type, ['text', 'audio', 'image', 'video', 'document', 'other'], 'inbound job payload type'),
    mediaUrl: optionalText('mediaUrl'),
    mediaBuffer: decodeMedia(value.mediaBuffer),
    transcription: optionalText('transcription'),
    replyToId: optionalText('replyToId'),
    quotedMessage,
    reactions,
    status: value.status === undefined ? undefined : readChoice(value.status, ['pending', 'sent', 'delivered', 'read'], 'inbound job payload status'),
    sendIntentId: optionalText('sendIntentId'),
    deliveryState: value.deliveryState === undefined ? undefined
      : readChoice(value.deliveryState, ['queued', 'attempting', 'uncertain', 'failed'], 'inbound job payload delivery state'),
    lastAttemptAt,
    nativeMessageId: optionalText('nativeMessageId'),
  };
}

export interface FailAttemptOptions {
  maxAttempts: number;
  retryDelayMs: number;
}

/**
 * Durable record of inbound response work, one row per accepted inbound
 * message. The job row is written in the same SQLite transaction as the
 * message itself, so a process that dies after acknowledging a message can
 * never leave it visible-but-unworked: on restart the job is still pending
 * (or its expired claim is recovered) and the work is driven exactly once.
 */
export class InboundJobLedger {
  constructor(private db: Database) {
    this.init();
  }

  private init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS inbound_jobs (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        lease_expires_at INTEGER,
        lease_owner TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_inbound_jobs_due ON inbound_jobs(state, next_attempt_at)');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS inbound_job_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_inbound_job_events_job ON inbound_job_events(job_id, created_at)');
  }

  private atomic<T>(work: () => T): T {
    return sqliteTransaction(this.db, 'immediate', work);
  }

  private event(jobId: string, from: InboundJobState | undefined, to: InboundJobState, reason: string, at: number) {
    this.db.prepare(`
      INSERT INTO inbound_job_events (id, job_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), jobId, from ?? null, to, reason, at);
  }

  private rowToJob(value: unknown): InboundJob {
    const row = readInboundJobRow(value);
    return {
      id: row.id,
      chatId: row.chat_id,
      messageId: row.message_id,
      payload: decodePayload(row.payload_json, row),
      state: decodeState(row.state),
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      leaseOwner: row.lease_owner ?? undefined,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /** Stable job identity for an inbound event: one job per message, ever. */
  static jobIdFor(chatId: string, messageId: string): string {
    return `${chatId}:${messageId}`;
  }

  getJob(id: string): InboundJob | undefined {
    const row = this.db.prepare<unknown, [string]>('SELECT * FROM inbound_jobs WHERE id=?').get(id);
    return row ? this.rowToJob(row) : undefined;
  }

  /**
   * Idempotent create: an already-known message returns its existing job,
   * whatever state that job is in, so replays never reset or duplicate work.
   */
  createJob(message: ChatMessage, now = Date.now()): { job: InboundJob; created: boolean } {
    return this.atomic(() => {
      const id = InboundJobLedger.jobIdFor(message.chatId, message.id);
      const existing = this.getJob(id);
      if (existing) return { job: existing, created: false };
      this.db.prepare(`
        INSERT INTO inbound_jobs (
          id, chat_id, message_id, payload_json, state, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
      `).run(id, message.chatId, message.id, JSON.stringify(message), now, now);
      this.event(id, undefined, 'pending', 'job_created', now);
      const createdJob = this.getJob(id);
      if (!createdJob) throw new Error(`Failed to load created inbound job ${id}`);
      return { job: createdJob, created: true };
    });
  }

  /** Caller must already be inside a transaction (used by the atomic message+job path). */
  createJobInTransaction(message: ChatMessage, now = Date.now()): { job: InboundJob; created: boolean } {
    const id = InboundJobLedger.jobIdFor(message.chatId, message.id);
    const existing = this.getJob(id);
    if (existing) return { job: existing, created: false };
    this.db.prepare(`
      INSERT INTO inbound_jobs (
        id, chat_id, message_id, payload_json, state, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
    `).run(id, message.chatId, message.id, JSON.stringify(message), now, now);
    this.event(id, undefined, 'pending', 'job_created', now);
    const createdJob = this.getJob(id);
    if (!createdJob) throw new Error(`Failed to load created inbound job ${id}`);
    return { job: createdJob, created: true };
  }

  claim(id: string, owner: string, now = Date.now(), leaseMs = 30_000): InboundJob | undefined {
    return this.atomic(() => {
      const job = this.getJob(id);
      if (!job || job.state !== 'pending' || job.nextAttemptAt > now) return undefined;
      const changed = this.db.prepare(`
        UPDATE inbound_jobs SET state='claimed', attempt_count=attempt_count+1,
        lease_expires_at=?, lease_owner=?, updated_at=? WHERE id=? AND state='pending'
      `).run(now + leaseMs, owner, now, id);
      if (changed.changes !== 1) return undefined;
      this.event(id, 'pending', 'claimed', 'claimed', now);
      return this.getJob(id);
    });
  }

  complete(id: string, now = Date.now()): InboundJob | undefined {
    return this.atomic(() => {
      const job = this.getJob(id);
      if (!job || (job.state !== 'claimed' && job.state !== 'pending')) return undefined;
      const changed = this.db.prepare(`
        UPDATE inbound_jobs SET state='completed', lease_expires_at=NULL, lease_owner=NULL, updated_at=?
        WHERE id=? AND state IN ('claimed','pending')
      `).run(now, id);
      if (changed.changes !== 1) return undefined;
      this.event(id, job.state, 'completed', 'work_done', now);
      return this.getJob(id);
    });
  }

  failAttempt(id: string, error: string, now = Date.now(), options: FailAttemptOptions = { maxAttempts: 3, retryDelayMs: 5_000 }): InboundJob | undefined {
    return this.atomic(() => {
      const job = this.getJob(id);
      if (!job || job.state !== 'claimed') return undefined;
      const willRetry = job.attemptCount < options.maxAttempts;
      const nextState: InboundJobState = willRetry ? 'pending' : 'failed';
      const changed = this.db.prepare(`
        UPDATE inbound_jobs SET state=?, next_attempt_at=?, lease_expires_at=NULL, lease_owner=NULL,
        last_error=?, updated_at=? WHERE id=? AND state='claimed'
      `).run(nextState, willRetry ? now + options.retryDelayMs : 0, error, now, id);
      if (changed.changes !== 1) return undefined;
      this.event(id, 'claimed', nextState, willRetry ? 'attempt_failed' : 'attempts_exhausted', now);
      return this.getJob(id);
    });
  }

  /** Returns expired claims to pending; the owner process is presumed dead. */
  recoverExpiredLeases(now = Date.now(), limit = 1_000): number {
    return this.atomic(() => {
      const rows = this.db.prepare<unknown, [number, number]>(`
        SELECT id FROM inbound_jobs WHERE state='claimed' AND lease_expires_at <= ? LIMIT ?
      `).all(now, limit);
      for (const value of rows) {
        const id = readSqliteText(readSqliteRow(value), 'id');
        const changed = this.db.prepare(`
          UPDATE inbound_jobs SET state='pending', lease_expires_at=NULL, lease_owner=NULL, updated_at=?
          WHERE id=? AND state='claimed'
        `).run(now, id);
        if (changed.changes === 1) this.event(id, 'claimed', 'pending', 'lease_expired', now);
      }
      return rows.length;
    });
  }

  due(now = Date.now(), limit = 100): InboundJob[] {
    const rows = this.db.prepare<unknown, [number, number]>(`
      SELECT * FROM inbound_jobs WHERE state='pending' AND next_attempt_at <= ?
      ORDER BY created_at ASC LIMIT ?
    `).all(now, limit);
    return rows.map((r) => this.rowToJob(r));
  }

  getEvents(id: string): InboundJobEvent[] {
    const rows = this.db.prepare<unknown, [string]>('SELECT * FROM (SELECT *, rowid AS event_order FROM inbound_job_events WHERE job_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100) ORDER BY created_at ASC, event_order ASC').all(id);
    return rows.map(value => {
      const row = readInboundEventRow(value);
      return {
        id: row.id, jobId: row.job_id, fromState: row.from_state === null ? undefined : decodeState(row.from_state),
        toState: decodeState(row.to_state), reason: row.reason, createdAt: row.created_at
      };
    });
  }
}
