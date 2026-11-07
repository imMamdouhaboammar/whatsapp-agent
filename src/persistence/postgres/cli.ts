#!/usr/bin/env bun
import { createPgClient, migratePostgres } from './migrate';
import { importSqliteToPostgres } from './sqlite-import';

function option(name: string, maxDepth = 1): string | undefined {
  if (maxDepth < 1) return undefined;
  const i = Bun.argv.indexOf(name);
  if (i === -1) return undefined;
  if (!Bun.argv[i + 1] || Bun.argv[i + 1].startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return Bun.argv[i + 1];
}
function requireValue(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function printHelp() {
  console.log(`PostgreSQL / Supabase migration

  bun run db:postgres --schema
  bun run db:postgres --inspect --data-dir ./data --legacy-brand my-brand
  bun run db:postgres --import --apply --data-dir ./data --legacy-brand my-brand

--inspect is read-only and requires no database connection.
--import defaults to dry-run unless --apply is explicitly supplied.
--schema and --apply require DATABASE_URL in the environment.
Stop the WhatsApp application before the final import.
The importer leaves every SQLite source file unchanged.`);
}
async function main() {
  const actions = ['--schema','--inspect','--import'].filter(action => Bun.argv.includes(action));
  if (actions.length !== 1) {
    printHelp();
    if (actions.length !== 0) throw new Error('Choose exactly one action');
    return;
  }
  if (actions[0] === '--schema') {
    const client = createPgClient(process.env.DATABASE_URL ?? '');
    try {
      console.log(JSON.stringify(await migratePostgres(client), null, 2));
    } finally { await client.close?.(); }
    return;
  }
  const dataDir = requireValue('--data-dir');
  const legacyBrand = requireValue('--legacy-brand');
  const apply = actions[0] === '--import' && Bun.argv.includes('--apply');
  if (Bun.argv.includes('--apply') && !apply) throw new Error('--apply requires --import');
  if (apply && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for --apply');
  }
  const result = await importSqliteToPostgres({dataDir,legacyBrand,apply});
  console.log(JSON.stringify({
    applied: result.applied,
    fingerprint: result.fingerprint,
    files: result.manifest.sources,
    tables: result.manifest.tables.map(({table,count,sha256}) => ({table,count,sha256})),
    note: apply ? 'Imported and verified in PostgreSQL' : 'Dry run only; no PostgreSQL changes'
  }, null, 2));
}
await main().catch(error => {
  console.error('Migration stopped:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
