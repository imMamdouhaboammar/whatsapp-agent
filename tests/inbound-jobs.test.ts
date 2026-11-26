import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/domain/db';
import type { ChatMessage } from '../src/domain/types';

function makeMessage(id: string, chatId = 'chat1@s.whatsapp.net'): ChatMessage {
  return {
    id,
    chatId,
    sender: chatId,
    senderName: 'Customer',
    text: `text of ${id}`,
    timestamp: Date.now(),
    isFromMe: false,
    type: 'text'
  };
}

const dirs: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inbound-jobs-'));
  dirs.push(dir);
  return join(dir, 'test.db');
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('WA-005 durable inbound jobs', () => {
  it('persists the message and its job atomically; replay neither duplicates nor recreates', () => {
    const store = new SqliteStore({ dbPath: tempDbPath() });
    const msg = makeMessage('m1');

    const first = store.saveInboundMessageWithJob(msg, { createJob: true });
    expect(first.created).toBe(true);
    const firstJob = first.job;
    if (!firstJob) throw new Error('Expected first job');
    expect(firstJob.state).toBe('pending');
    expect(store.getMessage(msg.chatId, msg.id)?.text).toBe(msg.text);

    // A replayed delivery of the same message must not create a second job
    // nor reset the existing one.
    store.inboundJobs.claim(firstJob.id, 'worker-a');
    const replay = store.saveInboundMessageWithJob(msg, { createJob: true });
    expect(replay.created).toBe(false);
    const replayJob = replay.job;
    if (!replayJob) throw new Error('Expected replay job');
    expect(replayJob.id).toBe(firstJob.id);
    expect(replayJob.state).toBe('claimed');
    expect(replayJob.attemptCount).toBe(1);
  });

  it('recovers a job left pending by a dead process exactly once', () => {
    const dbPath = tempDbPath();
    const msg = makeMessage('m1');
    const firstProcess = new SqliteStore({ dbPath });
    const created = firstProcess.saveInboundMessageWithJob(msg, { createJob: true }).job;
    if (!created) throw new Error('Expected created job');
    firstProcess.closeForTesting();

    // Restart against the same file: the message exists but its work was never done.
    const secondProcess = new SqliteStore({ dbPath });
    expect(secondProcess.getMessage(msg.chatId, msg.id)).toBeDefined();
    const due = secondProcess.inboundJobs.due(Date.now());
    expect(due.map((j) => j.id)).toEqual([created.id]);

    const claim = secondProcess.inboundJobs.claim(created.id, 'worker-b');
    expect(claim).toBeDefined();
    // A second competing claim gets nothing: exactly one worker owns the job.
    expect(secondProcess.inboundJobs.claim(created.id, 'worker-c')).toBeUndefined();
    secondProcess.inboundJobs.complete(created.id);
    expect(secondProcess.inboundJobs.due(Date.now())).toEqual([]);
    expect(secondProcess.inboundJobs.getJob(created.id)?.state).toBe('completed');
    secondProcess.closeForTesting();
  });

  it('a crash after claim is recovered once the lease expires', () => {
    const store = new SqliteStore({ dbPath: tempDbPath() });
    const job = store.saveInboundMessageWithJob(makeMessage('m1'), { createJob: true }).job;
    if (!job) throw new Error('Expected job');
    const now = Date.now();
    store.inboundJobs.claim(job.id, 'worker-a', now, 1_000);

    // Live lease: not recoverable, not due.
    expect(store.inboundJobs.recoverExpiredLeases(now + 500)).toBe(0);
    expect(store.inboundJobs.due(now + 500)).toEqual([]);

    // Lease expired (owner presumed dead): job returns to pending and is due.
    expect(store.inboundJobs.recoverExpiredLeases(now + 1_001)).toBe(1);
    const due = store.inboundJobs.due(now + 1_001);
    expect(due).toHaveLength(1);
    expect(due[0]?.state).toBe('pending');
    expect(due[0]?.attemptCount).toBe(1);
  });

  it('exhausting the attempt limit fails the job terminally', () => {
    const store = new SqliteStore({ dbPath: tempDbPath() });
    const job = store.saveInboundMessageWithJob(makeMessage('m1'), { createJob: true }).job;
    if (!job) throw new Error('Expected job');
    const now = Date.now();

    store.inboundJobs.claim(job.id, 'worker-a', now);
    store.inboundJobs.failAttempt(job.id, 'boom', now, { maxAttempts: 2, retryDelayMs: 0 });
    let current = store.inboundJobs.getJob(job.id);
    if (!current) throw new Error('Expected current job');
    expect(current.state).toBe('pending');
    expect(current.attemptCount).toBe(1);
    expect(current.lastError).toBe('boom');

    store.inboundJobs.claim(job.id, 'worker-a', now);
    store.inboundJobs.failAttempt(job.id, 'boom again', now, { maxAttempts: 2, retryDelayMs: 0 });
    current = store.inboundJobs.getJob(job.id);
    if (!current) throw new Error('Expected current job');
    expect(current.state).toBe('failed');
    expect(store.inboundJobs.due(now + 60_000)).toEqual([]);
    // Recovery never resurrects a terminal job.
    expect(store.inboundJobs.recoverExpiredLeases(now + 60_000)).toBe(0);
    expect(store.inboundJobs.getJob(job.id)?.state).toBe('failed');
  });

  it('persists ineligible messages without creating work', () => {
    const store = new SqliteStore({ dbPath: tempDbPath() });
    const historical = makeMessage('m1');
    const self: ChatMessage = { ...makeMessage('m2'), isFromMe: true };

    const h = store.saveInboundMessageWithJob(historical, { createJob: false });
    const s = store.saveInboundMessageWithJob(self, { createJob: false });
    expect(h.job).toBeUndefined();
    expect(s.job).toBeUndefined();
    expect(store.getMessage(historical.chatId, historical.id)).toBeDefined();
    expect(store.getMessage(self.chatId, self.id)).toBeDefined();
    expect(store.inboundJobs.due(Date.now())).toEqual([]);
  });
});
