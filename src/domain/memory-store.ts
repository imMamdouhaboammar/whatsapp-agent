import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteStore } from './db';
import type {
  AgentDraft,
  AgentMode,
  ChatMessage,
  ChatSummary,
  ContactDossier
} from './types';

export interface MemoryStoreOptions {
  dataDir?: string;
  maxHistoryPerChat?: number;
  dbPath?: string;
}

export class MemoryStore {
  private dataDir: string;
  private maxHistoryPerChat: number;
  private sqlite: SqliteStore;

  constructor(options: MemoryStoreOptions = {}) {
    this.dataDir = options.dataDir ?? './data';
    this.maxHistoryPerChat = options.maxHistoryPerChat ?? 50;

    const dbPath = options.dbPath ?? (
      this.dataDir === ':memory:'
        ? ':memory:'
        : join(this.dataDir, 'fable_whatsapp.db')
    );

    this.sqlite = new SqliteStore({
      dbPath,
      legacyDataDir: this.dataDir !== ':memory:' ? this.dataDir : undefined
    });
  }

  addMessage(msg: ChatMessage): ChatMessage {
    this.sqlite.saveMessage(msg);
    return this.sqlite.getMessage(msg.chatId, msg.id) ?? msg;
  }

  updateMessageStatus(chatId: string, messageId: string, status: NonNullable<ChatMessage['status']>): ChatMessage['status'] | undefined {
    return this.sqlite.updateMessageStatus(chatId, messageId, status);
  }

  addReaction(chatId: string, messageId: string, emoji: string) {
    this.sqlite.addReaction(chatId, messageId, emoji);
  }

  getMessages(chatId: string, limit = 20): ChatMessage[] {
    return this.sqlite.getMessages(chatId, limit);
  }

  getMessage(chatId: string, messageId: string): ChatMessage | undefined {
    return this.sqlite.getMessage(chatId, messageId);
  }

  listChats(): ChatSummary[] {
    return this.sqlite.listChats();
  }

  getChat(chatId: string): ChatSummary | undefined {
    return this.sqlite.getChat(chatId);
  }

  setChatMode(chatId: string, mode: AgentMode) {
    this.sqlite.setChatMode(chatId, mode);
  }

  markChatRead(chatId: string) {
    this.sqlite.markChatRead(chatId);
  }

  saveDraft(draft: AgentDraft) {
    this.sqlite.saveDraft(draft);
  }

  getDraft(id: string): AgentDraft | undefined {
    return this.sqlite.getDraft(id);
  }

  getPendingDrafts(chatId?: string): AgentDraft[] {
    return this.sqlite.getPendingDrafts(chatId);
  }

  updateDraftStatus(
    id: string,
    status: AgentDraft['status'],
    newReply?: string
  ): AgentDraft | undefined {
    return this.sqlite.updateDraftStatus(id, status, newReply);
  }

  // --- Entity Cognition & Dossier API ---
  getDossier(chatId: string): ContactDossier | undefined {
    return this.sqlite.getDossier(chatId);
  }

  saveDossier(dossier: ContactDossier) {
    this.sqlite.saveDossier(dossier);
  }

  addFactToDossier(chatId: string, fact: string) {
    this.sqlite.addFactToDossier(chatId, fact);
  }

  addCommitmentToDossier(chatId: string, commitment: string) {
    this.sqlite.addCommitmentToDossier(chatId, commitment);
  }

  close() {
    this.sqlite.close();
  }
}
