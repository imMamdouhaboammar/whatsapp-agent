import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { getMigrationStatements, migratePostgres, type PgClient } from '../src/persistence/postgres/migrate';
import { readSqlRow, readSqlRows } from '../src/persistence/postgres/sql-values';
import { PostgresActionJournal } from '../src/persistence/postgres/action-journal';
import { PostgresLearningStore } from '../src/persistence/postgres/learning-store';
import { resolveRuntimeDatastore } from '../src/persistence/postgres/runtime-selection';

// Real PostgreSQL engine (WASM) behind the same interfaces the app uses. Not Supabase, not Bun.SQL:
// it proves the SQL itself, not the network driver, pooling, roles or RLS.
function pgClient(db: PGlite): PgClient {
  return {
    begin: (cb) => db.transaction((tx) => cb({ unsafe: async (s, p) => readSqlRows((await tx.query(s, p)).rows) }))
  };
}
function bunSqlShim(db: PGlite) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
    return db.query(text, values).then((r) => r.rows);
  };
}

async function hasTable(db: PGlite, name: string): Promise<boolean> {
  const result = await db.query('SELECT to_regclass($1) AS t', [`wa_agent.${name}`]);
  const { t } = readSqlRow(result.rows[0]);
  if (t !== null && typeof t !== 'string') throw new Error('Unexpected to_regclass result');
  return t !== null;
}

describe('PostgreSQL schema on a real Postgres engine (PGlite)', () => {
  const table = hasTable;

  test('migrations apply 001 and 002, are idempotent, and refuse a newer schema', async () => {
    const db = new PGlite();
    const first = await migratePostgres(pgClient(db));
    expect(first).toEqual({ applied: true, version: 2 });
    expect(await table(db, 'schema_migrations')).toBe(true);
    expect(await table(db, 'knowledge_chunks')).toBe(true);
    expect(await table(db, 'learning_states')).toBe(true);
    expect((await migratePostgres(pgClient(db))).applied).toBe(false);
    await db.query('INSERT INTO wa_agent.schema_migrations(version, applied_at) VALUES (99, 1)');
    const error: unknown = await migratePostgres(pgClient(db)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', expect.stringContaining('newer'));
  });

  test('a database already at version 1 upgrades to add the learning tables', async () => {
    const db = new PGlite();
    for (const stmt of getMigrationStatements()) await db.exec(stmt);
    await db.query('INSERT INTO wa_agent.schema_migrations(version, applied_at) VALUES (1, 1)');
    expect(await table(db, 'learning_states')).toBe(false);
    expect((await migratePostgres(pgClient(db))).applied).toBe(true);
    expect(await table(db, 'learning_states')).toBe(true);
  });

  test('learning store round-trips on the migrated schema, including Arabic text', async () => {
    const db = new PGlite();
    await migratePostgres(pgClient(db));
    const store = new PostgresLearningStore({ sql: bunSqlShim(db) });
    await store.saveLearningState('b1', 'workbook', 'v1 مرحبا بالعميل');
    expect((await store.getLearningState('b1', 'workbook'))?.content).toBe('v1 مرحبا بالعميل');
    await store.saveLearningState('b1', 'workbook', 'v2');
    const s = await store.getLearningState('b1', 'workbook');
    expect(s?.content).toBe('v2');
    expect(s?.version).toBe(2);
    expect(await store.getLearningState('b1', 'notebook')).toBeUndefined();
    await store.saveReflectionRun({ brandId: 'b1', chatId: 'c1', triggerReason: 'test', inputMessageCount: 3 });
    expect((await store.getReflectionRuns('c1')).length).toBe(1);
  });

  test('a reflected thread stops being cold', async () => {
    const db = new PGlite();
    await migratePostgres(pgClient(db));
    const store = new PostgresLearningStore({ sql: bunSqlShim(db) });
    await store.updateThreadActivity('b1', 'c1', 1000);
    expect(await store.getColdThreads('b1', 1, 5)).toContain('c1');
    await store.markThreadReflected('b1', 'c1', Date.now());
    expect(await store.getColdThreads('b1', 1, 5)).not.toContain('c1');
  });

  test('feedback never crosses brands, even with the same chat id', async () => {
    const db = new PGlite();
    await migratePostgres(pgClient(db));
    const store = new PostgresLearningStore({ sql: bunSqlShim(db) });
    await store.updateThreadActivity('brandA', 'shared-chat', 1000);
    await store.updateThreadActivity('brandB', 'shared-chat', 1000);
    await store.markThreadReflected('brandA', 'shared-chat', Date.now());
    await store.recordModerationFeedback({ chatId: 'shared-chat', feedbackType: 'rejected', brandId: 'brandB' });
    // brandA has nothing to do: brandB's feedback must not make its thread cold.
    expect(await store.getColdThreads('brandA', 1, 5)).toEqual([]);
    expect(await store.getUnreflectedFeedback('shared-chat', 'brandA')).toEqual([]);
    await store.markFeedbackReflected('shared-chat', 'brandA');
    expect(await store.getUnreflectedFeedback('shared-chat', 'brandB')).toHaveLength(1);
    await store.markFeedbackReflected('shared-chat', 'brandB');
    expect(await store.getUnreflectedFeedback('shared-chat', 'brandB')).toHaveLength(0);
  });

  test('rejects a learning timestamp outside the safe integer range', async () => {
    const db = new PGlite();
    try {
      await migratePostgres(pgClient(db));
      await db.query(`INSERT INTO wa_agent.learning_states (id, brand_id, state_type, content, updated_at)
        VALUES ('b1:workbook', 'b1', 'workbook', 'test', 9007199254740993)`);
      const store = new PostgresLearningStore({ sql: bunSqlShim(db) });
      const error: unknown = await store.getLearningState('b1', 'workbook').catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('message', 'Invalid PostgreSQL updated_at');
    } finally {
      await db.close();
    }
  });

  test('rejects unsupported feedback values read from PostgreSQL', async () => {
    const db = new PGlite();
    try {
      await migratePostgres(pgClient(db));
      await db.query(`INSERT INTO wa_agent.learning_feedback_events (id, brand_id, chat_id, feedback_type, created_at)
        VALUES ('fb1', 'b1', 'c1', 'unsupported', 1)`);
      const store = new PostgresLearningStore({ sql: bunSqlShim(db) });
      const error: unknown = await store.getUnreflectedFeedback('c1', 'b1').catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('message', 'Invalid PostgreSQL feedback_type');
    } finally {
      await db.close();
    }
  });

  test('rejects malformed JSON receipts read from PostgreSQL', async () => {
    const db = new PGlite();
    try {
      const client = pgClient(db);
      await migratePostgres(client);
      const journal = new PostgresActionJournal(client);
      const workflowId = await journal.createWorkflow({ brandId: 'b1', contactId: 'c1', goal: 'test' });
      await db.query(`INSERT INTO wa_agent.agent_tool_runs
        (brand_id, "key", workflow_id, tool_name, input_hash, status, output_json, created_at, updated_at)
        VALUES ('b1', 'k1', $1, 'test', 'hash', 'confirmed', '{', 1, 1)`, [workflowId]);
      const error: unknown = await journal.getRun('b1', 'k1').catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('message', 'Invalid PostgreSQL output_json');

      const validReceipt = '{ "delivered": true }';
      await db.query('UPDATE wa_agent.agent_tool_runs SET output_json = $1 WHERE brand_id = $2', [validReceipt, 'b1']);
      expect((await journal.getRun('b1', 'k1'))?.output_json).toBe(validReceipt);
    } finally {
      await db.close();
    }
  });

  test('runtime cutover stays closed', () => {
    expect(() => resolveRuntimeDatastore({ DATASTORE: 'postgres', DATABASE_URL: 'postgres://x' })).toThrow('not yet available');
  });
});
