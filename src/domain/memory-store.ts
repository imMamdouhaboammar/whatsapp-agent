import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentDraft, AgentMode, ChatMessage, ChatSummary } from './types';

export interface MemoryStoreOptions {
  dataDir?: string;
  maxHistoryPerChat?: number;
}

export class MemoryStore {
  private dataDir: string;
  private maxHistoryPerChat: number;
  private chats: Map<string, ChatSummary> = new Map();
  private messages: Map<string, ChatMessage[]> = new Map();
  private drafts: Map<string, AgentDraft> = new Map();
  private initialized = false;

  constructor(options: MemoryStoreOptions = {}) {
    this.dataDir = options.dataDir ?? './data';
    this.maxHistoryPerChat = options.maxHistoryPerChat ?? 50;
    this.init();
  }

  private get chatsFilePath(): string {
    return join(this.dataDir, 'chats.json');
  }

  private get draftsFilePath(): string {
    return join(this.dataDir, 'drafts.json');
  }

  private init() {
    if (this.initialized) return;
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }

      if (existsSync(this.chatsFilePath)) {
        const raw = JSON.parse(readFileSync(this.chatsFilePath, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            this.chats.set(item.id, item);
          }
        }
      }

      if (existsSync(this.draftsFilePath)) {
        const raw = JSON.parse(readFileSync(this.draftsFilePath, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            this.drafts.set(item.id, item);
          }
        }
      }
      this.initialized = true;
    } catch {
      // Non-fatal, memory fallback
      this.initialized = true;
    }
  }

  private persistChats() {
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
      const array = Array.from(this.chats.values());
      writeFileSync(this.chatsFilePath, JSON.stringify(array, null, 2), 'utf-8');
    } catch {
      // Ignore write errors in test or ephemeral environments
    }
  }

  private persistDrafts() {
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
      const array = Array.from(this.drafts.values());
      writeFileSync(this.draftsFilePath, JSON.stringify(array, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  addMessage(msg: ChatMessage) {
    const list = this.messages.get(msg.chatId) ?? [];
    // Deduplicate by id
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg);
      // Sort by timestamp
      list.sort((a, b) => a.timestamp - b.timestamp);
      // Prune
      if (list.length > this.maxHistoryPerChat) {
        list.splice(0, list.length - this.maxHistoryPerChat);
      }
      this.messages.set(msg.chatId, list);
    }

    // Update chat summary
    const existingChat = this.chats.get(msg.chatId) ?? {
      id: msg.chatId,
      name: msg.senderName || msg.sender.split('@')[0] || msg.chatId,
      unreadCount: 0,
      isGroup: msg.chatId.endsWith('@g.us'),
      agentMode: 'autopilot'
    };

    existingChat.lastMessage = msg.text || (msg.type === 'audio' ? '🎵 [Voice Note]' : `[${msg.type}]`);
    existingChat.lastTimestamp = msg.timestamp;
    if (!msg.isFromMe) {
      existingChat.unreadCount = (existingChat.unreadCount || 0) + 1;
    }
    this.chats.set(msg.chatId, existingChat);
    this.persistChats();
  }

  getMessages(chatId: string, limit = 20): ChatMessage[] {
    const list = this.messages.get(chatId) ?? [];
    return list.slice(-limit);
  }

  getMessage(chatId: string, messageId: string): ChatMessage | undefined {
    const list = this.messages.get(chatId) ?? [];
    return list.find((m) => m.id === messageId);
  }

  listChats(): ChatSummary[] {
    return Array.from(this.chats.values()).sort((a, b) => (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0));
  }

  getChat(chatId: string): ChatSummary | undefined {
    return this.chats.get(chatId);
  }

  setChatMode(chatId: string, mode: AgentMode) {
    const chat = this.chats.get(chatId) ?? {
      id: chatId,
      name: chatId.split('@')[0],
      unreadCount: 0,
      isGroup: chatId.endsWith('@g.us'),
      agentMode: mode
    };
    chat.agentMode = mode;
    this.chats.set(chatId, chat);
    this.persistChats();
  }

  markChatRead(chatId: string) {
    const chat = this.chats.get(chatId);
    if (chat) {
      chat.unreadCount = 0;
      this.chats.set(chatId, chat);
      this.persistChats();
    }
  }

  saveDraft(draft: AgentDraft) {
    this.drafts.set(draft.id, draft);
    this.persistDrafts();
  }

  getDraft(id: string): AgentDraft | undefined {
    return this.drafts.get(id);
  }

  getPendingDrafts(chatId?: string): AgentDraft[] {
    const all = Array.from(this.drafts.values()).filter((d) => d.status === 'pending');
    if (chatId) return all.filter((d) => d.chatId === chatId);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  updateDraftStatus(id: string, status: AgentDraft['status'], newReply?: string): AgentDraft | undefined {
    const draft = this.drafts.get(id);
    if (draft) {
      draft.status = status;
      if (newReply) draft.proposedReply = newReply;
      this.drafts.set(id, draft);
      this.persistDrafts();
      return draft;
    }
    return undefined;
  }
}
