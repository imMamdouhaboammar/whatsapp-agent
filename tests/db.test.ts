import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/domain/db';
import type { ChatMessage, ChatSummary, ContactDossier } from '../src/domain/types';

describe('SqliteStore', () => {
  it('rejects invalid persisted scalars and falls back for invalid JSON shapes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-db-'));
    const dbPath = join(dir, 'test.db');
    const store = new SqliteStore({ dbPath });
    const db = new Database(dbPath);
    try {
      db.run(`INSERT INTO messages (id, chat_id, sender, text, timestamp, is_from_me, status, reactions_json)
        VALUES ('msg', 'chat', 'chat', 'hello', 1, 0, 'invalid', '["emoji", 42]')`);
      expect(() => store.getMessage('chat', 'msg')).toThrow('Invalid SQLite column: status');
      expect(() => store.getMessages('chat')).toThrow('Invalid SQLite column: status');
      db.run("UPDATE messages SET status = 'delivered' WHERE id = 'msg'");
      expect(store.getMessage('chat', 'msg')).toMatchObject({ status: 'delivered', reactions: undefined });
    } finally {
      db.close();
      store.close();
      rmSync(dir, { recursive: true });
    }
  });

  it('imports valid legacy chats without persisting malformed rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-legacy-'));
    try {
      writeFileSync(join(dir, 'chats.json'), JSON.stringify([
        { id: 'bad', name: 'Malformed', unreadCount: 0, isGroup: false, agentMode: 'unknown' },
        { id: 'valid', name: 'Valid', unreadCount: 1, isGroup: false, agentMode: 'autopilot' }
      ]));
      const store = new SqliteStore({ dbPath: ':memory:', legacyDataDir: dir });
      try {
        expect(store.getChat('bad')).toBeUndefined();
        expect(store.getChat('valid')).toMatchObject({ id: 'valid', name: 'Valid', unreadCount: 1 });
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saves and retrieves chats and messages in memory with WAL performance', () => {
    const store = new SqliteStore({ dbPath: ':memory:' });

    const chat: ChatSummary = {
      id: '201092677269@s.whatsapp.net',
      name: 'Mamdouh Aboammar',
      phoneNumber: '+201092677269',
      unreadCount: 1,
      isGroup: false,
      agentMode: 'autopilot',
      lastMessage: 'مرحباً',
      lastTimestamp: 1700000000000
    };

    store.saveChat(chat);
    const retrieved = store.getChat('201092677269@s.whatsapp.net');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Mamdouh Aboammar');
    expect(retrieved?.agentMode).toBe('autopilot');

    const msg: ChatMessage = {
      id: 'msg_101',
      chatId: '201092677269@s.whatsapp.net',
      sender: '201092677269@s.whatsapp.net',
      senderName: 'Mamdouh Aboammar',
      text: 'عايز أسأل عن تفاصيل الكورس',
      timestamp: 1700000010000,
      isFromMe: false,
      type: 'text',
      status: 'delivered'
    };

    store.saveMessage(msg);
    const messages = store.getMessages('201092677269@s.whatsapp.net');
    expect(messages.length).toBe(1);
    expect(messages[0]?.text).toBe('عايز أسأل عن تفاصيل الكورس');

    store.close();
  });

  it('advances outbound receipts without downgrading persisted read status', () => {
    const store = new SqliteStore({ dbPath: ':memory:' });
    const msg: ChatMessage = {
      id: 'out-1', chatId: 'recipient@s.whatsapp.net', sender: 'me', text: 'hello',
      timestamp: 1700000010000, isFromMe: true, type: 'text', status: 'sent'
    };
    store.saveMessage(msg);
    expect(store.updateMessageStatus(msg.chatId, msg.id, 'delivered')).toBe('delivered');
    expect(store.updateMessageStatus(msg.chatId, msg.id, 'read')).toBe('read');
    expect(store.updateMessageStatus(msg.chatId, msg.id, 'sent')).toBeUndefined();
    store.saveMessage({ ...msg, status: 'sent' });
    expect(store.getMessage(msg.chatId, msg.id)?.status).toBe('read');
    store.close();
  });

  it('buffers receipts arriving before an outgoing message is saved', () => {
    const store = new SqliteStore({ dbPath: ':memory:' });
    const chatId = 'recipient@s.whatsapp.net';
    expect(store.updateMessageStatus(chatId, 'out-early', 'read')).toBeUndefined();
    store.saveMessage({
      id: 'out-early', chatId, sender: 'me', text: 'early read',
      timestamp: 1700000010000, isFromMe: true, type: 'text', status: 'sent'
    });
    expect(store.getMessage(chatId, 'out-early')?.status).toBe('read');
    store.saveMessage({
      id: 'in-1', chatId, sender: chatId, text: 'incoming',
      timestamp: 1700000020000, isFromMe: false, type: 'text', status: 'delivered'
    });
    expect(store.updateMessageStatus(chatId, 'in-1', 'read')).toBeUndefined();
    expect(store.getMessage(chatId, 'in-1')?.status).toBe('delivered');
    store.close();
  });

  it('stores and updates contact dossiers with extracted facts and commitments', () => {
    const store = new SqliteStore({ dbPath: ':memory:' });

    const dossier: ContactDossier = {
      chatId: 'client1@s.whatsapp.net',
      name: 'مهندس أحمد',
      phone: '+201123456789',
      stage: 'qualified',
      facts: ['صاحب شركة برمجيات بالمعادي', 'مهتم بـ 5 تراخيص'],
      commitments: ['إرسال البروفايل يوم الأحد'],
      preferredTone: 'عامية راقية',
      updatedAt: Date.now()
    };

    store.saveDossier(dossier);
    const retrieved = store.getDossier('client1@s.whatsapp.net');
    expect(retrieved).toBeDefined();
    expect(retrieved?.stage).toBe('qualified');
    expect(retrieved?.facts.length).toBe(2);
    expect(retrieved?.commitments[0]).toContain('إرسال البروفايل');

    store.addFactToDossier('client1@s.whatsapp.net', 'الميزانية 40 ألف جنيه');
    const updated = store.getDossier('client1@s.whatsapp.net');
    expect(updated?.facts.length).toBe(3);
    expect(updated?.facts).toContain('الميزانية 40 ألف جنيه');

    store.close();
  });
});
