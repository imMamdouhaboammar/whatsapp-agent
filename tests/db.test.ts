import { describe, expect, it } from 'bun:test';
import { SqliteStore } from '../src/domain/db';
import type { ChatMessage, ChatSummary, ContactDossier } from '../src/domain/types';

describe('SqliteStore', () => {
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
    expect(retrieved!.name).toBe('Mamdouh Aboammar');
    expect(retrieved!.agentMode).toBe('autopilot');

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
    expect(messages[0].text).toBe('عايز أسأل عن تفاصيل الكورس');

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
    expect(retrieved!.stage).toBe('qualified');
    expect(retrieved!.facts.length).toBe(2);
    expect(retrieved!.commitments[0]).toContain('إرسال البروفايل');

    store.addFactToDossier('client1@s.whatsapp.net', 'الميزانية 40 ألف جنيه');
    const updated = store.getDossier('client1@s.whatsapp.net');
    expect(updated!.facts.length).toBe(3);
    expect(updated!.facts).toContain('الميزانية 40 ألف جنيه');

    store.close();
  });
});
