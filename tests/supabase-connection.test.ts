import { describe, expect, it } from 'bun:test';
import { testDatabaseConnection, getSupabaseClient, getPostgresClient } from '../src/server/supabase';

const hasCredentials = Boolean(process.env.SUPABASE_URL && process.env.DATABASE_URL);

describe('Supabase & PostgreSQL Database Connection', () => {
  it('fails closed when environment variables are missing', async () => {
    if (!hasCredentials) {
      expect(() => getSupabaseClient()).toThrow();
      expect(() => getPostgresClient()).toThrow();
      const health = await testDatabaseConnection();
      expect(health.error).toBeDefined();
    }
  });

  it.skipIf(!hasCredentials)('connects to Supabase REST and Auth endpoints successfully when configured', async () => {
    const client = getSupabaseClient();
    expect(client).toBeDefined();

    const health = await testDatabaseConnection();
    expect(health.supabaseApi).toBe(true);
  }, 15000);

  it.skipIf(!hasCredentials)('connects to Supabase PostgreSQL wire protocol via IPv4 pooler and executes queries when configured', async () => {
    const health = await testDatabaseConnection();
    expect(health.postgresWire).toBe(true);
    expect(health.postgresVersion).toContain('PostgreSQL');

    const sql = getPostgresClient();
    const rows = await sql`SELECT 1 + 1 AS addition, current_database() AS db_name`;
    expect(rows).toBeDefined();
    expect(rows.length).toBe(1);
    const row = rows[0] as Record<string, unknown>;
    expect(Number(row.addition)).toBe(2);
    expect(row.db_name).toBe('postgres');
  }, 15000);
});
