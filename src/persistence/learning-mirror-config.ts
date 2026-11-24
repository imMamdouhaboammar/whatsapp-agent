/**
 * WA-009: explicit ownership for learning-state storage.
 *
 * Ownership rules (docs/persistence-ownership.md):
 * - SQLite (MemoryStore + workbook/notebook files) is the authoritative store for every
 *   runtime domain, including learning memory.
 * - PostgreSQL is an OPTIONAL, explicitly activated async mirror of the learning state only
 *   (serialized, revision-guarded by DualMemoryManager). It is never authoritative.
 * - A full Postgres runtime cutover (DATASTORE=postgres) stays rejected until the S01
 *   migration lands (see runtime-selection.ts).
 *
 * This module makes the mirror's activation explicit and inspectable instead of letting
 * DATABASE_URL silently switch behavior.
 */
export interface LearningMirrorResolution {
  mode: 'off' | 'mirror';
  reason: 'no_database_url' | 'disabled_by_config' | 'enabled';
  databaseUrl?: string;
}

export function resolveLearningMirror(
  environment: { DATABASE_URL?: string; LEARNING_REMOTE_MIRROR?: string; DATABASE_TRANSACTION_URL?: string } = {
    DATABASE_URL: process.env.DATABASE_URL,
    LEARNING_REMOTE_MIRROR: process.env.LEARNING_REMOTE_MIRROR
  }
): LearningMirrorResolution {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) return { mode: 'off', reason: 'no_database_url' };
  const flag = environment.LEARNING_REMOTE_MIRROR?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') {
    return { mode: 'off', reason: 'disabled_by_config' };
  }
  return { mode: 'mirror', reason: 'enabled', databaseUrl };
}
