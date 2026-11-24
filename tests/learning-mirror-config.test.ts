import { describe, expect, it } from 'bun:test';
import { resolveLearningMirror } from '../src/persistence/learning-mirror-config';
import { resolveRuntimeDatastore } from '../src/persistence/postgres/runtime-selection';

describe('WA-009 explicit learning-store ownership', () => {
  it('defaults to SQLite-only when no DATABASE_URL is present', () => {
    const result = resolveLearningMirror({});
    expect(result.mode).toBe('off');
    expect(result.reason).toBe('no_database_url');
  });

  it('activates the Postgres mirror explicitly when DATABASE_URL is present', () => {
    const result = resolveLearningMirror({ DATABASE_URL: 'postgres://localhost:5432/db' });
    expect(result.mode).toBe('mirror');
    expect(result.databaseUrl).toBe('postgres://localhost:5432/db');
  });

  it('DATABASE_TRANSACTION_URL alone does not activate the learning mirror', () => {
    const result = resolveLearningMirror({ DATABASE_TRANSACTION_URL: 'postgres://localhost:5432/db' });
    expect(result.mode).toBe('off');
    expect(result.reason).toBe('no_database_url');
  });

  it('honors an explicit opt-out even when DATABASE_URL is present', () => {
    for (const value of ['0', 'false', 'off']) {
      const result = resolveLearningMirror({ DATABASE_URL: 'postgres://x', LEARNING_REMOTE_MIRROR: value });
      expect(result.mode).toBe('off');
      expect(result.reason).toBe('disabled_by_config');
    }
  });

  it('a full Postgres runtime remains rejected outright', () => {
    expect(() => resolveRuntimeDatastore({ DATASTORE: 'postgres', DATABASE_URL: 'postgres://x' })).toThrow();
    expect(resolveRuntimeDatastore({ DATASTORE: 'sqlite' }).datastore).toBe('sqlite');
    expect(resolveRuntimeDatastore({}).datastore).toBe('sqlite');
  });
});
