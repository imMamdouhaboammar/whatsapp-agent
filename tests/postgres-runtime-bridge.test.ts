import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresActionJournal } from '../src/persistence/postgres/action-journal';
import { resolveRuntimeDatastore, POST_S01_UNMIGRATED_TABLES } from '../src/persistence/postgres/runtime-selection';
import type { PgClient, PgTransaction } from '../src/persistence/postgres/migrate';

type Row = Record<string, unknown>;
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const keyFor = (brand: string, key: string) => JSON.stringify([brand, key]);

class FakePg implements PgClient {
  workflows = new Map<string, Row>();
  runs = new Map<string, Row>();
  transactionCount = 0;
  private tail: Promise<void> = Promise.resolve();

  async begin<T>(run: (tx: PgTransaction) => Promise<T>): Promise<T> {
    const before = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await before;
    const workflows = new Map([...this.workflows].map(([k, value]) => [k, { ...value }]));
    const runs = new Map([...this.runs].map(([k, value]) => [k, { ...value }]));
    this.transactionCount++;
    const tx: PgTransaction = { unsafe: async (text, params = []) => {
      const sql = normalize(text);
      if (sql.startsWith('INSERT INTO wa_agent.agent_workflows')) {
        const [workflow_id, brand_id, contact_id, goal, state, created_at, updated_at] = params;
        if (workflows.has(String(workflow_id))) return [];
        workflows.set(String(workflow_id), { workflow_id, brand_id, contact_id, goal, state, created_at, updated_at });
        return [{ workflow_id }];
      }
      if (sql.startsWith('SELECT brand_id, contact_id, goal FROM wa_agent.agent_workflows')) {
        const row = workflows.get(String(params[0]));
        return row && row.brand_id === params[1]
          ? [{ brand_id: row.brand_id, contact_id: row.contact_id, goal: row.goal }] : [];
      }
      if (sql.startsWith('UPDATE wa_agent.agent_workflows')) {
        const [state, updatedAt, brandId, workflowId] = params;
        const row = workflows.get(String(workflowId));
        if (!row || row.brand_id !== brandId) return [];
        workflows.set(String(workflowId), { ...row, state, updated_at: updatedAt });
        return [{ workflow_id: workflowId }];
      }
      if (sql.startsWith('SELECT workflow_id FROM wa_agent.agent_workflows')) {
        const row = workflows.get(String(params[1]));
        return row && row.brand_id === params[0] ? [{ workflow_id: row.workflow_id }] : [];
      }
      if (sql.startsWith('INSERT INTO wa_agent.agent_tool_runs')) {
        const [brand_id, key, workflow_id, tool_name, input_hash, status, created_at, updated_at] = params;
        const id = keyFor(String(brand_id), String(key));
        if (runs.has(id)) return [];
        runs.set(id, { brand_id, key, workflow_id, tool_name, input_hash, status, output_json: null, created_at, updated_at });
        return [{ brand_id }];
      }
      if (sql.startsWith('SELECT brand_id, "key", workflow_id')) {
        const row = runs.get(keyFor(String(params[0]), String(params[1])));
        return row ? [{ ...row }] : [];
      }
      if (sql.startsWith('UPDATE wa_agent.agent_tool_runs')) {
        const [status, output, updatedAt, brandId, key] = params;
        const id = keyFor(String(brandId), String(key));
        const row = runs.get(id);
        if (!row || !(row.status === 'attempting' || (row.status === 'uncertain' && status === 'confirmed'))) return [];
        runs.set(id, { ...row, status, output_json: output, updated_at: updatedAt });
        return [{ key }];
      }
      throw new Error('Unexpected SQL query in action-journal test: ' + sql);
    }};
    try {
      const result = await run(tx);
      this.workflows = workflows;
      this.runs = runs;
      return result;
    } finally { unlock(); }
  }
}

const invocation = (brandId: string, idempotencyKey = 'same-key', input: unknown = { sku: 'SKU-12' }) => ({
  brandId,
  toolName: 'inventory.adjust',
  workflowId: 'workflow-1',
  idempotencyKey,
  input
});

describe('PostgreSQL S3 action-journal runtime contract', () => {
  test('creates brand-owned workflow and rejects foreign ownership', async () => {
    const pg = new FakePg();
    const journal = new PostgresActionJournal(pg, { now: () => 1760000000000 });
    await expect(journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Restock item', workflowId: 'workflow-1'
    })).resolves.toBe('workflow-1');
    await expect(journal.createWorkflow({
      brandId: 'brand-b', contactId: 'contact-b', goal: 'Different order', workflowId: 'workflow-1'
    })).rejects.toThrow(/owner|brand/i);
    await expect(journal.createWorkflow({
      brandId: 'brand-a', contactId: 'different-contact', goal: 'Restock item', workflowId: 'workflow-1'
    })).rejects.toThrow(/conflict/i);
    await expect(journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Changed goal', workflowId: 'workflow-1'
    })).rejects.toThrow(/conflict/i);
    await expect(journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Restock item', workflowId: 'workflow-1'
    })).resolves.toBe('workflow-1');
    await expect(journal.updateWorkflow('brand-b', 'workflow-1', 'completed')).rejects.toThrow(/not found/i);
    await journal.updateWorkflow('brand-a', 'workflow-1', 'gathering_evidence');
    expect(pg.workflows.get('workflow-1')?.state).toBe('gathering_evidence');
    expect(pg.workflows.get('workflow-1')?.brand_id).toBe('brand-a');
  });

  test('serial concurrent claims yield one new write and preserve idempotency', async () => {
    const pg = new FakePg();
    const journal = new PostgresActionJournal(pg);
    await journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Update inventory', workflowId: 'workflow-1'
    });
    const [first, second] = await Promise.all([
      journal.begin(invocation('brand-a')),
      journal.begin(invocation('brand-a'))
    ]);
    expect([first.isNew, second.isNew].sort()).toEqual([false, true]);
    await journal.finish('brand-a', 'same-key', 'confirmed', { receipt: 'provider-123' });
    const repeat = await journal.begin(invocation('brand-a'));
    expect(repeat.isNew).toBe(false);
    expect(repeat.row.status).toBe('confirmed');
    expect(JSON.parse(repeat.row.output_json ?? 'null')).toEqual({ receipt: 'provider-123' });
    expect(pg.runs.size).toBe(1);
  });

  test('same key different payload conflicts and brand scopes stay isolated', async () => {
    const pg = new FakePg();
    const journal = new PostgresActionJournal(pg);
    await journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Return parcel', workflowId: 'workflow-1'
    });
    await journal.createWorkflow({
      brandId: 'brand-b', contactId: 'contact-b', goal: 'Return parcel', workflowId: 'workflow-2'
    });
    await journal.begin(invocation('brand-a'));
    await expect(journal.begin(invocation('brand-a', 'same-key', { sku: 'SKU-13' }))).rejects.toThrow(/idempotency/i);
    expect(await journal.getRun('brand-b', 'same-key')).toBeNull();
    const other = await journal.begin({ ...invocation('brand-b'), workflowId: 'workflow-2' });
    expect(other.isNew).toBe(true);
    expect(pg.runs.size).toBe(2);
    await expect(journal.begin({ ...invocation('brand-b', 'cross-workflow'), workflowId: 'workflow-1' }))
      .rejects.toThrow(/workflow|brand/i);
    await journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Second workflow', workflowId: 'workflow-3'
    });
    await expect(journal.begin({ ...invocation('brand-a'), workflowId: 'workflow-3' }))
      .rejects.toThrow(/idempotency|workflow/i);
  });

  test('completion is idempotent, and an uncertain receipt can reconcile once', async () => {
    const pg = new FakePg();
    const journal = new PostgresActionJournal(pg);
    await journal.createWorkflow({
      brandId: 'brand-a', contactId: 'contact-a', goal: 'Reconcile payment', workflowId: 'workflow-1'
    });
    await journal.begin(invocation('brand-a'));
    await journal.finish('brand-a', 'same-key', 'uncertain');
    await journal.finish('brand-a', 'same-key', 'uncertain');
    await journal.finish('brand-a', 'same-key', 'confirmed', { transaction: 'receipt-7' });
    await journal.finish('brand-a', 'same-key', 'confirmed', { transaction: 'receipt-7' });
    await expect(journal.finish('brand-a', 'same-key', 'uncertain'))
      .rejects.toThrow(/completion|conflict/i);
    await expect(journal.finish('brand-a', 'same-key', 'confirmed', { transaction: 'forged' }))
      .rejects.toThrow(/completion|conflict/i);
    expect((await journal.getRun('brand-a', 'same-key'))?.status).toBe('confirmed');
    expect(JSON.parse((await journal.getRun('brand-a', 'same-key'))?.output_json ?? 'null'))
      .toEqual({ transaction: 'receipt-7' });
  });

  test('invalid identities and missing records fail closed, never create orphan writes', async () => {
    const pg = new FakePg();
    const journal = new PostgresActionJournal(pg);
    await expect(journal.begin(invocation('brand-a'))).rejects.toThrow(/workflow/i);
    await expect(journal.createWorkflow({ brandId: '', contactId: 'contact', goal: 'goal' })).rejects.toThrow(/brand/i);
    await expect(journal.finish('brand-a', 'missing-key', 'confirmed')).rejects.toThrow(/not found/i);
    expect(pg.runs.size).toBe(0);
    expect(pg.workflows.size).toBe(0);
  });
});

describe('PostgreSQL cutover protection', () => {
  test('defaults to SQLite, rejects unknown modes and refuses incomplete PostgreSQL cutover', () => {
    expect(resolveRuntimeDatastore({})).toEqual({ datastore: 'sqlite' });
    expect(resolveRuntimeDatastore({ DATASTORE: 'sqlite' })).toEqual({ datastore: 'sqlite' });
    expect(() => resolveRuntimeDatastore({ DATASTORE: 'mistyped' })).toThrow(/DATASTORE/i);
    expect(() => resolveRuntimeDatastore({ DATASTORE: 'postgres' })).toThrow(/not yet available|cutover/i);
    expect(() => resolveRuntimeDatastore({
      DATASTORE: 'postgres', DATABASE_URL: 'postgresql://example.invalid/project'
    })).toThrow(/not yet available|cutover/i);
  });

  test('application boot refuses postgres selection before creating SQLite data directory', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'wa-pg-cutover-'));
    const dataDir = join(tempRoot, 'should-not-exist');
    try {
      const bootstrap = `
        import { createFableWhatsAppAgent } from './src/index.ts';
        try {
          await createFableWhatsAppAgent({ dataDir: process.env.TEST_DATA_DIR!, autoConnect: false });
          process.exit(72);
        } catch (error) {
          if (!String(error).includes('PostgreSQL runtime cutover is not yet available')) {
            console.error(error);
            process.exit(73);
          }
        }
      `;
      const child = Bun.spawnSync([process.execPath, '-e', bootstrap], {
        cwd: process.cwd(),
        env: { ...process.env, DATASTORE: 'postgres', TEST_DATA_DIR: dataDir },
        stdout: 'pipe', stderr: 'pipe'
      });
      expect(child.exitCode).toBe(0);
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('inventory names S01 delivery ledger tables missing from 16-table legacy importer', () => {
    expect(POST_S01_UNMIGRATED_TABLES).toEqual([
      'send_intents', 'send_attempts', 'send_intent_events'
    ]);
  });
});
