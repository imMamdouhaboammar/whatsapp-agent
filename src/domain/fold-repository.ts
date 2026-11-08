import type { Database } from 'bun:sqlite';
import { scrubCredentials } from './learning-memory';
import type { ChatMessage, ConversationFold } from './types';

type FoldRow = {
  id: string; chat_id: string; tier: number; topic: string; summary: string;
  start_message_id: string; end_message_id: string; direct_message_ids: string;
  source_fold_ids: string; message_count: number; facts_json: string; created_at: number;
};

function asFold(row: FoldRow): ConversationFold {
  return {
    id: row.id, chatId: row.chat_id, tier: row.tier as 1 | 2, topic: row.topic,
    summary: row.summary, startMessageId: row.start_message_id, endMessageId: row.end_message_id,
    directMessageIds: JSON.parse(row.direct_message_ids) as string[],
    sourceFoldIds: JSON.parse(row.source_fold_ids) as string[],
    messageCount: row.message_count,
    factsExtracted: JSON.parse(row.facts_json) as string[],
    createdAt: row.created_at
  };
}

function readMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string, chatId: row.chat_id as string, sender: row.sender as string,
    senderName: (row.sender_name as string | null) ?? undefined, text: row.text as string,
    timestamp: row.timestamp as number, isFromMe: Boolean(row.is_from_me),
    type: row.type as ChatMessage['type'],
    replyToId: (row.reply_to_id as string | null) ?? undefined,
    quotedMessage: row.quoted_json ? JSON.parse(row.quoted_json as string) : undefined,
    reactions: row.reactions_json ? JSON.parse(row.reactions_json as string) : undefined,
    transcription: (row.transcription as string | null) ?? undefined,
    status: row.status as ChatMessage['status']
  };
}

function ensureBounds(value: string, limit: number, field: string): string {
  const cleaned = scrubCredentials(value.trim());
  if (!cleaned || cleaned.length > limit) throw new Error(`Invalid ${field}`);
  return cleaned;
}

/**
 * Durable chat-scoped fold index. Raw messages remain untouched and recoverable.
 * A tier-two fold references contiguous tier-one folds instead of rewriting them.
 */
export class FoldRepository {
  constructor(private db: Database) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversation_folds (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK (tier IN (1,2)),
        topic TEXT NOT NULL,
        summary TEXT NOT NULL,
        start_message_id TEXT NOT NULL,
        end_message_id TEXT NOT NULL,
        direct_message_ids TEXT NOT NULL,
        source_fold_ids TEXT NOT NULL,
        message_count INTEGER NOT NULL CHECK (message_count > 0),
        facts_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_folds_chat_tier ON conversation_folds(chat_id, tier, created_at);');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversation_fold_messages (
        fold_id TEXT NOT NULL REFERENCES conversation_folds(id),
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL REFERENCES messages(id),
        ordinal INTEGER NOT NULL,
        PRIMARY KEY(fold_id, message_id),
        UNIQUE(fold_id, ordinal)
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_fold_messages_chat ON conversation_fold_messages(chat_id, message_id);');
  }

  saveFold(input: ConversationFold): void {
    if (!input.id || !input.chatId || (input.tier !== 1 && input.tier !== 2)) throw new Error('Invalid fold identity');
    const ids = input.directMessageIds;
    if (!ids.length || ids.length > 512 || ids.length !== new Set(ids).size) throw new Error('Invalid fold lineage');
    if (input.startMessageId !== ids[0] || input.endMessageId !== ids.at(-1)) throw new Error('Fold boundary mismatch');
    if (input.messageCount !== ids.length) throw new Error('Fold message count mismatch');
    if (!Number.isSafeInteger(input.createdAt)) throw new Error('Invalid fold timestamp');

    this.db.transaction(() => {
      // Compare the caller-supplied lineage with the canonical chronological range.
      const matches = this.db.query(`
        SELECT id FROM messages
        WHERE chat_id = ? AND timestamp BETWEEN
          (SELECT timestamp FROM messages WHERE id = ? AND chat_id = ?)
          AND (SELECT timestamp FROM messages WHERE id = ? AND chat_id = ?)
        ORDER BY timestamp ASC, rowid ASC
      `).all(input.chatId, ids[0], input.chatId, ids.at(-1)!, input.chatId) as { id: string }[];
      if (JSON.stringify(matches.map(row => row.id)) !== JSON.stringify(ids)) {
        throw new Error('Fold lineage must be contiguous and chat-scoped');
      }
      if (input.tier === 1) {
        if (input.sourceFoldIds.length) throw new Error('Tier-one folds cannot have source folds');
        const overlapping = this.db.query(`
          SELECT 1 FROM conversation_fold_messages m
          INNER JOIN conversation_folds f ON f.id = m.fold_id
          WHERE f.tier = 1 AND m.chat_id = ? AND m.message_id IN (${ids.map(() => '?').join(',')})
          LIMIT 1
        `).get(input.chatId, ...ids);
        if (overlapping) throw new Error('Tier-one fold overlaps existing lineage');
      } else {
        if (input.sourceFoldIds.length < 2 || input.sourceFoldIds.length !== new Set(input.sourceFoldIds).size) {
          throw new Error('Tier-two fold requires distinct source folds');
        }
        const sources = input.sourceFoldIds.map(id => this.getFold(id));
        if (sources.some(source => !source || source.chatId !== input.chatId || source.tier !== 1)) {
          throw new Error('Tier-two source fold identity mismatch');
        }
        const expanded = sources.flatMap(source => source!.directMessageIds);
        if (JSON.stringify(expanded) !== JSON.stringify(ids)) throw new Error('Tier-two lineage mismatch');
        const alreadyCoalesced = this.db.query('SELECT source_fold_ids FROM conversation_folds WHERE chat_id = ? AND tier = 2').all(input.chatId) as { source_fold_ids: string }[];
        if (alreadyCoalesced.some(row => (JSON.parse(row.source_fold_ids) as string[]).some(id => input.sourceFoldIds.includes(id)))) {
          throw new Error('Source fold already coalesced');
        }
      }
      const topic = ensureBounds(input.topic, 200, 'topic');
      const summary = ensureBounds(input.summary, 8000, 'summary');
      const facts = input.factsExtracted
        .filter(fact => typeof fact === 'string')
        .map(fact => scrubCredentials(fact.trim()))
        .filter(fact => fact.length > 0 && fact.length <= 500 && !fact.includes('[REDACTED_CREDENTIAL]'))
        .slice(0, 20);
      this.db.query(`
        INSERT INTO conversation_folds
          (id, chat_id, tier, topic, summary, start_message_id, end_message_id,
           direct_message_ids, source_fold_ids, message_count, facts_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.chatId, input.tier, topic, summary,
        input.startMessageId, input.endMessageId, JSON.stringify(ids),
        JSON.stringify(input.sourceFoldIds), input.messageCount, JSON.stringify(facts), input.createdAt);
      const membership = this.db.prepare(`
        INSERT INTO conversation_fold_messages (fold_id, chat_id, message_id, ordinal)
        VALUES (?, ?, ?, ?)
      `);
      ids.forEach((id, index) => membership.run(input.id, input.chatId, id, index));
    })();
  }

  getFold(id: string): ConversationFold | undefined {
    const row = this.db.query('SELECT * FROM conversation_folds WHERE id = ?').get(id) as FoldRow | null;
    return row ? asFold(row) : undefined;
  }

  getFolds(chatId: string, tier?: 1 | 2): ConversationFold[] {
    const rows = tier
      ? this.db.query('SELECT * FROM conversation_folds WHERE chat_id = ? AND tier = ? ORDER BY created_at, rowid').all(chatId, tier)
      : this.db.query('SELECT * FROM conversation_folds WHERE chat_id = ? ORDER BY tier DESC, created_at, rowid').all(chatId);
    return (rows as FoldRow[]).map(asFold);
  }

  getRecentFolds(chatId: string, tier: 1 | 2, limit = 20): ConversationFold[] {
    const capped = Math.max(1, Math.min(100, Math.floor(limit) || 20));
    const rows = this.db.query(`
      SELECT * FROM conversation_folds WHERE chat_id = ? AND tier = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(chatId, tier, capped) as FoldRow[];
    return rows.reverse().map(asFold);
  }

  getFoldMessages(foldId: string): ChatMessage[] {
    const rows = this.db.query(`
      SELECT m.* FROM conversation_fold_messages f
      INNER JOIN messages m ON m.id = f.message_id AND m.chat_id = f.chat_id
      WHERE f.fold_id = ? ORDER BY f.ordinal LIMIT 512
    `).all(foldId) as Record<string, unknown>[];
    return rows.map(readMessage);
  }

  getMessageWindow(chatId: string, messageId: string, radius = 2): ChatMessage[] {
    const boundedRadius = Math.max(0, Math.min(10, Math.floor(radius) || 0));
    const anchor = this.db.query('SELECT timestamp, rowid FROM messages WHERE chat_id = ? AND id = ?').get(chatId, messageId) as
      | { timestamp: number; rowid: number } | null;
    if (!anchor) return [];
    const preceding = this.db.query(`
      SELECT * FROM messages WHERE chat_id = ? AND
        (timestamp < ? OR (timestamp = ? AND rowid < ?))
      ORDER BY timestamp DESC, rowid DESC LIMIT ?
    `).all(chatId, anchor.timestamp, anchor.timestamp, anchor.rowid, boundedRadius) as Record<string, unknown>[];
    const following = this.db.query(`
      SELECT * FROM messages WHERE chat_id = ? AND
        (timestamp > ? OR (timestamp = ? AND rowid >= ?))
      ORDER BY timestamp ASC, rowid ASC LIMIT ?
    `).all(chatId, anchor.timestamp, anchor.timestamp, anchor.rowid, boundedRadius + 1) as Record<string, unknown>[];
    return [...preceding.reverse(), ...following].map(readMessage);
  }

  getUnfoldedMessages(chatId: string, keepRecentCount = 10): ChatMessage[] {
    const tail = Math.max(10, Math.min(50, Math.floor(keepRecentCount) || 10));
    const rows = this.db.query(`
      SELECT m.* FROM messages m
      WHERE m.chat_id = ?
        AND m.id NOT IN (
          SELECT id FROM messages WHERE chat_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM conversation_fold_messages f
          INNER JOIN conversation_folds cf ON cf.id = f.fold_id
          WHERE f.chat_id = m.chat_id AND f.message_id = m.id AND cf.tier = 1
        )
      ORDER BY m.timestamp ASC, m.rowid ASC LIMIT 512
    `).all(chatId, chatId, tail) as Record<string, unknown>[];
    return rows.map(readMessage);
  }

  searchMemory(chatId: string, query: string, limit = 25): { messages: ChatMessage[]; folds: ConversationFold[] } {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 200) return { messages: [], folds: [] };
    const pattern = `%${trimmed.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const capped = Math.max(1, Math.min(50, Math.floor(limit) || 25));
    const messages = this.db.query(`
      SELECT * FROM messages WHERE chat_id = ? AND (text LIKE ? ESCAPE '\\' OR transcription LIKE ? ESCAPE '\\')
      ORDER BY timestamp DESC, rowid DESC LIMIT ?
    `).all(chatId, pattern, pattern, capped) as Record<string, unknown>[];
    const folds = this.db.query(`
      SELECT * FROM conversation_folds WHERE chat_id = ?
        AND (summary LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC LIMIT ?
    `).all(chatId, pattern, pattern, capped) as FoldRow[];
    return { messages: messages.map(readMessage), folds: folds.map(asFold) };
  }
}
