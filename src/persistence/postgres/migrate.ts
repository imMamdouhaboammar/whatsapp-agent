import { SQL } from 'bun';
import { readFileSync } from 'node:fs';
import { readPgInteger, readSqlRows } from './sql-values';

export interface PgTransaction {
  unsafe(statement: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}
export interface PgClient {
  begin<T>(callback: (tx: PgTransaction) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

const VERSION = 2;
const INITIAL_SQL = readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8');
const LEARNING_SQL = readFileSync(new URL('./migrations/002_learning_memory.sql', import.meta.url), 'utf8');

export function getMigrationStatements(sql: string = INITIAL_SQL): string[] {
  // The versioned DDL deliberately has no procedural blocks or embedded semicolons.
  const withoutComments = sql.split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  return withoutComments.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

export function createPgClient(url: string): PgClient {
  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }
  const sql = new SQL(url);
  return {
    begin: callback => sql.begin(tx => callback({
      unsafe: async (statement, params) => readSqlRows(await tx.unsafe(statement, params))
    })),
    close: () => sql.close()
  };
}

export async function migratePostgres(client: PgClient): Promise<{ applied: boolean; version: number }> {
  return client.begin(async tx => {
    await tx.unsafe('SELECT pg_advisory_xact_lock(20261106, 1)');
    const statements = getMigrationStatements();
    // A fresh target needs its own migration ledger before version lookup.
    for (const stmt of statements.slice(0, 3)) await tx.unsafe(stmt);
    const versions = (await tx.unsafe('SELECT version FROM wa_agent.schema_migrations ORDER BY version DESC'))
      .map(row => readPgInteger(row.version, 'version'));
    if (versions.some(version => version > VERSION)) {
      throw new Error('Database schema is newer than this application');
    }
    let applied = false;
    if (!versions.includes(1)) {
      for (const stmt of statements.slice(3)) await tx.unsafe(stmt);
      await tx.unsafe('INSERT INTO wa_agent.schema_migrations(version, applied_at) VALUES ($1, $2)', [1, Date.now()]);
      applied = true;
    }
    // Version 2 adds the learning tables used by PostgresLearningStore.
    if (!versions.includes(2)) {
      for (const stmt of getMigrationStatements(LEARNING_SQL)) await tx.unsafe(stmt);
      await tx.unsafe('INSERT INTO wa_agent.schema_migrations(version, applied_at) VALUES ($1, $2)', [2, Date.now()]);
      applied = true;
    }
    return { applied, version: VERSION };
  });
}
