import { isRecord } from './sqlite-values';
import type { Database } from 'bun:sqlite';
import { scrubCredentials } from './learning-memory';
import type { ChatMessage, ConversationFold } from './types';



function readStringArray(raw: unknown, field: string): string[] {
  if (typeof raw !== 'string') throw new Error(`Invalid ${field}`);
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function asFold(row: unknown): ConversationFold {
  if (!isRecord(row)) throw new Error('Invalid conversation fold row');
  const { id, chat_id, tier, topic, summary, start_message_id, end_message_id,
    direct_message_ids, source_fold_ids, message_count, facts_json, created_at } = row;
  if (typeof id !== 'string' || typeof chat_id !== 'string' ||
      (tier !== 1 && tier !== 2 && tier !== 3) || typeof topic !== 'string' ||
      typeof summary !== 'string' || typeof start_message_id !== 'string' ||
      typeof end_message_id !== 'string' || typeof message_count !== 'number' ||
      typeof created_at !== 'number') throw new Error('Invalid conversation fold row');
  return {
    id, chatId: chat_id, tier, topic, summary, startMessageId: start_message_id,
    endMessageId: end_message_id, directMessageIds: readStringArray(direct_message_ids, 'direct_message_ids'),
    sourceFoldIds: readStringArray(source_fold_ids, 'source_fold_ids'), messageCount: message_count,
    factsExtracted: readStringArray(facts_json, 'facts_json'), createdAt: created_at
  };
}

const isQuote = (value: unknown): value is NonNullable<ChatMessage['quotedMessage']> => {
  return isRecord(value) && typeof value.id === 'string' && typeof value.sender === 'string' &&
    typeof value.text === 'string' && (value.senderName === undefined || typeof value.senderName === 'string') &&
    (value.type === undefined || typeof value.type === 'string');
};

function readQuote(raw: string): NonNullable<ChatMessage['quotedMessage']> {
  const value: unknown = JSON.parse(raw);
  if (!isQuote(value)) throw new Error('Invalid quoted_json');
  return value;
}

function readMessage(row: unknown): ChatMessage {
  if (!isRecord(row)) throw new Error('Invalid fold message row');
  const { id, chat_id, sender, sender_name, text, timestamp, is_from_me, type,
    reply_to_id, quoted_json, reactions_json, transcription, status } = row;
  if (typeof id !== 'string' || typeof chat_id !== 'string' || typeof sender !== 'string' ||
      typeof text !== 'string' || typeof timestamp !== 'number' || typeof is_from_me !== 'number' ||
      (type !== 'text' && type !== 'audio' && type !== 'image' && type !== 'video' &&
        type !== 'document' && type !== 'other') ||
      (status !== null && status !== 'pending' && status !== 'sent' && status !== 'delivered' && status !== 'read') ||
      (sender_name !== null && typeof sender_name !== 'string') ||
      (reply_to_id !== null && typeof reply_to_id !== 'string') ||
      (quoted_json !== null && typeof quoted_json !== 'string') ||
      (reactions_json !== null && typeof reactions_json !== 'string') ||
      (transcription !== null && typeof transcription !== 'string')) throw new Error('Invalid fold message row');
  return {
    id, chatId: chat_id, sender, senderName: sender_name ?? undefined, text, timestamp,
    isFromMe: Boolean(is_from_me), type, replyToId: reply_to_id ?? undefined,
    quotedMessage: quoted_json ? readQuote(quoted_json) : undefined,
    reactions: reactions_json ? readStringArray(reactions_json, 'reactions_json') : undefined,
    transcription: transcription ?? undefined, status: status ?? undefined
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
        tier INTEGER NOT NULL CHECK (tier IN (1,2,3)),
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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversation_fold_sources (
        tier_two_fold_id TEXT NOT NULL REFERENCES conversation_folds(id),
        source_fold_id TEXT NOT NULL UNIQUE REFERENCES conversation_folds(id),
        PRIMARY KEY(tier_two_fold_id, source_fold_id)
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_fold_source_lookup ON conversation_fold_sources(source_fold_id);');
  }

  saveFold(input: ConversationFold): void {
    if (!input.id || !input.chatId || (input.tier !== 1 && input.tier !== 2 && input.tier !== 3)) throw new Error('Invalid fold identity');
    const ids = input.directMessageIds;
    if (!ids.length || ids.length > 512 || ids.length !== new Set(ids).size) throw new Error('Invalid fold lineage');
    if (input.startMessageId !== ids[0] || input.endMessageId !== ids.at(-1)) throw new Error('Fold boundary mismatch');
    if (input.messageCount !== ids.length) throw new Error('Fold message count mismatch');
    if (!Number.isSafeInteger(input.createdAt)) throw new Error('Invalid fold timestamp');

    this.db.transaction(() => {
      const firstId = ids[0];
      const lastId = ids[ids.length - 1];
      if (!firstId || !lastId) {
        throw new Error('Fold lineage cannot be empty');
      }
      // Compare the caller-supplied lineage with the canonical chronological range.
      const matches = this.db.query(`
        SELECT id FROM messages
        WHERE chat_id = ? AND timestamp BETWEEN
          (SELECT timestamp FROM messages WHERE id = ? AND chat_id = ?)
          AND (SELECT timestamp FROM messages WHERE id = ? AND chat_id = ?)
        ORDER BY timestamp ASC, rowid ASC
      `).all(input.chatId, firstId, input.chatId, lastId, input.chatId);
      if (JSON.stringify(matches.map(row => isRecord(row) ? row.id : undefined)) !== JSON.stringify(ids)) {
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
      } else if (input.tier === 2) {
        if (input.sourceFoldIds.length < 2 || input.sourceFoldIds.length !== new Set(input.sourceFoldIds).size) {
          throw new Error('Tier-two fold requires distinct source folds');
        }
        const sources = input.sourceFoldIds.map(id => this.getFold(id));
        const validSources = sources.filter((source): source is ConversationFold => Boolean(source && source.chatId === input.chatId && source.tier === 1));
        if (validSources.length !== sources.length) {
          throw new Error('Tier-two source fold identity mismatch');
        }
        const expanded = validSources.flatMap(source => source.directMessageIds);
        if (JSON.stringify(expanded) !== JSON.stringify(ids)) throw new Error('Tier-two lineage mismatch');
        const alreadyCoalesced = this.db.query(`
          SELECT 1 FROM conversation_fold_sources
          WHERE source_fold_id IN (${input.sourceFoldIds.map(() => '?').join(',')}) LIMIT 1
        `).get(...input.sourceFoldIds);
        if (alreadyCoalesced) throw new Error('Source fold already coalesced');
      } else if (input.tier === 3) {
        if (input.sourceFoldIds.length < 2 || input.sourceFoldIds.length !== new Set(input.sourceFoldIds).size) {
          throw new Error('Tier-three fold requires distinct source folds');
        }
        const sources = input.sourceFoldIds.map(id => this.getFold(id));
        const validSources = sources.filter((source): source is ConversationFold => Boolean(source && source.chatId === input.chatId && source.tier === 2));
        if (validSources.length !== sources.length) {
          throw new Error('Tier-three source fold identity mismatch');
        }
        const expanded = validSources.flatMap(source => source.directMessageIds);
        if (JSON.stringify(expanded) !== JSON.stringify(ids)) throw new Error('Tier-three lineage mismatch');
        const alreadyCoalesced = this.db.query(`
          SELECT 1 FROM conversation_fold_sources
          WHERE source_fold_id IN (${input.sourceFoldIds.map(() => '?').join(',')}) LIMIT 1
        `).get(...input.sourceFoldIds);
        if (alreadyCoalesced) throw new Error('Source fold already coalesced');
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
      if (input.tier === 2 || input.tier === 3) {
        const relation = this.db.prepare(`
          INSERT INTO conversation_fold_sources (tier_two_fold_id, source_fold_id) VALUES (?, ?)
        `);
        input.sourceFoldIds.forEach(id => relation.run(input.id, id));
      }
    })();
  }

  getFold(id: string): ConversationFold | undefined {
    const row = this.db.query('SELECT * FROM conversation_folds WHERE id = ? LIMIT 1').get(id);
    return row ? asFold(row) : undefined;
  }

  getFolds(chatId: string, tier?: 1 | 2 | 3, limit = 500): ConversationFold[] {
    const capped = Math.max(1, Math.min(500, Math.floor(limit) || 500));
    const rows = tier
      ? this.db.query(`SELECT * FROM conversation_folds WHERE chat_id = ? AND tier = ?
          ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(chatId, tier, capped)
      : this.db.query(`SELECT * FROM conversation_folds WHERE chat_id = ?
          ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(chatId, capped);
    return rows.toReversed().map(asFold);
  }

  getPendingTier1Folds(chatId: string, limit = 5): ConversationFold[] {
    const capped = Math.max(2, Math.min(10, Math.floor(limit) || 5));
    const rows = this.db.query(`
      SELECT f.* FROM conversation_folds f
      WHERE f.chat_id = ? AND f.tier = 1
        AND NOT EXISTS (
          SELECT 1 FROM conversation_fold_sources s WHERE s.source_fold_id = f.id
        )
      ORDER BY f.created_at ASC, f.rowid ASC LIMIT ?
    `).all(chatId, capped);
    return rows.map(asFold);
  }

  getPendingTier2Folds(chatId: string, limit = 5): ConversationFold[] {
    const capped = Math.max(2, Math.min(10, Math.floor(limit) || 5));
    const rows = this.db.query(`
      SELECT f.* FROM conversation_folds f
      WHERE f.chat_id = ? AND f.tier = 2
        AND NOT EXISTS (
          SELECT 1 FROM conversation_fold_sources s WHERE s.source_fold_id = f.id
        )
      ORDER BY f.created_at ASC, f.rowid ASC LIMIT ?
    `).all(chatId, capped);
    return rows.map(asFold);
  }

  getRecentFolds(chatId: string, tier: 1 | 2 | 3, limit = 20): ConversationFold[] {
    const capped = Math.max(1, Math.min(100, Math.floor(limit) || 20));
    const rows = this.db.query(`
      SELECT * FROM conversation_folds WHERE chat_id = ? AND tier = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(chatId, tier, capped);
    return rows.toReversed().map(asFold);
  }

  getFoldMessages(foldId: string): ChatMessage[] {
    const rows = this.db.query(`
      SELECT m.* FROM conversation_fold_messages f
      INNER JOIN messages m ON m.id = f.message_id AND m.chat_id = f.chat_id
      WHERE f.fold_id = ? ORDER BY f.ordinal LIMIT 512
    `).all(foldId);
    return rows.map(readMessage);
  }

  getMessageWindow(chatId: string, messageId: string, radius = 2): ChatMessage[] {
    const boundedRadius = Math.max(0, Math.min(10, Math.floor(radius) || 0));
    const anchor = this.db.query('SELECT timestamp, rowid FROM messages WHERE chat_id = ? AND id = ? LIMIT 1').get(chatId, messageId);
    if (!anchor) return [];
    if (!isRecord(anchor) || typeof anchor.timestamp !== 'number' || typeof anchor.rowid !== 'number') {
      throw new Error('Invalid fold message anchor');
    }
    const preceding = this.db.query(`
      SELECT * FROM messages WHERE chat_id = ? AND
        (timestamp < ? OR (timestamp = ? AND rowid < ?))
      ORDER BY timestamp DESC, rowid DESC LIMIT ?
    `).all(chatId, anchor.timestamp, anchor.timestamp, anchor.rowid, boundedRadius);
    const following = this.db.query(`
      SELECT * FROM messages WHERE chat_id = ? AND
        (timestamp > ? OR (timestamp = ? AND rowid >= ?))
      ORDER BY timestamp ASC, rowid ASC LIMIT ?
    `).all(chatId, anchor.timestamp, anchor.timestamp, anchor.rowid, boundedRadius + 1);
    return [...preceding.toReversed(), ...following].map(readMessage);
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
    `).all(chatId, chatId, tail);
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
    `).all(chatId, pattern, pattern, capped);
    const folds = this.db.query(`
      SELECT * FROM conversation_folds WHERE chat_id = ?
        AND (summary LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC LIMIT ?
    `).all(chatId, pattern, pattern, capped);
    return { messages: messages.map(readMessage), folds: folds.map(asFold) };
  }
}
