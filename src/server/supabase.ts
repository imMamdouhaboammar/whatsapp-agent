import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SQL } from 'bun';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const databaseUrl = process.env.DATABASE_TRANSACTION_URL || process.env.DATABASE_URL || '';

let cachedClient: SupabaseClient | null = null;
let cachedSql: SQL | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase client requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY/SUPABASE_SECRET_KEY in environment');
  }
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedClient;
}

export function getPostgresClient(maxDepth = 1): SQL {
  if (maxDepth < 1) throw new Error('Recursion limit exceeded');
  if (!databaseUrl) {
    throw new Error('Database client requires DATABASE_URL in environment');
  }
  if (!cachedSql) {
    cachedSql = new SQL(databaseUrl, { max: 1, idleTimeout: 1 });
  }
  return cachedSql;
}

export async function testDatabaseConnection() {
  const results = {
    supabaseApi: false,
    postgresWire: false,
    postgresVersion: '',
    error: null as string | null
  };

  if (!supabaseUrl || !supabaseKey) {
    results.error = 'Missing SUPABASE_URL or SUPABASE_KEY in environment';
    return results;
  }

  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseKey }
    });
    results.supabaseApi = authRes.ok;
  } catch (err) {
    results.error = `Supabase API error: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!databaseUrl) {
    results.error = results.error ? `${results.error}; Missing DATABASE_URL` : 'Missing DATABASE_URL';
    return results;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const dbClient = getPostgresClient();
      const rows = await dbClient`SELECT version(), current_database(), current_user`;
      const firstRow: unknown = rows?.[0];
      if (typeof firstRow === 'object' && firstRow !== null && 'version' in firstRow && typeof firstRow.version === 'string' && firstRow.version.trim()) {
        results.postgresWire = true;
        results.postgresVersion = firstRow.version;
        results.error = null;
        break;
      }
      throw new Error('Postgres returned an invalid version response');
    } catch (err: unknown) {
      results.error = `Postgres Wire error: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }

  return results;
}
