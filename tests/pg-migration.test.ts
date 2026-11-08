import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/domain/db';
import { BrandKnowledgeStore } from '../src/agent/brand-knowledge';
import {
  SQLITE_TABLES,
  inspectSqliteSources,
  importSqliteToPostgres,
  getImportFingerprint
} from '../src/persistence/postgres/sqlite-import';
import {
  getMigrationStatements,
  migratePostgres
} from '../src/persistence/postgres/migrate';

function fixture(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'wa-pg-migration-'));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
async function asyncFixture(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'wa-pg-migration-'));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('PostgreSQL migration contract', () => {
  test('covers every non-derived SQLite table across all seven source files', () => {
    expect(SQLITE_TABLES).toHaveLength(16);
    expect(new Set(SQLITE_TABLES.map(t => t.databaseFile)).size).toBe(7);
    expect(new Set(SQLITE_TABLES.map(t => t.table)).size).toBe(16);
    expect(SQLITE_TABLES.some(t => t.table === 'knowledge_fts')).toBe(false);
    const statements = getMigrationStatements();
    for (const table of SQLITE_TABLES) {
      expect(statements.some(s => s.includes(`CREATE TABLE IF NOT EXISTS wa_agent.${table.table} `))).toBe(true);
    }
    expect(statements.some(s => s.includes('CREATE INDEX') && s.includes('knowledge_chunks') && s.includes('GIN'))).toBe(true);
    expect(statements.some(s => s.includes('REVOKE ALL ON SCHEMA wa_agent FROM PUBLIC'))).toBe(true);
  });

  test('requires explicit brand ownership for legacy chat tables', () => {
    expect(SQLITE_TABLES.filter(t => t.addLegacyBrand).map(t => t.table).sort())
      .toEqual(['chats', 'contact_dossiers', 'drafts', 'messages']);
    fixture(root => {
      expect(() => inspectSqliteSources({ dataDir: root, legacyBrand: '' })).toThrow(/brand/i);
    });
  });

  test('inspects source files read-only, retaining history and deterministic fingerprints', () => {
    fixture(root => {
      const data = join(root, 'data');
      mkdirSync(data);
      const store = new SqliteStore({dbPath: join(data, 'fable_whatsapp.db')});
      store.saveChat({id:'123@s.whatsapp.net',name:'أحمد',unreadCount:0,isGroup:false,agentMode:'autopilot'});
      store.saveMessage({id:'m-1',chatId:'123@s.whatsapp.net',sender:'123',text:'مرحبا',timestamp:1760000000000,isFromMe:false,type:'text'});
      store.close();
      // Exercise the original 16-table importer against its historical source contract.
      const historical = new Database(join(data, 'fable_whatsapp.db'));
      for (const name of ['send_intent_events', 'send_attempts', 'send_intents', 'learning_states', 'learning_reflections']) {
        historical.run(`DROP TABLE ${name}`);
      }
      historical.close();
      const first = inspectSqliteSources({ dataDir: data, legacyBrand: 'shop-1' });
      const second = inspectSqliteSources({ dataDir: data, legacyBrand: 'shop-1' });
      expect(first.tables.find(t => t.table === 'chats')?.count).toBe(1);
      expect(first.tables.find(t => t.table === 'messages')?.count).toBe(1);
      expect(first.sources.filter(s => s.exists)).toHaveLength(1);
      expect(first.tables.find(t => t.table === 'brand_sources')?.count).toBe(0);
      expect(first.tables.find(t => t.table === 'chats')?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(getImportFingerprint(first)).toBe(getImportFingerprint(second));
      expect(() => inspectSqliteSources({ dataDir: data, legacyBrand: 'shop-2' })).not.toThrow();
      expect(getImportFingerprint(first)).not.toBe(getImportFingerprint(inspectSqliteSources({ dataDir: data, legacyBrand: 'shop-2' })));
    });
  });

  test('fails if an existing database is missing an expected table', () => {
    fixture(root => {
      const db = new Database(join(root, 'fable_whatsapp.db'));
      db.run('CREATE TABLE chats(id TEXT PRIMARY KEY)');
      db.close();
      expect(() => inspectSqliteSources({ dataDir: root, legacyBrand: 'business' })).toThrow(/messages|missing/i);
    });
  });

  test('refuses an S01 delivery ledger omitted from the import contract before any PostgreSQL write', async () => {
    await asyncFixture(async root => {
      const store = new SqliteStore({ dbPath: join(root, 'fable_whatsapp.db') });
      store.close();
      const db = new Database(join(root, 'fable_whatsapp.db'), { readonly: true });
      const names = new Set((db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
      db.close();
      expect(['send_intents', 'send_attempts', 'send_intent_events'].every(name => names.has(name))).toBe(true);
      let postgresTouched = false;
      await expect(importSqliteToPostgres({
        dataDir: root, legacyBrand: 'brand-a', apply: true,
        client: { begin: async () => { postgresTouched = true; throw new Error('PG should remain untouched'); } }
      })).rejects.toThrow(/unaccounted|send_intents|send_attempts|send_intent_events/i);
      expect(postgresTouched).toBe(false);
      expect(() => inspectSqliteSources({ dataDir: root, legacyBrand: 'brand-a' }))
        .toThrow(/unaccounted|send_intents/i);
    });
  });

  test('also rejects unmigrated learning tables even without S01 delivery tables', () => {
    fixture(root => {
      const store = new SqliteStore({ dbPath: join(root, 'fable_whatsapp.db') });
      store.close();
      const db = new Database(join(root, 'fable_whatsapp.db'));
      for (const name of ['send_intent_events', 'send_attempts', 'send_intents']) {
        db.run(`DROP TABLE ${name}`);
      }
      db.close();
      expect(() => inspectSqliteSources({ dataDir: root, legacyBrand: 'brand-a' }))
        .toThrow(/unaccounted.*learning_reflections.*learning_states/i);
    });
  });

  test('accepts derived FTS5 search tables while checking durable knowledge rows', () => {
    fixture(root => {
      const store = new BrandKnowledgeStore({ dbPath: join(root, 'agent-knowledge.sqlite') });
      store.close();
      const manifest = inspectSqliteSources({ dataDir: root, legacyBrand: 'brand-a' });
      expect(manifest.sources.find(source => source.file === 'agent-knowledge.sqlite')?.exists).toBe(true);
      expect(manifest.tables.filter(row => row.table.startsWith('knowledge_fts'))).toHaveLength(0);
    });
  });

  test('rejects unaccounted new SQLite database files before calculating import success', () => {
    fixture(root => {
      const known = new Database(join(root, 'agent-quality.sqlite'));
      known.run('CREATE TABLE agent_evaluations(brand_id TEXT,scenario_id TEXT,intent TEXT,resolved INTEGER,supported INTEGER,missing_source TEXT,question_hash TEXT,created_at INTEGER)');
      known.close();
      new Database(join(root, 'agent-working-context.sqlite')).close();
      expect(() => inspectSqliteSources({ dataDir: root, legacyBrand: 'brand-a' }))
        .toThrow(/unaccounted.*agent-working-context/i);
    });
  });

  test('dry-run does not create PostgreSQL connection or modify SQLite', async () => {
    await asyncFixture(async root => {
      const db = new Database(join(root, 'agent-quality.sqlite'));
      db.run('CREATE TABLE agent_evaluations(brand_id TEXT,scenario_id TEXT,intent TEXT,resolved INTEGER,supported INTEGER,missing_source TEXT,question_hash TEXT,created_at INTEGER)');
      db.query('INSERT INTO agent_evaluations VALUES (?,?,?,?,?,?,?,?)').run('brand-x','s1','returns',0,1,null,'hash',1760000000000);
      db.close();
      const result = await importSqliteToPostgres({ dataDir: root, legacyBrand: 'brand-x', apply: false });
      expect(result.applied).toBe(false);
      expect(result.manifest.tables.find(t => t.table === 'agent_evaluations')?.count).toBe(1);
    });
  });

  test('migration lock and version ledger are executed inside transaction', async () => {
    const sql: string[] = [];
    const client = {
      begin: async <T>(callback: (tx: {unsafe: (statement:string, params?:unknown[])=>Promise<Record<string,unknown>[]>})=>Promise<T>):Promise<T> => {
        return callback({unsafe: async statement => {
          sql.push(statement);
          if (statement.includes('SELECT version FROM wa_agent.schema_migrations')) return [];
          return [];
        }});
      }
    };
    await migratePostgres(client);
    expect(sql[0]).toContain('pg_advisory_xact_lock');
    expect(sql.some(s => s.includes('INSERT INTO wa_agent.schema_migrations'))).toBe(true);
    expect(sql.some(s => s.includes('CREATE TABLE IF NOT EXISTS wa_agent.messages'))).toBe(true);
  });
});

class FakePg {
  tables = new Map<string, Record<string, unknown>[]>();
  schemaVersion = 0;
  importFingerprints: string[] = [];
  executed: string[] = [];
  corruptImport = false;
  wireBigintsAsText = false;
  async begin<T>(callback: (tx: {unsafe: (sql:string,params?:unknown[])=>Promise<Record<string,unknown>[]>})=>Promise<T>): Promise<T> {
    const staged = new Map([...this.tables].map(([name, rows]) => [name, rows.map(row => ({...row}))]));
    let version = this.schemaVersion;
    let imports = [...this.importFingerprints];
    const transaction = {
      unsafe: async (sql:string, params:unknown[] = []):Promise<Record<string,unknown>[]> => {
        this.executed.push(sql);
        if (sql.includes('SELECT version FROM wa_agent.schema_migrations')) return version ? [{version}] : [];
        if (sql.startsWith('INSERT INTO wa_agent.schema_migrations')) {version=1;return [];}
        if (sql.startsWith('SELECT fingerprint FROM wa_agent.data_imports')) return imports.map(fingerprint=>({fingerprint}));
        const count=sql.match(/^SELECT COUNT\(\*\) AS count FROM wa_agent\."?([a-z_]+)"?$/);
        if (count) return [{count:(staged.get(count[1])??[]).length}];
        const insert=sql.match(/^INSERT INTO wa_agent\."?([a-z_]+)"? \(([^)]+)\) VALUES /);
        if (insert) {
          const cols=insert[2].split(',').map(s=>s.trim().replaceAll('"',''));
          const rows=staged.get(insert[1])??[];
          for(let offset=0;offset<params.length;offset+=cols.length) {
            const row=Object.fromEntries(cols.map((name,i)=>[name,params[offset+i]]));
            if(this.corruptImport && insert[1]==='agent_evaluations')row.intent='wrong';
            rows.push(row);
          }
          staged.set(insert[1],rows);
          return [];
        }
        const select=sql.match(/^SELECT .+ FROM wa_agent\."?([a-z_]+)"? (?:WHERE .+ )?ORDER BY .+ LIMIT \$\d+$/);
        if (select) {
          const spec=SQLITE_TABLES.find(t=>t.table===select[1])!;
          const keys=spec.addLegacyBrand ? ['brand_id',...spec.primaryKey] : [...spec.primaryKey];
          const compare=(left:Record<string,unknown>,right:unknown[]) => {
            for(let i=0;i<keys.length;i++) {
              const a=left[keys[i]], b=right[i];
              const delta=typeof a==='number' && typeof b==='number' ? a-b : String(a).localeCompare(String(b),'en');
              if(delta !== 0)return delta;
            }
            return 0;
          };
          const rows=(staged.get(select[1])??[]).sort((a,b)=>compare(a,keys.map(k=>b[k])));
          const cursor=params.length > 1 ? params.slice(0,-1) : undefined;
          const page=cursor ? rows.filter(row=>compare(row,cursor)>0) : rows;
          return page.slice(0,Number(params[params.length-1])).map(row => {
            if (!this.wireBigintsAsText) return row;
            return Object.fromEntries(Object.entries(row).map(([key,value]) =>
              [key, key === 'created_at' && typeof value === 'number' ? String(value) : value]));
          });
        }
        if (sql.startsWith('INSERT INTO wa_agent.data_imports')) {imports.push(String(params[0]));return [];}
        return [];
      }
    };
    const result=await callback(transaction);
    this.tables=staged;
    this.schemaVersion=version;
    this.importFingerprints=imports;
    return result;
  }
}

test('offline import verifies all 16 tables and records a single successful fingerprint', async () => {
  await asyncFixture(async root => {
    const db = new Database(join(root, 'agent-quality.sqlite'));
    db.run('CREATE TABLE agent_evaluations(brand_id TEXT,scenario_id TEXT,intent TEXT,resolved INTEGER,supported INTEGER,missing_source TEXT,question_hash TEXT,created_at INTEGER)');
    db.query('INSERT INTO agent_evaluations VALUES (?,?,?,?,?,?,?,?)').run('store-1','sc-1','shipping',1,1,null,'qhash',1760000000000);
    db.close();
    const pg = new FakePg();
    pg.wireBigintsAsText = true;
    const result=await importSqliteToPostgres({dataDir:root,legacyBrand:'store-1',apply:true,client:pg});
    expect(result.applied).toBe(true);
    expect(pg.schemaVersion).toBe(1);
    expect(pg.tables.get('agent_evaluations')?.[0]?.intent).toBe('shipping');
    expect(pg.importFingerprints).toEqual([result.fingerprint]);
    expect(pg.tables.size).toBe(1);
    expect(pg.executed.some(sql => /OFFSET/i.test(sql))).toBe(false);
    await expect(importSqliteToPostgres({dataDir:root,legacyBrand:'store-1',apply:true,client:pg})).rejects.toThrow(/already contains/i);
  });
});

test('refuses a populated target, without modifying any existing row', async () => {
  await asyncFixture(async root => {
    const db = new Database(join(root, 'agent-quality.sqlite'));
    db.run('CREATE TABLE agent_evaluations(brand_id TEXT,scenario_id TEXT,intent TEXT,resolved INTEGER,supported INTEGER,missing_source TEXT,question_hash TEXT,created_at INTEGER)');
    db.close();
    const pg = new FakePg();
    pg.tables.set('chats',[{brand_id:'other-store',id:'existing'}]);
    await expect(importSqliteToPostgres({dataDir:root,legacyBrand:'store-1',apply:true,client:pg})).rejects.toThrow(/not empty/i);
    expect(pg.tables.get('chats')).toEqual([{brand_id:'other-store',id:'existing'}]);
    expect(pg.importFingerprints).toHaveLength(0);
  });
});

test('hash mismatch rolls back import rows and import receipt', async () => {
  await asyncFixture(async root => {
    const db = new Database(join(root, 'agent-quality.sqlite'));
    db.run('CREATE TABLE agent_evaluations(brand_id TEXT,scenario_id TEXT,intent TEXT,resolved INTEGER,supported INTEGER,missing_source TEXT,question_hash TEXT,created_at INTEGER)');
    db.query('INSERT INTO agent_evaluations VALUES (?,?,?,?,?,?,?,?)').run('store-1','sc-1','returns',0,0,'policy','qhash',1760000000000);
    db.close();
    const pg = new FakePg();
    pg.corruptImport=true;
    await expect(importSqliteToPostgres({dataDir:root,legacyBrand:'store-1',apply:true,client:pg})).rejects.toThrow(/verification mismatch/i);
    expect(pg.tables.get('agent_evaluations')).toBeUndefined();
    expect(pg.importFingerprints).toHaveLength(0);
  });
});

test('verifies more than one page with keyset pagination', async () => {
  await asyncFixture(async root => {
    const db = new Database(join(root, 'agent-quality.sqlite'));
    db.run('CREATE TABLE agent_evaluations(brand_id TEXT,scenario_id TEXT,intent TEXT,resolved INTEGER,supported INTEGER,missing_source TEXT,question_hash TEXT,created_at INTEGER)');
    const insert=db.query('INSERT INTO agent_evaluations VALUES (?,?,?,?,?,?,?,?)');
    for(let i=0;i<263;i++) {
      insert.run('brand-a', 'case-'+String(i).padStart(4,'0'), 'shipping', i%2, 1, null, 'q'+i, 1760000000000+i);
    }
    db.close();
    const pg=new FakePg();
    const result=await importSqliteToPostgres({dataDir:root,legacyBrand:'brand-a',apply:true,client:pg});
    expect(result.manifest.tables.find(t=>t.table==='agent_evaluations')?.count).toBe(263);
    expect(pg.tables.get('agent_evaluations')?.length).toBe(263);
    expect(pg.executed.some(sql=>sql.includes('WHERE (') && sql.includes('COLLATE "C"'))).toBe(true);
    expect(pg.executed.some(sql=>/OFFSET/i.test(sql))).toBe(false);
  });
});

test('detects the older standalone knowledge and customer database filenames', () => {
  fixture(root => {
    const knowledge=new Database(join(root,'brand-knowledge.sqlite'));
    knowledge.run('CREATE TABLE brand_sources(source_id TEXT PRIMARY KEY,brand_id TEXT,type TEXT,locator TEXT,authority TEXT,locale TEXT,retired INTEGER)');
    knowledge.run('CREATE TABLE brand_source_versions(version_id TEXT PRIMARY KEY,source_id TEXT,hash TEXT,current INTEGER,last_checked INTEGER)');
    knowledge.run('CREATE TABLE knowledge_chunks(id INTEGER PRIMARY KEY,source_id TEXT,version_id TEXT,content TEXT,location TEXT,embedding_json TEXT)');
    knowledge.close();
    const customer=new Database(join(root,'agent-customer-context.sqlite'));
    customer.run('CREATE TABLE customer_facts(brand_id TEXT,contact_id TEXT,key TEXT,value TEXT,source_message_id TEXT,confidence REAL,verified_at INTEGER,expires_at INTEGER)');
    customer.run('CREATE TABLE customer_cases(case_id TEXT PRIMARY KEY,brand_id TEXT,contact_id TEXT,intent TEXT,source_message_id TEXT,status TEXT,provider_receipt_id TEXT,updated_at INTEGER)');
    customer.close();
    const manifest=inspectSqliteSources({dataDir:root,legacyBrand:'shop-x'});
    expect(manifest.sources.find(s=>s.file==='agent-knowledge.sqlite')?.actualFile).toBe('brand-knowledge.sqlite');
    expect(manifest.sources.find(s=>s.file==='agent-customer.sqlite')?.actualFile).toBe('agent-customer-context.sqlite');
  });
});

test('refuses ambiguous canonical and standalone SQLite files with possible split data', () => {
  fixture(root => {
    new Database(join(root,'agent-knowledge.sqlite')).close();
    new Database(join(root,'brand-knowledge.sqlite')).close();
    expect(()=>inspectSqliteSources({dataDir:root,legacyBrand:'shop-x'})).toThrow(/ambiguous|both/i);
  });
});
