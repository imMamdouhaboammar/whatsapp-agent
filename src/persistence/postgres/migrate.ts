import { SQL } from 'bun';
import { readFileSync } from 'node:fs';

export interface PgTransaction {
  unsafe(statement: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}
export interface PgClient {
  begin<T>(callback: (tx: PgTransaction) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

const VERSION = 1;
const INITIAL_SQL = readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8');

export function getMigrationStatements(): string[] {
  // The versioned DDL deliberately has no procedural blocks or embedded semicolons.
  const withoutComments = INITIAL_SQL.split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  return withoutComments.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

export function createPgClient(url: string): PgClient {
  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }
  return new SQL(url) as unknown as PgClient;
}

export async function migratePostgres(client: PgClient): Promise<{ applied: boolean; version: number }> {
  return client.begin(async tx => {
    await tx.unsafe('SELECT pg_advisory_xact_lock(20261106, 1)');
    const statements = getMigrationStatements();
    // A fresh target needs its own migration ledger before version lookup.
    for (const stmt of statements.slice(0, 3)) await tx.unsafe(stmt);
    const versions = await tx.unsafe('SELECT version FROM wa_agent.schema_migrations ORDER BY version DESC');
    if (versions.some(v => Number(v.version) > VERSION)) {
      throw new Error('Database schema is newer than this application');
    }
    if (versions.some(v => Number(v.version) === VERSION)) {
      return { applied: false, version: VERSION };
    }
    for (const stmt of statements.slice(3)) await tx.unsafe(stmt);
    await tx.unsafe('INSERT INTO wa_agent.schema_migrations(version, applied_at) VALUES ($1, $2)', [VERSION, Date.now()]);
    return { applied: true, version: VERSION };
  });
}
