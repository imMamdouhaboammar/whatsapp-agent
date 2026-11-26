export const isSqlRow = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function readSqlRow(value: unknown): Record<string, unknown> {
  if (!isSqlRow(value)) throw new Error('Invalid SQL row');
  return value;
}

export function readSqlRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid SQL result');
  return value.map(readSqlRow);
}

export function readPgText(value: unknown, column: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid PostgreSQL ${column}`);
  return value;
}

export function readPgInteger(value: unknown, column: string): number {
  const number = typeof value === 'number' || typeof value === 'bigint' ||
    (typeof value === 'string' && /^-?\d+$/.test(value))
    ? Number(value)
    : NaN;
  if (!Number.isSafeInteger(number)) throw new Error(`Invalid PostgreSQL ${column}`);
  return number;
}
