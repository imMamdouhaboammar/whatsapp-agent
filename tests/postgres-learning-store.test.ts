import { describe, expect, it } from 'bun:test';
import { PostgresLearningStore } from '../src/persistence/postgres/learning-store';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const TEST_DIR = './data/test-pg-learning-' + Date.now();

describe('PostgresLearningStore for Supabase PostgreSQL', () => {
  it('correctly executes saveLearningState and getLearningState against PostgreSQL client', async () => {
    const memoryTable = new Map<string, any>();

    // Mock PostgreSQL SQL client
    const mockSql = ((strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('?').replace(/\s+/g, ' ').trim();
      
      if (query.includes('INSERT INTO wa_agent.learning_states')) {
        const id = values[0];
        const _brandId = values[1];
        const _stateType = values[2];
        const content = values[3];
        const now = values[4];
        memoryTable.set(id, {
          content,
          version: (memoryTable.get(id)?.version || 0) + 1,
          updated_at: now
        });
        return Promise.resolve([]);
      }

      if (query.includes('FROM wa_agent.learning_states')) {
        const id = values[0];
        const existing = memoryTable.get(id);
        if (!existing) return Promise.resolve([]);
        return Promise.resolve([existing]);
      }

      if (query.includes('INSERT INTO wa_agent.learning_reflections')) {
        return Promise.resolve([]);
      }

      if (query.includes('INSERT INTO wa_agent.learning_feedback_events')) {
        return Promise.resolve([]);
      }

      if (query.includes('INSERT INTO wa_agent.thread_learning_status')) {
        return Promise.resolve([]);
      }

      return Promise.resolve([]);
    }) as any;

    const pgStore = new PostgresLearningStore({ sql: mockSql });

    // 1. Save state
    await pgStore.saveLearningState('brand_supabase_1', 'workbook', '# WORKBOOK: Supabase Rules\n## [Enforced Execution Rules]\n1. ALWAYS use Supabase Postgres in production');

    // 2. Retrieve state
    const retrieved = await pgStore.getLearningState('brand_supabase_1', 'workbook');
    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toContain('ALWAYS use Supabase Postgres in production');
    expect(retrieved?.version).toBe(1);

    // 3. Update state and verify version increment
    await pgStore.saveLearningState('brand_supabase_1', 'workbook', '# WORKBOOK: Updated\n## [Enforced Execution Rules]\n1. Updated rule');
    const updated = await pgStore.getLearningState('brand_supabase_1', 'workbook');
    expect(updated?.version).toBe(2);
    expect(updated?.content).toContain('Updated rule');
  });

  it('integrates seamlessly with DualMemoryManager via LearningPersistenceStore interface', async () => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

    try {
      const remoteDb = new Map<string, any>();
      const mockSql = ((strings: TemplateStringsArray, ...values: any[]) => {
        const query = strings.join('?').trim();
        if (query.includes('INSERT INTO wa_agent.learning_states')) {
          const id = values[0];
          remoteDb.set(id, { content: values[3], version: 1, updated_at: values[4] });
          return Promise.resolve([]);
        }
        if (query.includes('SELECT content, version, updated_at FROM wa_agent.learning_states')) {
          const id = values[0];
          const entry = remoteDb.get(id);
          return Promise.resolve(entry ? [entry] : []);
        }
        return Promise.resolve([]);
      }) as any;

      const pgStore = new PostgresLearningStore({ sql: mockSql });

      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistenceStore: pgStore,
        persistSqlite: false,
        brandId: 'brand_cloud_9'
      });

      memoryManager.addEnforcedRule('NEVER bypass Supabase PostgreSQL in production');

      // Allow background microtask to complete
      await new Promise(r => setTimeout(r, 10));

      const remoteState = remoteDb.get('brand_cloud_9:workbook');
      expect(remoteState).toBeDefined();
      expect(remoteState.content).toContain('NEVER bypass Supabase PostgreSQL in production');
    } finally {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    }
  });
});
