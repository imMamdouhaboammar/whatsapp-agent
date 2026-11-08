/**
 * Existing runtime stores are synchronous SQLite. Enabling PostgreSQL before
 * all writers (including S01 delivery) are migrated could split one business
 * operation across two active databases, so fail before creating either one.
 */
export const POST_S01_UNMIGRATED_TABLES = Object.freeze([
  'send_intents', 'send_attempts', 'send_intent_events'
] as const);

export function resolveRuntimeDatastore(
  environment: { DATASTORE?: string; DATABASE_URL?: string } = {
    DATASTORE: process.env.DATASTORE,
    DATABASE_URL: process.env.DATABASE_URL
  }
): { datastore: 'sqlite' } {
  const selected = (environment.DATASTORE ?? 'sqlite').trim().toLowerCase();
  if (!selected || selected === 'sqlite') return { datastore: 'sqlite' };
  if (selected === 'postgres') {
    throw new Error(
      'PostgreSQL runtime cutover is not yet available: async parity for chat, ' +
      'S01 delivery, follow-ups, knowledge and connected writers is incomplete'
    );
  }
  throw new Error('Unsupported DATASTORE value');
}
