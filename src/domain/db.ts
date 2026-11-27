import { isRecord } from './sqlite-values';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { SendLedger } from './send-ledger';
import { FoldRepository } from './fold-repository';
import { InboundJobLedger, type InboundJob } from './inbound-job-ledger';
import { BroadcastStore } from './broadcast-store';
import { scrubCredentials } from './learning-memory';
import type {
  AgentDraft,
  AgentMode,
  ChatMessage,
  ChatSummary,
  ContactDossier,
  ContactStage
} from './types';

const STATUS_RANK: Record<NonNullable<ChatMessage['status']>, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3
};

function advancedStatus(current: ChatMessage['status'], next: ChatMessage['status']): ChatMessage['status'] {
  if (!current) return next;
  if (!next) return current;
  return STATUS_RANK[current] >= STATUS_RANK[next] ? current : next;
}



function sqliteRow(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new TypeError('Invalid SQLite row');
}

const invalidColumn = (column: string): never => {
  throw new TypeError(`Invalid SQLite column: ${column}`);
};

function textColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value : invalidColumn(column);
}

const numberColumn = (row: Record<string, unknown>, column: string): number => {
  const value = row[column];
  return typeof value === 'number' && Number.isFinite(value) ? value : invalidColumn(column);
};

function optionalText(row: Record<string, unknown>, column: string): string | undefined {
  return row[column] === null ? undefined : textColumn(row, column);
}

function optionalNumber(row: Record<string, unknown>, column: string): number | undefined {
  return row[column] === null ? undefined : numberColumn(row, column);
}

function enumColumn<T extends string>(row: Record<string, unknown>, column: string, ...allowed: T[]): T {
  return allowed.find((value) => value === row[column]) ?? invalidColumn(column);
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item: unknown): item is string => typeof item === 'string')
    ? value
    : undefined;
}

function isQuotedMessage(value: unknown): value is NonNullable<ChatMessage['quotedMessage']> {
  if (!isRecord(value)) return false;
  const { id, sender, senderName, text, type } = value;
  return typeof id === 'string' && typeof sender === 'string' && typeof text === 'string'
    && (senderName === undefined || typeof senderName === 'string')
    && (type === undefined || typeof type === 'string');
}

function isPendingToolCall(value: unknown): value is NonNullable<AgentDraft['toolCall']> {
  if (!isRecord(value)) return false;
  const { namespacedName, serverName, toolName, args, risk, reason, proposedFollowUp } = value;
  return typeof namespacedName === 'string' && typeof serverName === 'string' && typeof toolName === 'string'
    && isRecord(args) && (risk === 'readOnly' || risk === 'mutating')
    && (reason === undefined || typeof reason === 'string')
    && (proposedFollowUp === undefined || typeof proposedFollowUp === 'string');
}

function decodeLegacyChat(value: unknown): ChatSummary | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string') return undefined;
  const { unreadCount, lastTimestamp, isGroup, agentMode, phoneNumber, lastMessage, avatarUrl } = value;
  if (unreadCount !== null && unreadCount !== undefined && (typeof unreadCount !== 'number' || !Number.isSafeInteger(unreadCount) || unreadCount < 0)) return undefined;
  if (lastTimestamp !== null && lastTimestamp !== undefined && (typeof lastTimestamp !== 'number' || !Number.isFinite(lastTimestamp))) return undefined;
  if (isGroup !== null && isGroup !== undefined && typeof isGroup !== 'boolean') return undefined;
  if (agentMode !== null && agentMode !== undefined && agentMode !== 'autopilot' && agentMode !== 'copilot' && agentMode !== 'human') return undefined;
  if (phoneNumber !== null && phoneNumber !== undefined && typeof phoneNumber !== 'string') return undefined;
  if (lastMessage !== null && lastMessage !== undefined && typeof lastMessage !== 'string') return undefined;
  if (avatarUrl !== null && avatarUrl !== undefined && typeof avatarUrl !== 'string') return undefined;
  return {
    id: value.id,
    name: value.name,
    unreadCount: unreadCount ?? 0,
    lastTimestamp: lastTimestamp ?? undefined,
    isGroup: isGroup ?? false,
    agentMode: agentMode ?? 'autopilot',
    phoneNumber: phoneNumber ?? undefined,
    lastMessage: lastMessage ?? undefined,
    avatarUrl: avatarUrl ?? undefined
  };
}

function decodeChat(value: unknown): ChatSummary {
  const row = sqliteRow(value);
  return {
    id: textColumn(row, 'id'),
    name: textColumn(row, 'name'),
    phoneNumber: optionalText(row, 'phone_number'),
    unreadCount: optionalNumber(row, 'unread_count') ?? 0,
    lastMessage: optionalText(row, 'last_message'),
    lastTimestamp: optionalNumber(row, 'last_timestamp'),
    isGroup: Boolean(optionalNumber(row, 'is_group')),
    agentMode: row.agent_mode === null ? 'autopilot' : enumColumn(row, 'agent_mode', 'autopilot', 'copilot', 'human'),
    avatarUrl: optionalText(row, 'avatar_url')
  };
}

function decodeMessage(value: unknown): ChatMessage {
  const row = sqliteRow(value);
  const quote = parseJson(optionalText(row, 'quoted_json'));
  return {
    id: textColumn(row, 'id'),
    chatId: textColumn(row, 'chat_id'),
    sender: textColumn(row, 'sender'),
    senderName: optionalText(row, 'sender_name'),
    text: textColumn(row, 'text'),
    timestamp: numberColumn(row, 'timestamp'),
    isFromMe: Boolean(numberColumn(row, 'is_from_me')),
    type: row.type === null ? 'text' : enumColumn(row, 'type', 'text', 'audio', 'image', 'video', 'document', 'other'),
    replyToId: optionalText(row, 'reply_to_id'),
    quotedMessage: isQuotedMessage(quote) ? quote : undefined,
    reactions: stringArray(parseJson(optionalText(row, 'reactions_json'))),
    transcription: optionalText(row, 'transcription'),
    status: row.status === null ? undefined : enumColumn(row, 'status', 'pending', 'sent', 'delivered', 'read')
  };
}

function decodeDraft(value: unknown): AgentDraft {
  const row = sqliteRow(value);
  const toolCall = parseJson(optionalText(row, 'tool_call'));
  return {
    id: textColumn(row, 'id'),
    chatId: textColumn(row, 'chat_id'),
    incomingMessageId: textColumn(row, 'incoming_message_id'),
    incomingText: textColumn(row, 'incoming_text'),
    proposedReply: textColumn(row, 'proposed_reply'),
    reasoning: textColumn(row, 'reasoning'),
    confidence: numberColumn(row, 'confidence'),
    status: enumColumn(row, 'status', 'pending', 'approved', 'rejected', 'sent'),
    createdAt: numberColumn(row, 'created_at'),
    toolCall: isPendingToolCall(toolCall) ? toolCall : undefined
  };
}

function decodeReflection(value: unknown) {
  const row = sqliteRow(value);
  return {
    id: textColumn(row, 'id'),
    brand_id: textColumn(row, 'brand_id'),
    chat_id: textColumn(row, 'chat_id'),
    trigger_reason: textColumn(row, 'trigger_reason'),
    input_message_count: numberColumn(row, 'input_message_count'),
    self_corrections_count: optionalNumber(row, 'self_corrections_count') ?? 0,
    rules_added: optionalNumber(row, 'rules_added') ?? 0,
    facts_added: optionalNumber(row, 'facts_added') ?? 0,
    summary: optionalText(row, 'summary') ?? null,
    created_at: numberColumn(row, 'created_at')
  };
}

export interface SqliteStoreOptions {
  dbPath?: string;
  legacyDataDir?: string;
  brandId?: string;
}

export class SqliteStore {
  private db: Database;
  private dbPath: string;
  private sendLedger: SendLedger;
  private inboundJobLedger: InboundJobLedger;
  private foldRepository: FoldRepository;
  private broadcastStore: BroadcastStore;
  private pendingStatuses = new Map<string, NonNullable<ChatMessage['status']>>();

  constructor(options: SqliteStoreOptions = {}) {
    this.dbPath = options.dbPath ?? './data/fable_whatsapp.db';
    if (this.dbPath !== ':memory:') {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(this.dbPath);
    this.init();
    this.sendLedger = new SendLedger(this.db);
    this.inboundJobLedger = new InboundJobLedger(this.db);
    this.foldRepository = new FoldRepository(this.db);
    this.broadcastStore = new BroadcastStore(this.db, options.brandId);

    if (options.legacyDataDir) {
      this.importLegacyJson(options.legacyDataDir);
    }
  }

  private init() {
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    this.db.run('PRAGMA busy_timeout = 5000;');
    this.db.run('PRAGMA temp_store = MEMORY;');
    this.db.run('PRAGMA cache_size = -16000;');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone_number TEXT,
        unread_count INTEGER DEFAULT 0,
        last_message TEXT,
        last_timestamp INTEGER,
        is_group INTEGER DEFAULT 0,
        agent_mode TEXT DEFAULT 'autopilot',
        avatar_url TEXT
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_chats_last_timestamp ON chats(last_timestamp DESC);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_chats_last_timestamp_coalesce ON chats(COALESCE(last_timestamp, 0) DESC);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        sender_name TEXT,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        is_from_me INTEGER NOT NULL,
        type TEXT DEFAULT 'text',
        reply_to_id TEXT,
        quoted_json TEXT,
        reactions_json TEXT,
        transcription TEXT,
        status TEXT DEFAULT 'sent'
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, timestamp);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS contact_dossiers (
        chat_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        stage TEXT DEFAULT 'lead',
        facts_json TEXT DEFAULT '[]',
        commitments_json TEXT DEFAULT '[]',
        preferred_tone TEXT,
        notes TEXT,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        incoming_message_id TEXT NOT NULL,
        incoming_text TEXT NOT NULL,
        proposed_reply TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        tool_call TEXT
      );
    `);
    try {
      this.db.run(`ALTER TABLE drafts ADD COLUMN tool_call TEXT;`);
    } catch {
      // Column already exists on upgraded databases.
    }
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_drafts_pending ON drafts(status, created_at DESC);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_drafts_chat_status ON drafts(chat_id, status, created_at DESC);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS contact_memories (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        jid TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_contact_memories_jid ON contact_memories(brand_id, jid);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS learning_states (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        state_type TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_learning_states_brand ON learning_states(brand_id, state_type);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS learning_reflections (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        trigger_reason TEXT NOT NULL,
        input_message_count INTEGER NOT NULL,
        self_corrections_count INTEGER DEFAULT 0,
        rules_added INTEGER DEFAULT 0,
        facts_added INTEGER DEFAULT 0,
        summary TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_learning_reflections_chat ON learning_reflections(chat_id, created_at);`);
  }

  private countRows(sql: string): number {
    const row = this.db.query(sql).get();
    return row === null ? 0 : numberColumn(sqliteRow(row), 'c');
  }

  /**
   * Imports legacy JSON files if they exist and DB is empty
   */
  private importLegacyJson(dir: string) {
    try {
      const chatsCount = this.countRows('SELECT COUNT(*) AS c FROM chats;');
      if (chatsCount === 0) {
        try {
          const raw: unknown = JSON.parse(readFileSync(`${dir}/chats.json`, 'utf-8'));
          if (Array.isArray(raw)) {
            for (const item of raw) {
              const chat = decodeLegacyChat(item);
              if (chat) this.saveChat(chat);
              else console.warn('[SQLite] Skipped malformed legacy chat record');
            }
          }
        } catch {
          // File missing or unparseable
        }
      }

      const msgsCount = this.countRows('SELECT COUNT(*) AS c FROM messages;');
      if (msgsCount === 0) {
        try {
          const raw = JSON.parse(readFileSync(`${dir}/messages.json`, 'utf-8'));
          if (typeof raw === 'object' && raw !== null) {
            for (const msgs of Object.values(raw)) {
              if (Array.isArray(msgs)) {
                for (const m of msgs) {
                  this.saveMessage(m);
                }
              }
            }
          }
        } catch {
          // File missing or unparseable
        }
      }
    } catch {
      // Non-fatal legacy migration
    }
  }

  // --- Chats ---
  saveChat(chat: ChatSummary) {
    const stmt = this.db.prepare(`
      INSERT INTO chats (id, name, phone_number, unread_count, last_message, last_timestamp, is_group, agent_mode, avatar_url)
      VALUES ($id, $name, $phone_number, $unread_count, $last_message, $last_timestamp, $is_group, $agent_mode, $avatar_url)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        phone_number = COALESCE(excluded.phone_number, chats.phone_number),
        unread_count = excluded.unread_count,
        last_message = excluded.last_message,
        last_timestamp = excluded.last_timestamp,
        is_group = excluded.is_group,
        agent_mode = excluded.agent_mode,
        avatar_url = excluded.avatar_url;
    `);

    stmt.run({
      $id: chat.id,
      $name: chat.name,
      $phone_number: chat.phoneNumber ?? null,
      $unread_count: chat.unreadCount ?? 0,
      $last_message: chat.lastMessage ?? null,
      $last_timestamp: chat.lastTimestamp ?? null,
      $is_group: chat.isGroup ? 1 : 0,
      $agent_mode: chat.agentMode ?? 'autopilot',
      $avatar_url: chat.avatarUrl ?? null
    });
  }

  getChat(id: string): ChatSummary | undefined {
    const row = this.db.query('SELECT * FROM chats WHERE id = ? LIMIT 1;').get(id);
    return row === null ? undefined : decodeChat(row);
  }

  listChats(): ChatSummary[] {
    return this.db.query('SELECT * FROM chats ORDER BY COALESCE(last_timestamp, 0) DESC;').all().map(decodeChat);
  }

  setChatMode(id: string, mode: AgentMode) {
    this.db.run(`
      INSERT INTO chats (id, name, unread_count, is_group, agent_mode)
      VALUES (?, ?, 0, 0, ?)
      ON CONFLICT(id) DO UPDATE SET agent_mode = excluded.agent_mode;
    `, [id, id.split('@')[0] ?? id, mode]);
  }

  markChatRead(id: string) {
    this.db.run('UPDATE chats SET unread_count = 0 WHERE id = ?;', [id]);
  }

  // --- Messages ---
  saveMessage(msg: ChatMessage) {
    if (!msg.text?.trim() && msg.type === 'text') return;
    if (msg.text === '[رسالة]') return;

    const pendingKey = `${msg.chatId}::${msg.id}`;
    const previous = msg.isFromMe ? this.getMessage(msg.chatId, msg.id)?.status : undefined;
    const buffered = this.pendingStatuses.get(pendingKey);
    const messageStatus = msg.isFromMe
      ? advancedStatus(advancedStatus(previous, msg.status ?? 'sent'), buffered)
      : (msg.status ?? 'delivered');
    this.pendingStatuses.delete(pendingKey);

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, chat_id, sender, sender_name, text, timestamp, is_from_me,
        type, reply_to_id, quoted_json, reactions_json, transcription, status
      ) VALUES (
        $id, $chat_id, $sender, $sender_name, $text, $timestamp, $is_from_me,
        $type, $reply_to_id, $quoted_json, $reactions_json, $transcription, $status
      )
      ON CONFLICT(id) DO UPDATE SET
        reactions_json = excluded.reactions_json,
        status = excluded.status,
        transcription = COALESCE(excluded.transcription, messages.transcription);
    `);

    stmt.run({
      $id: msg.id,
      $chat_id: msg.chatId,
      $sender: msg.sender,
      $sender_name: msg.senderName ?? null,
      $text: msg.text,
      $timestamp: msg.timestamp,
      $is_from_me: msg.isFromMe ? 1 : 0,
      $type: msg.type ?? 'text',
      $reply_to_id: msg.replyToId ?? null,
      $quoted_json: msg.quotedMessage ? JSON.stringify(msg.quotedMessage) : null,
      $reactions_json: msg.reactions && msg.reactions.length > 0 ? JSON.stringify(msg.reactions) : null,
      $transcription: msg.transcription ?? null,
      $status: messageStatus ?? null
    });

    // Automatically update or create chat summary
    const phoneCandidate = msg.chatId.split('@')[0] ?? '';
    const formattedPhone = /^\d+$/.test(phoneCandidate) ? `+${phoneCandidate}` : undefined;
    const existing = this.getChat(msg.chatId);

    const chatName = (!msg.isFromMe && msg.senderName)
      ? msg.senderName
      : (existing?.name || formattedPhone || msg.chatId);

    const unread = (!msg.isFromMe ? (existing?.unreadCount ?? 0) + 1 : 0);

    this.saveChat({
      id: msg.chatId,
      name: chatName,
      phoneNumber: formattedPhone || existing?.phoneNumber,
      unreadCount: unread,
      isGroup: msg.chatId.endsWith('@g.us'),
      agentMode: existing?.agentMode ?? 'autopilot',
      lastMessage: msg.text || (msg.type === 'audio' ? '🎵 [رسالة صوتية]' : `[${msg.type}]`),
      lastTimestamp: msg.timestamp
    });
  }

  updateMessageStatus(chatId: string, messageId: string, status: NonNullable<ChatMessage['status']>): ChatMessage['status'] | undefined {
    const existing = this.getMessage(chatId, messageId);
    if (!existing) {
      const key = `${chatId}::${messageId}`;
      const pending = advancedStatus(this.pendingStatuses.get(key), status);
      if (pending) this.pendingStatuses.set(key, pending);
      if (this.pendingStatuses.size > 256) {
        const oldest = this.pendingStatuses.keys().next().value;
        if (oldest) this.pendingStatuses.delete(oldest);
      }
      return undefined;
    }
    if (!existing.isFromMe) return undefined;
    const next = advancedStatus(existing.status, status);
    if (!next || next === existing.status) return undefined;
    this.db.run('UPDATE messages SET status = ? WHERE chat_id = ? AND id = ? AND is_from_me = 1;', [next, chatId, messageId]);
    return next;
  }

  getMessages(chatId: string, limit = 50): ChatMessage[] {
    const rows = this.db.query(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?;'
    ).all(chatId, limit);
    return rows.toReversed().map(decodeMessage);
  }

  getMessage(chatId: string, messageId: string): ChatMessage | undefined {
    const row = this.db.query('SELECT * FROM messages WHERE chat_id = ? AND id = ?;').get(chatId, messageId);
    return row === null ? undefined : decodeMessage(row);
  }

  addReaction(chatId: string, messageId: string, emoji: string) {
    const msg = this.getMessage(chatId, messageId);
    if (!msg) return;

    let updatedReactions: string[] = [];
    if (emoji) {
      const current = msg.reactions || [];
      if (!current.includes(emoji)) {
        updatedReactions = [...current, emoji];
      } else {
        updatedReactions = current;
      }
    }

    this.db.run(
      'UPDATE messages SET reactions_json = ? WHERE id = ?;',
      [updatedReactions.length > 0 ? JSON.stringify(updatedReactions) : null, messageId]
    );
  }

  // --- Contact Dossier (Entity Memory) ---
  saveDossier(dossier: ContactDossier) {
    const stmt = this.db.prepare(`
      INSERT INTO contact_dossiers (chat_id, name, phone, stage, facts_json, commitments_json, preferred_tone, notes, updated_at)
      VALUES ($chat_id, $name, $phone, $stage, $facts_json, $commitments_json, $preferred_tone, $notes, $updated_at)
      ON CONFLICT(chat_id) DO UPDATE SET
        name = excluded.name,
        phone = COALESCE(excluded.phone, contact_dossiers.phone),
        stage = excluded.stage,
        facts_json = excluded.facts_json,
        commitments_json = excluded.commitments_json,
        preferred_tone = excluded.preferred_tone,
        notes = excluded.notes,
        updated_at = excluded.updated_at;
    `);

    stmt.run({
      $chat_id: dossier.chatId,
      $name: dossier.name,
      $phone: dossier.phone ?? null,
      $stage: dossier.stage ?? 'lead',
      $facts_json: JSON.stringify(dossier.facts ?? []),
      $commitments_json: JSON.stringify(dossier.commitments ?? []),
      $preferred_tone: dossier.preferredTone ?? null,
      $notes: dossier.notes ?? null,
      $updated_at: dossier.updatedAt ?? Date.now()
    });
  }

  getDossier(chatId: string): ContactDossier | undefined {
    const result = this.db.query('SELECT * FROM contact_dossiers WHERE chat_id = ? LIMIT 1;').get(chatId);
    if (result === null) return undefined;
    const row = sqliteRow(result);
    return {
      chatId: textColumn(row, 'chat_id'),
      name: textColumn(row, 'name'),
      phone: optionalText(row, 'phone'),
      stage: row.stage === null ? 'lead' : enumColumn(row, 'stage', 'lead', 'qualified', 'negotiation', 'customer', 'vip', 'archived'),
      facts: stringArray(parseJson(optionalText(row, 'facts_json'))) ?? [],
      commitments: stringArray(parseJson(optionalText(row, 'commitments_json'))) ?? [],
      preferredTone: optionalText(row, 'preferred_tone'),
      notes: optionalText(row, 'notes'),
      updatedAt: numberColumn(row, 'updated_at')
    };
  }

  addFactToDossier(chatId: string, fact: string) {
    const existing: ContactDossier = this.getDossier(chatId) ?? {
      chatId,
      name: chatId.split('@')[0] ?? chatId,
      stage: 'lead',
      facts: [],
      commitments: [],
      updatedAt: Date.now()
    };

    if (!existing.facts.includes(fact)) {
      existing.facts.push(fact);
      existing.updatedAt = Date.now();
      this.saveDossier(existing);
    }
  }

  addCommitmentToDossier(chatId: string, commitment: string) {
    const existing: ContactDossier = this.getDossier(chatId) ?? {
      chatId,
      name: chatId.split('@')[0] ?? chatId,
      stage: 'lead',
      facts: [],
      commitments: [],
      updatedAt: Date.now()
    };

    if (!existing.commitments.includes(commitment)) {
      existing.commitments.push(commitment);
      existing.updatedAt = Date.now();
      this.saveDossier(existing);
    }
  }

  updateDossierExtracts(chatId: string, updates: { facts?: string[]; commitments?: string[]; stage?: ContactStage }) {
    const existing: ContactDossier = this.getDossier(chatId) ?? {
      chatId,
      name: chatId.split('@')[0] ?? chatId,
      stage: 'lead',
      facts: [],
      commitments: [],
      updatedAt: Date.now()
    };

    let modified = false;
    if (updates.facts?.length) {
      for (const fact of updates.facts) {
        if (typeof fact === 'string' && fact.trim()) {
          const safeFact = scrubCredentials(fact.trim());
          if (safeFact && !existing.facts.includes(safeFact)) {
            existing.facts.push(safeFact);
            modified = true;
          }
        }
      }
    }

    if (updates.commitments?.length) {
      for (const comm of updates.commitments) {
        if (typeof comm === 'string' && comm.trim()) {
          const safeComm = scrubCredentials(comm.trim());
          if (safeComm && !existing.commitments.includes(safeComm)) {
            existing.commitments.push(safeComm);
            modified = true;
          }
        }
      }
    }

    if (updates.stage && existing.stage !== updates.stage) {
      existing.stage = updates.stage;
      modified = true;
    }

    if (modified) {
      existing.updatedAt = Date.now();
      this.saveDossier(existing);
    }
  }

  // --- Drafts ---
  saveDraft(draft: AgentDraft) {
    const stmt = this.db.prepare(`
      INSERT INTO drafts (id, chat_id, incoming_message_id, incoming_text, proposed_reply, reasoning, confidence, status, created_at, tool_call)
      VALUES ($id, $chat_id, $incoming_message_id, $incoming_text, $proposed_reply, $reasoning, $confidence, $status, $created_at, $tool_call)
      ON CONFLICT(id) DO UPDATE SET
        proposed_reply = excluded.proposed_reply,
        status = excluded.status,
        tool_call = excluded.tool_call;
    `);

    stmt.run({
      $id: draft.id,
      $chat_id: draft.chatId,
      $incoming_message_id: draft.incomingMessageId,
      $incoming_text: draft.incomingText,
      $proposed_reply: draft.proposedReply,
      $reasoning: draft.reasoning,
      $confidence: draft.confidence,
      $status: draft.status,
      $created_at: draft.createdAt,
      $tool_call: draft.toolCall ? JSON.stringify(draft.toolCall) : null
    });
  }

  getDraft(id: string): AgentDraft | undefined {
    const row = this.db.query('SELECT * FROM drafts WHERE id = ? LIMIT 1;').get(id);
    return row === null ? undefined : decodeDraft(row);
  }

  getPendingDrafts(chatId?: string): AgentDraft[] {
    const rows = chatId
      ? this.db.query('SELECT * FROM drafts WHERE status = "pending" AND chat_id = ? ORDER BY created_at DESC;').all(chatId)
      : this.db.query('SELECT * FROM drafts WHERE status = "pending" ORDER BY created_at DESC;').all();
    return rows.map(decodeDraft);
  }

  updateDraftStatus(id: string, status: AgentDraft['status'], newReply?: string): AgentDraft | undefined {
    if (newReply) {
      this.db.run('UPDATE drafts SET status = ?, proposed_reply = ? WHERE id = ?;', [status, newReply, id]);
    } else {
      this.db.run('UPDATE drafts SET status = ? WHERE id = ?;', [status, id]);
    }
    return this.getDraft(id);
  }

  saveContactMemory(brandId: string, jid: string, content: string): { id: string; brand_id: string; jid: string; content: string; created_at: number } {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.run(
      'INSERT INTO contact_memories (id, brand_id, jid, content, created_at) VALUES (?, ?, ?, ?, ?);',
      [id, brandId, jid, content, createdAt]
    );
    return { id, brand_id: brandId, jid, content, created_at: createdAt };
  }

  getContactMemories(brandId: string, jid: string): Array<{ id: string; brand_id: string; jid: string; content: string; created_at: number }> {
    const rows = this.db.query(
      'SELECT * FROM contact_memories WHERE brand_id = ? AND jid = ? ORDER BY created_at ASC;'
    ).all(brandId, jid);

    return rows.map((value) => {
      const row = sqliteRow(value);
      return {
        id: textColumn(row, 'id'),
        brand_id: textColumn(row, 'brand_id'),
        jid: textColumn(row, 'jid'),
        content: textColumn(row, 'content'),
        created_at: numberColumn(row, 'created_at')
      };
    });
  }

  deleteContactMemory(brandId: string, jid: string, memoryId: string): boolean {
    const res = this.db.run(
      'DELETE FROM contact_memories WHERE id = ? AND brand_id = ? AND jid = ?;',
      [memoryId, brandId, jid]
    );
    return res.changes > 0;
  }

  clearContactMemories(brandId: string, jid: string): number {
    const res = this.db.run(
      'DELETE FROM contact_memories WHERE brand_id = ? AND jid = ?;',
      [brandId, jid]
    );
    return res.changes;
  }

  // --- Learning States & Reflections ---

  saveLearningState(brandId: string, stateType: 'workbook' | 'notebook', content: string): void {
    const id = `${brandId}:${stateType}`;
    const now = Date.now();
    const existing = this.db.query('SELECT version FROM learning_states WHERE id = ? LIMIT 1').get(id);
    const version = existing === null ? 1 : (optionalNumber(sqliteRow(existing), 'version') ?? 0) + 1;

    this.db.prepare(`
      INSERT INTO learning_states (id, brand_id, state_type, content, version, updated_at)
      VALUES ($id, $brand_id, $state_type, $content, $version, $updated_at)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        version = excluded.version,
        updated_at = excluded.updated_at;
    `).run({
      $id: id,
      $brand_id: brandId,
      $state_type: stateType,
      $content: content,
      $version: version,
      $updated_at: now
    });
  }

  getLearningState(brandId: string, stateType: 'workbook' | 'notebook'): { content: string; version: number; updatedAt: number } | undefined {
    const id = `${brandId}:${stateType}`;
    const result = this.db.query('SELECT content, version, updated_at FROM learning_states WHERE id = ? LIMIT 1').get(id);
    if (result === null) return undefined;
    const row = sqliteRow(result);
    return {
      content: textColumn(row, 'content'),
      version: optionalNumber(row, 'version') ?? 1,
      updatedAt: numberColumn(row, 'updated_at')
    };
  }

  saveReflectionRun(record: {
    id?: string;
    brandId?: string;
    chatId: string;
    triggerReason: string;
    inputMessageCount: number;
    selfCorrectionsCount?: number;
    rulesAdded?: number;
    factsAdded?: number;
    summary?: string;
  }): void {
    const id = record.id || `refl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.db.prepare(`
      INSERT INTO learning_reflections (
        id, brand_id, chat_id, trigger_reason, input_message_count,
        self_corrections_count, rules_added, facts_added, summary, created_at
      ) VALUES (
        $id, $brand_id, $chat_id, $trigger_reason, $input_message_count,
        $self_corrections_count, $rules_added, $facts_added, $summary, $created_at
      )
    `).run({
      $id: id,
      $brand_id: record.brandId || 'default',
      $chat_id: record.chatId,
      $trigger_reason: record.triggerReason,
      $input_message_count: record.inputMessageCount,
      $self_corrections_count: record.selfCorrectionsCount || 0,
      $rules_added: record.rulesAdded || 0,
      $facts_added: record.factsAdded || 0,
      $summary: record.summary || null,
      $created_at: Date.now()
    });
  }

  getReflectionRuns(chatId?: string, limit = 20): Array<{
    id: string;
    brand_id: string;
    chat_id: string;
    trigger_reason: string;
    input_message_count: number;
    self_corrections_count: number;
    rules_added: number;
    facts_added: number;
    summary: string | null;
    created_at: number;
  }> {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const rows = chatId
      ? this.db.query('SELECT * FROM learning_reflections WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?;').all(chatId, boundedLimit)
      : this.db.query('SELECT * FROM learning_reflections ORDER BY created_at DESC LIMIT ?;').all(boundedLimit);
    return rows.map(decodeReflection);
  }

  getFoldRepository(): FoldRepository {
    return this.foldRepository;
  }

  getSendLedger(): SendLedger {
    return this.sendLedger;
  }

  getInboundJobLedger(): InboundJobLedger {
    return this.inboundJobLedger;
  }

  getBroadcastStore(): BroadcastStore {
    return this.broadcastStore;
  }

  /** Read-side handle for the durable inbound work ledger. */
  get inboundJobs(): InboundJobLedger {
    return this.inboundJobLedger;
  }

  /**
   * WA-005: persist an inbound message and, when eligible, its response job
   * in ONE transaction. A crash after this call can no longer leave the
   * message stored with its work lost: the pending job survives and a
   * recovery pass re-drives it exactly once.
   */
  saveInboundMessageWithJob(
    msg: ChatMessage,
    options: { createJob: boolean },
    now = Date.now()
  ): { message?: ChatMessage; job?: InboundJob; created: boolean; isNew: boolean } {
    const persist = () => {
      // A replayed delivery must not re-run saveMessage (it would bump the
      // chat unread counter and broadcast state the original delivery set).
      const existing = this.getMessage(msg.chatId, msg.id);
      if (!existing) this.saveMessage(msg);
      const message = this.getMessage(msg.chatId, msg.id);
      if (!message) return { message: undefined, created: false, isNew: false };
      if (!options.createJob) return { message, created: false, isNew: !existing };
      const { job, created } = this.inboundJobLedger.createJobInTransaction(message, now);
      return { message, job, created, isNew: !existing };
    };
    // Older Bun type declarations omit the return value of immediate().
    let result: ReturnType<typeof persist> | undefined;
    this.db.transaction(() => {
      result = persist();
    }).immediate();
    if (result === undefined) throw new Error('Inbound message transaction did not run');
    return result;
  }

  closeForTesting(): void {
    this.db.close();
  }

  /**
   * Deletes a single chat and all associated data (messages, folds, drafts, dossier, memories, intents)
   */
  deleteChat(chatId: string): boolean {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM conversation_folds WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM drafts WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM contact_dossiers WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM contact_memories WHERE jid = ?').run(chatId);
      this.db.prepare('DELETE FROM learning_reflections WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM send_intents WHERE chat_id = ?').run(chatId);
      const res = this.db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
      return res.changes > 0;
    });
    return transaction();
  }

  /**
   * Clears messages and folds for a chat without removing the contact dossier or chat entry
   */
  clearChatMessages(chatId: string): boolean {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM conversation_folds WHERE chat_id = ?').run(chatId);
      this.db.prepare('UPDATE chats SET last_message = \'\', last_timestamp = ?, unread_count = 0 WHERE id = ?').run(Date.now(), chatId);
      return true;
    });
    return transaction();
  }

  /**
   * Purges all chats, messages, and conversation folds
   */
  clearAllChats(): { deletedChats: number; deletedMessages: number } {
    const transaction = this.db.transaction(() => {
      const msgRes = this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM conversation_folds').run();
      const chatRes = this.db.prepare('DELETE FROM chats').run();
      return { deletedChats: chatRes.changes, deletedMessages: msgRes.changes };
    });
    return transaction();
  }

  /**
   * Purges all drafts across all chats
   */
  clearAllDrafts(): number {
    const res = this.db.prepare('DELETE FROM drafts').run();
    return res.changes;
  }

  /**
   * Purges all contact dossiers and contact memories
   */
  clearAllMemories(): { deletedDossiers: number; deletedMemories: number } {
    const transaction = this.db.transaction(() => {
      const memRes = this.db.prepare('DELETE FROM contact_memories').run();
      const dosRes = this.db.prepare('DELETE FROM contact_dossiers').run();
      return { deletedDossiers: dosRes.changes, deletedMemories: memRes.changes };
    });
    return transaction();
  }

  /**
   * Clears learning states and reflection logs from database
   */
  clearAllLearning(): { deletedStates: number; deletedReflections: number } {
    const transaction = this.db.transaction(() => {
      const stateRes = this.db.prepare('DELETE FROM learning_states').run();
      const refRes = this.db.prepare('DELETE FROM learning_reflections').run();
      return { deletedStates: stateRes.changes, deletedReflections: refRes.changes };
    });
    return transaction();
  }

  /**
   * Computes counts across stored tables and database file size on disk
   */
  getStorageStats(): {
    chatsCount: number;
    messagesCount: number;
    draftsCount: number;
    memoriesCount: number;
    foldsCount: number;
    dbSizeBytes: number;
  } {
    const chats = this.countRows('SELECT COUNT(*) AS c FROM chats;');
    const messages = this.countRows('SELECT COUNT(*) AS c FROM messages;');
    const drafts = this.countRows('SELECT COUNT(*) AS c FROM drafts;');
    const memories = this.countRows('SELECT COUNT(*) AS c FROM contact_memories;');
    const folds = this.countRows('SELECT COUNT(*) AS c FROM conversation_folds;');

    let dbSizeBytes = 0;
    try {
      if (this.dbPath !== ':memory:') {
        const stats = statSync(this.dbPath);
        dbSizeBytes = stats.size;
      }
    } catch (err: unknown) {
      if (!isRecord(err) || err.code !== 'ENOENT') {
        console.warn('[SqliteStore] Could not determine database file size:', err);
      }
    }

    return {
      chatsCount: chats,
      messagesCount: messages,
      draftsCount: drafts,
      memoriesCount: memories,
      foldsCount: folds,
      dbSizeBytes
    };
  }

  /**
   * Flushes WAL journals to disk, truncates them, and reclaims fragmented SQLite pages
   */
  /**
   * WA-011: prove the store can actually commit a write, not merely open.
   * Uses a temp table so no application data is touched.
   */
  verifyWriteCommit(): boolean {
    this.db.run('CREATE TEMP TABLE IF NOT EXISTS doctor_write_probe (id INTEGER PRIMARY KEY, probe TEXT);');
    try {
      this.db.run('DELETE FROM doctor_write_probe;');
      this.db.run('INSERT INTO doctor_write_probe (probe) VALUES (?);', [String(Date.now())]);
      return this.countRows('SELECT COUNT(*) AS c FROM doctor_write_probe;') === 1;
    } finally {
      this.db.run('DROP TABLE IF EXISTS doctor_write_probe;');
    }
  }

  checkpointAndVacuum(): void {
    if (this.dbPath === ':memory:') return;
    try {
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db.run('VACUUM;');
    } catch (err: unknown) {
      if (!isRecord(err) || err.code !== 'SQLITE_IOERR_VNODE') {
        console.warn('[SqliteStore] Error during checkpoint and vacuum:', err);
      }
    }
  }

  /**
   * Wipes all persisted application tables and reclaims disk space
   */
  resetAll(): { success: boolean; clearedTables: string[] } {
    const clearedTables = [
      'messages',
      'conversation_folds',
      'drafts',
      'contact_dossiers',
      'contact_memories',
      'learning_states',
      'learning_reflections',
      'send_intents',
      'chats'
    ];

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages;').run();
      this.db.prepare('DELETE FROM conversation_folds;').run();
      this.db.prepare('DELETE FROM drafts;').run();
      this.db.prepare('DELETE FROM contact_dossiers;').run();
      this.db.prepare('DELETE FROM contact_memories;').run();
      this.db.prepare('DELETE FROM learning_states;').run();
      this.db.prepare('DELETE FROM learning_reflections;').run();
      this.db.prepare('DELETE FROM send_intents;').run();
      this.db.prepare('DELETE FROM chats;').run();
      return true;
    });

    transaction();
    this.checkpointAndVacuum();
    return { success: true, clearedTables };
  }

  close() {
    try {
      if (this.dbPath !== ':memory:') {
        this.db.run('PRAGMA wal_checkpoint(TRUNCATE);');
      }
    } catch {
      // Ignore checkpoint error during teardown
    }
    this.db.close();
  }
}
