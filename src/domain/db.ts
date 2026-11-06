import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AgentDraft,
  AgentMode,
  ChatMessage,
  ChatSummary,
  ContactDossier,
  QuotedMessageInfo
} from './types';

export interface SqliteStoreOptions {
  dbPath?: string;
  legacyDataDir?: string;
}

export class SqliteStore {
  private db: Database;
  private dbPath: string;

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

    if (options.legacyDataDir) {
      this.importLegacyJson(options.legacyDataDir);
    }
  }

  private init() {
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');

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
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Imports legacy JSON files if they exist and DB is empty
   */
  private importLegacyJson(dir: string) {
    try {
      const chatsCount = (this.db.query('SELECT COUNT(*) as c FROM chats;').get() as any)?.c || 0;
      const chatsPath = `${dir}/chats.json`;
      if (chatsCount === 0 && existsSync(chatsPath)) {
        const raw = JSON.parse(readFileSync(chatsPath, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            this.saveChat(item);
          }
        }
      }

      const msgsCount = (this.db.query('SELECT COUNT(*) as c FROM messages;').get() as any)?.c || 0;
      const msgsPath = `${dir}/messages.json`;
      if (msgsCount === 0 && existsSync(msgsPath)) {
        const raw = JSON.parse(readFileSync(msgsPath, 'utf-8'));
        if (typeof raw === 'object' && raw !== null) {
          for (const msgs of Object.values(raw)) {
            if (Array.isArray(msgs)) {
              for (const m of msgs) {
                this.saveMessage(m);
              }
            }
          }
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
    const row = this.db.query('SELECT * FROM chats WHERE id = ?;').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      phoneNumber: row.phone_number ?? undefined,
      unreadCount: row.unread_count,
      lastMessage: row.last_message ?? undefined,
      lastTimestamp: row.last_timestamp ?? undefined,
      isGroup: Boolean(row.is_group),
      agentMode: row.agent_mode as AgentMode,
      avatarUrl: row.avatar_url ?? undefined
    };
  }

  listChats(): ChatSummary[] {
    const rows = this.db.query('SELECT * FROM chats ORDER BY COALESCE(last_timestamp, 0) DESC;').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phoneNumber: row.phone_number ?? undefined,
      unreadCount: row.unread_count,
      lastMessage: row.last_message ?? undefined,
      lastTimestamp: row.last_timestamp ?? undefined,
      isGroup: Boolean(row.is_group),
      agentMode: row.agent_mode as AgentMode,
      avatarUrl: row.avatar_url ?? undefined
    }));
  }

  setChatMode(id: string, mode: AgentMode) {
    this.db.run('UPDATE chats SET agent_mode = ? WHERE id = ?;', [mode, id]);
  }

  markChatRead(id: string) {
    this.db.run('UPDATE chats SET unread_count = 0 WHERE id = ?;', [id]);
  }

  // --- Messages ---
  saveMessage(msg: ChatMessage) {
    if (!msg.text?.trim() && msg.type === 'text') return;
    if (msg.text === '[رسالة]') return;

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
      $status: msg.status ?? 'sent'
    });

    // Automatically update or create chat summary
    const phoneCandidate = msg.chatId.split('@')[0];
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

  getMessages(chatId: string, limit = 50): ChatMessage[] {
    const rows = this.db.query(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?;'
    ).all(chatId, limit) as any[];

    return rows.reverse().map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      sender: row.sender,
      senderName: row.sender_name ?? undefined,
      text: row.text,
      timestamp: row.timestamp,
      isFromMe: Boolean(row.is_from_me),
      type: row.type as ChatMessage['type'],
      replyToId: row.reply_to_id ?? undefined,
      quotedMessage: row.quoted_json ? JSON.parse(row.quoted_json) : undefined,
      reactions: row.reactions_json ? JSON.parse(row.reactions_json) : undefined,
      transcription: row.transcription ?? undefined,
      status: row.status as ChatMessage['status']
    }));
  }

  getMessage(chatId: string, messageId: string): ChatMessage | undefined {
    const row = this.db.query(
      'SELECT * FROM messages WHERE chat_id = ? AND id = ?;'
    ).get(chatId, messageId) as any;

    if (!row) return undefined;
    return {
      id: row.id,
      chatId: row.chat_id,
      sender: row.sender,
      senderName: row.sender_name ?? undefined,
      text: row.text,
      timestamp: row.timestamp,
      isFromMe: Boolean(row.is_from_me),
      type: row.type as ChatMessage['type'],
      replyToId: row.reply_to_id ?? undefined,
      quotedMessage: row.quoted_json ? JSON.parse(row.quoted_json) : undefined,
      reactions: row.reactions_json ? JSON.parse(row.reactions_json) : undefined,
      transcription: row.transcription ?? undefined,
      status: row.status as ChatMessage['status']
    };
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
    const row = this.db.query('SELECT * FROM contact_dossiers WHERE chat_id = ?;').get(chatId) as any;
    if (!row) return undefined;
    return {
      chatId: row.chat_id,
      name: row.name,
      phone: row.phone ?? undefined,
      stage: row.stage as ContactDossier['stage'],
      facts: JSON.parse(row.facts_json || '[]'),
      commitments: JSON.parse(row.commitments_json || '[]'),
      preferredTone: row.preferred_tone ?? undefined,
      notes: row.notes ?? undefined,
      updatedAt: row.updated_at
    };
  }

  addFactToDossier(chatId: string, fact: string) {
    const existing = this.getDossier(chatId) ?? {
      chatId,
      name: chatId.split('@')[0],
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
    const existing = this.getDossier(chatId) ?? {
      chatId,
      name: chatId.split('@')[0],
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

  // --- Drafts ---
  saveDraft(draft: AgentDraft) {
    const stmt = this.db.prepare(`
      INSERT INTO drafts (id, chat_id, incoming_message_id, incoming_text, proposed_reply, reasoning, confidence, status, created_at)
      VALUES ($id, $chat_id, $incoming_message_id, $incoming_text, $proposed_reply, $reasoning, $confidence, $status, $created_at)
      ON CONFLICT(id) DO UPDATE SET
        proposed_reply = excluded.proposed_reply,
        status = excluded.status;
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
      $created_at: draft.createdAt
    });
  }

  getDraft(id: string): AgentDraft | undefined {
    const row = this.db.query('SELECT * FROM drafts WHERE id = ?;').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      chatId: row.chat_id,
      incomingMessageId: row.incoming_message_id,
      incomingText: row.incoming_text,
      proposedReply: row.proposed_reply,
      reasoning: row.reasoning,
      confidence: row.confidence,
      status: row.status as AgentDraft['status'],
      createdAt: row.created_at
    };
  }

  getPendingDrafts(chatId?: string): AgentDraft[] {
    let rows: any[];
    if (chatId) {
      rows = this.db.query('SELECT * FROM drafts WHERE status = "pending" AND chat_id = ? ORDER BY created_at DESC;').all(chatId) as any[];
    } else {
      rows = this.db.query('SELECT * FROM drafts WHERE status = "pending" ORDER BY created_at DESC;').all() as any[];
    }

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      incomingMessageId: row.incoming_message_id,
      incomingText: row.incoming_text,
      proposedReply: row.proposed_reply,
      reasoning: row.reasoning,
      confidence: row.confidence,
      status: row.status as AgentDraft['status'],
      createdAt: row.created_at
    }));
  }

  updateDraftStatus(id: string, status: AgentDraft['status'], newReply?: string): AgentDraft | undefined {
    if (newReply) {
      this.db.run('UPDATE drafts SET status = ?, proposed_reply = ? WHERE id = ?;', [status, newReply, id]);
    } else {
      this.db.run('UPDATE drafts SET status = ? WHERE id = ?;', [status, id]);
    }
    return this.getDraft(id);
  }

  close() {
    this.db.close();
  }
}
