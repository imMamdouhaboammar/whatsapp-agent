import type { Database } from 'bun:sqlite';

export function sqliteTransaction<T>(db: Database, mode: 'immediate' | 'deferred', work: () => T): T {
  // Bun's transaction variants are declared as returning void.
  let result: { value: T } | undefined;
  db.transaction(() => { result = { value: work() }; })[mode]();
  if (!result) throw new Error('SQLite transaction callback did not run');
  return result.value;
}

export function readChoice<const T extends string>(value: unknown, choices: readonly T[], field: string): T {
  const match = choices.find(choice => choice === value);
  if (match === undefined) throw new Error(`Invalid ${field}`);
  return match;
}

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function readSqliteRow(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('Invalid SQLite row');
  return value;
}

export function readSqliteText(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw new TypeError('Invalid SQLite text column: ' + field);
  return value;
}

export function readSqliteNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid SQLite numeric column: ' + field);
  return value;
}

export function readNullableSqliteText(row: Record<string, unknown>, field: string): string | null {
  return row[field] === null ? null : readSqliteText(row, field);
}

export function readNullableSqliteNumber(row: Record<string, unknown>, field: string): number | null {
  return row[field] === null ? null : readSqliteNumber(row, field);
}
