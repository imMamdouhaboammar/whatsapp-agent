import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPgClient, migratePostgres, type PgClient, type PgTransaction } from './migrate';

interface TableSpec {
  databaseFile: string;
  table: string;
  columns: readonly string[];
  primaryKey: readonly string[];
  addLegacyBrand?: boolean;
}
const table = (
  databaseFile: string, name: string, columns: string[], primaryKey: string[], addLegacyBrand = false
): TableSpec => ({ databaseFile, table: name, columns, primaryKey, addLegacyBrand });

export const SQLITE_TABLES: readonly TableSpec[] = [
  table('fable_whatsapp.db', 'chats',
    ['id','name','phone_number','unread_count','last_message','last_timestamp','is_group','agent_mode','avatar_url'], ['id'], true),
  table('fable_whatsapp.db', 'messages',
    ['id','chat_id','sender','sender_name','text','timestamp','is_from_me','type','reply_to_id','quoted_json','reactions_json','transcription','status'], ['id'], true),
  table('fable_whatsapp.db', 'contact_dossiers',
    ['chat_id','name','phone','stage','facts_json','commitments_json','preferred_tone','notes','updated_at'], ['chat_id'], true),
  table('fable_whatsapp.db', 'drafts',
    ['id','chat_id','incoming_message_id','incoming_text','proposed_reply','reasoning','confidence','status','created_at'], ['id'], true),
  table('fable_whatsapp.db', 'contact_memories',
    ['id','brand_id','jid','content','created_at'], ['id']),
  table('agent-knowledge.sqlite', 'brand_sources',
    ['source_id','brand_id','type','locator','authority','locale','retired'], ['source_id']),
  table('agent-knowledge.sqlite', 'brand_source_versions',
    ['version_id','source_id','hash','current','last_checked'], ['version_id']),
  table('agent-knowledge.sqlite', 'knowledge_chunks',
    ['id','source_id','version_id','content','location','embedding_json'], ['id']),
  table('agent-actions.sqlite', 'agent_workflows',
    ['workflow_id','brand_id','contact_id','goal','state','created_at','updated_at'], ['workflow_id']),
  table('agent-actions.sqlite', 'agent_tool_runs',
    ['brand_id','key','workflow_id','tool_name','input_hash','status','output_json','created_at','updated_at'], ['brand_id','key']),
  table('agent-connectors.sqlite', 'brand_sheet_connectors',
    ['brand_id','sheet_id','gid','enabled','updated_at'], ['brand_id']),
  table('agent-customer.sqlite', 'customer_facts',
    ['brand_id','contact_id','key','value','source_message_id','confidence','verified_at','expires_at'], ['brand_id','contact_id','key']),
  table('agent-customer.sqlite', 'customer_cases',
    ['case_id','brand_id','contact_id','intent','source_message_id','status','provider_receipt_id','updated_at'], ['case_id']),
  table('agent-followups.sqlite', 'engagement_triggers',
    ['trigger_id','brand_id','contact_id','reason','due_at','source_workflow_id','consent_ref','template_ref','status','receipt_id','updated_at'], ['trigger_id']),
  table('agent-followups.sqlite', 'engagement_optouts',
    ['brand_id','contact_id','created_at'], ['brand_id','contact_id']),
  table('agent-quality.sqlite', 'agent_evaluations',
    ['brand_id','scenario_id','intent','resolved','supported','missing_source','question_hash','created_at'], ['brand_id','scenario_id'])
];

export interface ImportManifest {
  dataDir: string;
  legacyBrand: string;
  sources: { file: string; actualFile: string; exists: boolean }[];
  tables: { table: string; count: number; sha256: string }[];
}
export interface ImportResult { applied: boolean; fingerprint: string; manifest: ImportManifest }

function requireBrand(brand: string): void {
  if (!brand || brand.length > 128 || /[\x00-\x1f\x7f]/.test(brand) || brand.trim() !== brand) {
    throw new Error('Explicit valid --legacy-brand is required for legacy conversations');
  }
}
const ALLOWED_TABLES = new Set(SQLITE_TABLES.map(s => s.table));
const ALLOWED_COLUMNS = new Set([
  ...SQLITE_TABLES.flatMap(s => [...s.columns, ...s.primaryKey]),
  'brand_id'
]);

function quoted(name: string): string {
  if (!ALLOWED_TABLES.has(name) && !ALLOWED_COLUMNS.has(name)) {
    throw new Error(`Unrecognized SQL identifier: ${name}`);
  }
  return '"' + name + '"';
}
function columnNames(spec: TableSpec): string[] {
  return spec.addLegacyBrand ? ['brand_id', ...spec.columns] : [...spec.columns];
}
function numericSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    if (!Number.isSafeInteger(converted)) throw new Error('Unsafe integer in database; aborting import');
    return converted;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error('Unsafe integer in database; aborting import');
  }
  return value;
}
const NUMERIC_COLUMNS: Record<string, readonly string[]> = {
  chats: ['unread_count','last_timestamp','is_group'],
  messages: ['timestamp','is_from_me'],
  contact_dossiers: ['updated_at'],
  drafts: ['confidence','created_at'],
  contact_memories: ['created_at'],
  brand_sources: ['retired'],
  brand_source_versions: ['current','last_checked'],
  knowledge_chunks: ['id'],
  agent_workflows: ['created_at','updated_at'],
  agent_tool_runs: ['created_at','updated_at'],
  brand_sheet_connectors: ['enabled','updated_at'],
  customer_facts: ['confidence','verified_at','expires_at'],
  customer_cases: ['updated_at'],
  engagement_triggers: ['due_at','updated_at'],
  engagement_optouts: ['created_at'],
  agent_evaluations: ['resolved','supported','created_at']
};
function pgField(spec: TableSpec, column: string, value: unknown): unknown {
  if (typeof value === 'string' && NUMERIC_COLUMNS[spec.table]?.includes(column)) {
    const number = Number(value);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) {
      throw new Error(`Unsafe numeric value from PostgreSQL in ${spec.table}.${column}`);
    }
    return number;
  }
  return numericSafe(value);
}
function hashRow(hash: ReturnType<typeof createHash>, values: unknown[]): void {
  hash.update(JSON.stringify(values.map(numericSafe)) + '\n');
}
function sourceValues(spec: TableSpec, row: Record<string, unknown>, brand: string): unknown[] {
  return columnNames(spec).map(col => col === 'brand_id' && spec.addLegacyBrand ? brand : numericSafe(row[col]));
}
function getSourceRows(db: Database, spec: TableSpec): Iterable<Record<string, unknown>> {
  if (!ALLOWED_TABLES.has(spec.table)) {
    throw new Error(`Table not allowed: ${spec.table}`);
  }
  const columns = spec.columns.map(quoted).join(', ');
  const keys = spec.primaryKey.map(quoted).join(', ');
  const selectQuery = `SELECT ${columns} FROM ${quoted(spec.table)} ORDER BY ${keys}`;
  return db.query(selectQuery).iterate() as Iterable<Record<string, unknown>>;
}
function sourceTableDigest(db: Database, spec: TableSpec, brand: string): { count: number; sha256: string } {
  const hash = createHash('sha256');
  let count = 0;
  for (const row of getSourceRows(db, spec)) {
    hashRow(hash, sourceValues(spec, row, brand));
    count++;
  }
  return { count, sha256: hash.digest('hex') };
}
function openReadonly(dataDir: string, filename: string): Database {
  const sourcePath = join(dataDir, filename);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error(`SQLite source disappeared: ${filename}`);
  }
  const db = new Database(sourcePath, { readonly: true });
  const check = db.query('PRAGMA quick_check').get() as Record<string, unknown> | null;
  if (!check || Object.values(check)[0] !== 'ok') {
    db.close();
    throw new Error(`SQLite integrity check failed: ${filename}`);
  }
  const violations = db.query('PRAGMA foreign_key_check').all();
  if (violations.length) {
    db.close();
    throw new Error(`SQLite foreign key check failed: ${filename}`);
  }
  return db;
}
function assertSourceTables(db: Database, filename: string): void {
  const found = new Set(
    (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name: string}>).map(r => r.name)
  );
  const known = new Set(SQLITE_TABLES.filter(t => t.databaseFile === filename).map(t => t.table));
  for (const expected of known) {
    if (!found.has(expected)) throw new Error(`Missing expected SQLite table ${filename} / ${expected}`);
  }
  // An import receipt must account for every durable source table, even a
  // newly introduced one that has zero rows. Only SQLite bookkeeping and the
  // rebuildable knowledge FTS5 virtual table/shadow tables are exempt.
  const unknown = [...found].filter(name =>
    !known.has(name) && !name.startsWith('sqlite_') &&
    !(filename === 'agent-knowledge.sqlite' &&
      (name === 'knowledge_fts' || name.startsWith('knowledge_fts_')))
  );
  if (unknown.length) {
    throw new Error(`Unaccounted SQLite tables in ${filename}: ${unknown.sort().join(', ')}; extend the PostgreSQL schema and importer before migration`);
  }
}
const SOURCE_ALIASES: Record<string, string> = {
  'agent-knowledge.sqlite': 'brand-knowledge.sqlite',
  'agent-customer.sqlite': 'agent-customer-context.sqlite'
};
function resolveSource(dataDir: string, file: string): ImportManifest['sources'][number] {
  const alias = SOURCE_ALIASES[file];
  const canonicalExists = existsSync(join(dataDir, file));
  const aliasExists = Boolean(alias && existsSync(join(dataDir, alias)));
  if (canonicalExists && aliasExists) {
    throw new Error(`Ambiguous SQLite sources: both ${file} and ${alias} exist; inspect and consolidate them before migration`);
  }
  return {file, actualFile: aliasExists ? alias : file, exists: canonicalExists || aliasExists};
}
export function inspectSqliteSources({ dataDir, legacyBrand }: {dataDir: string; legacyBrand: string}): ImportManifest {
  requireBrand(legacyBrand);
  const directory = resolve(dataDir);
  const files = [...new Set(SQLITE_TABLES.map(t => t.databaseFile))];
  const knownFilenames = new Set([...files, ...Object.values(SOURCE_ALIASES)]);
  const unknownFiles = readdirSync(directory).filter(filename =>
    /\.(?:db|sqlite)$/i.test(filename) && !knownFilenames.has(filename)
  );
  if (unknownFiles.length) {
    throw new Error(`Unaccounted SQLite source files: ${unknownFiles.sort().join(', ')}; extend the importer before migration`);
  }
  const sources = files.map(file => resolveSource(directory, file));
  if (!sources.some(source => source.exists)) throw new Error('No existing SQLite source databases found');
  const summaries: ImportManifest['tables'] = [];
  for (const source of sources) {
    if (!source.exists) {
      for (const spec of SQLITE_TABLES.filter(t => t.databaseFile === source.file)) {
        summaries.push({table: spec.table, count: 0, sha256: createHash('sha256').digest('hex')});
      }
      continue;
    }
    const db = openReadonly(directory, source.actualFile);
    try {
      db.run('BEGIN');
      assertSourceTables(db, source.file);
      for (const spec of SQLITE_TABLES.filter(t => t.databaseFile === source.file)) {
        summaries.push({table: spec.table, ...sourceTableDigest(db, spec, legacyBrand)});
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    } finally { db.close(); }
  }
  return { dataDir: directory, legacyBrand, sources, tables: summaries };
}
export function getImportFingerprint(manifest: ImportManifest, maxDepth = 1): string {
  if (maxDepth < 1) return '';
  // A fingerprint must be portable between directories on different hosts.
  return createHash('sha256').update(JSON.stringify({
    brand: manifest.legacyBrand,
    sources: manifest.sources,
    tables: manifest.tables
  })).digest('hex');
}
function sameTableDigests(a: ImportManifest, b: ImportManifest): boolean {
  return getImportFingerprint(a) === getImportFingerprint(b);
}
async function targetDigest(tx: PgTransaction, spec: TableSpec): Promise<{count: number; sha256: string}> {
  const cols = columnNames(spec).map(quoted).join(', ');
  const keys = [...(spec.addLegacyBrand ? ['brand_id'] : []), ...spec.primaryKey];
  // SQLite default BINARY comparison follows UTF-8 byte order; PostgreSQL's
  // "C" collation keeps the same ordering for deterministic fingerprints.
  const order = keys.map(key => spec.table === 'knowledge_chunks' && key === 'id'
    ? quoted(key) : `${quoted(key)} COLLATE "C"`).join(', ');
  const hash = createHash('sha256');
  let count = 0;
  let cursor: unknown[] | undefined;
  const PAGE = 250;
  while (true) {
    const params = cursor ? [...cursor, PAGE] : [PAGE];
    const where = cursor
      ? `WHERE (${order}) > (${cursor.map((_, i) => '$' + (i + 1)).join(', ')}) `
      : '';
    const rows = await tx.unsafe(
      `SELECT ${cols} FROM wa_agent.${quoted(spec.table)} ${where}ORDER BY ${order} LIMIT $${params.length}`,
      params
    );
    for (const row of rows) {
      hashRow(hash, columnNames(spec).map(name => pgField(spec, name, row[name])));
      count++;
    }
    if (rows.length < PAGE) break;
    cursor = keys.map(key => rows[rows.length - 1][key]);
  }
  return { count, sha256: hash.digest('hex') };
}
async function writeSource(tx: PgTransaction, spec: TableSpec, dataDir: string, brand: string, filename: string): Promise<void> {
  const db = openReadonly(dataDir, filename);
  try {
    db.run('BEGIN');
    const columns = columnNames(spec);
    const batch: unknown[][] = [];
    const insertBatch = async () => {
      if (!batch.length) return;
      const placeholders: string[] = [];
      const params: unknown[] = [];
      for (const row of batch) {
        placeholders.push('(' + row.map(value => {
          params.push(value);
          return '$' + params.length;
        }).join(', ') + ')');
      }
      await tx.unsafe(
        `INSERT INTO wa_agent.${quoted(spec.table)} (${columns.map(quoted).join(', ')}) VALUES ${placeholders.join(', ')}`,
        params
      );
      batch.length = 0;
    };
    for (const row of getSourceRows(db, spec)) {
      batch.push(sourceValues(spec, row, brand));
      if (batch.length === 100) await insertBatch();
    }
    await insertBatch();
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  } finally { db.close(); }
}
export async function importSqliteToPostgres(options: {
  dataDir: string; legacyBrand: string; apply: boolean; client?: PgClient; databaseUrl?: string;
}): Promise<ImportResult> {
  const manifest = inspectSqliteSources(options);
  const fingerprint = getImportFingerprint(manifest);
  if (!options.apply) return {applied: false, fingerprint, manifest};
  const client = options.client ?? createPgClient(options.databaseUrl ?? process.env.DATABASE_URL ?? '');
  const ownsClient = !options.client;
  try {
    await migratePostgres(client);
    await client.begin(async tx => {
      await tx.unsafe('SELECT pg_advisory_xact_lock(20261106, 2)');
      const previous = await tx.unsafe('SELECT fingerprint FROM wa_agent.data_imports LIMIT 1');
      if (previous.length) throw new Error('Target already contains a data import; refusing to overwrite');
      for (const spec of SQLITE_TABLES) {
        const rows = await tx.unsafe(`SELECT COUNT(*) AS count FROM wa_agent.${quoted(spec.table)}`);
        if (Number(rows[0]?.count ?? 0) !== 0) {
          throw new Error(`Target table ${spec.table} is not empty; refusing to overwrite`);
        }
      }
      for (const spec of SQLITE_TABLES) {
        const source = manifest.sources.find(s => s.file === spec.databaseFile);
        if (source?.exists) {
          await writeSource(tx, spec, manifest.dataDir, manifest.legacyBrand, source.actualFile);
        }
      }
      // Explicit IDs were imported into an identity column; advance its next value.
      await tx.unsafe(`SELECT setval(pg_get_serial_sequence('wa_agent.knowledge_chunks', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM wa_agent.knowledge_chunks), 0), 1), true)`);
      const after = inspectSqliteSources(options);
      if (!sameTableDigests(manifest, after)) {
        throw new Error('SQLite sources changed during import; stop all writers and retry');
      }
      for (const expected of manifest.tables) {
        const spec = SQLITE_TABLES.find(t => t.table === expected.table)!;
        const actual = await targetDigest(tx, spec);
        if (actual.count !== expected.count || actual.sha256 !== expected.sha256) {
          throw new Error(`PostgreSQL verification mismatch for ${expected.table}`);
        }
      }
      await tx.unsafe(
        'INSERT INTO wa_agent.data_imports(fingerprint, legacy_brand_id, manifest_json, imported_at) VALUES ($1,$2,$3,$4)',
        [fingerprint, manifest.legacyBrand, JSON.stringify({sources:manifest.sources,tables:manifest.tables}), Date.now()]
      );
    });
    return {applied: true, fingerprint, manifest};
  } finally {
    if (ownsClient) await client.close?.();
  }
}
