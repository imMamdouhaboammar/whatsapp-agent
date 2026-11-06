import { describe, expect, it } from 'bun:test';
import { BurstAccumulator, type FusedBurst } from '../src/domain/burst-accumulator';
import type { ChatMessage } from '../src/domain/types';

describe('BurstAccumulator', () => {
  it('accumulates multiple rapid messages into a single fused turn', async () => {
    let deliveredBurst: FusedBurst | null = null;

    const accumulator = new BurstAccumulator({
      windowMs: 50, // Short for testing
      onBurst: (burst) => {
        deliveredBurst = burst;
      }
    });

    const msg1: ChatMessage = {
      id: 'm1',
      chatId: 'user1@s.whatsapp.net',
      sender: 'user1@s.whatsapp.net',
      senderName: 'عمرو',
      text: 'مساء الخير يا فندم',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const msg2: ChatMessage = {
      id: 'm2',
      chatId: 'user1@s.whatsapp.net',
      sender: 'user1@s.whatsapp.net',
      senderName: 'عمرو',
      text: 'كنت بستفسر عن خدمة الأتمتة',
      timestamp: Date.now() + 10,
      isFromMe: false,
      type: 'text'
    };

    const msg3: ChatMessage = {
      id: 'm3',
      chatId: 'user1@s.whatsapp.net',
      sender: 'user1@s.whatsapp.net',
      senderName: 'عمرو',
      text: 'هل بتشتغل مع واتساب بيزنس؟',
      timestamp: Date.now() + 20,
      isFromMe: false,
      type: 'text'
    };

    accumulator.push(msg1);
    accumulator.push(msg2);
    accumulator.push(msg3);

    expect(accumulator.hasPending('user1@s.whatsapp.net')).toBe(true);

    // Wait for the debounce window to fire
    await new Promise((r) => setTimeout(r, 70));

    expect(deliveredBurst).not.toBeNull();
    expect(deliveredBurst!.chatId).toBe('user1@s.whatsapp.net');
    expect(deliveredBurst!.messages.length).toBe(3);
    expect(deliveredBurst!.fusedText).toBe('مساء الخير يا فندم\nكنت بستفسر عن خدمة الأتمتة\nهل بتشتغل مع واتساب بيزنس؟');
    expect(deliveredBurst!.lastMessageId).toBe('m3');
    expect(accumulator.hasPending('user1@s.whatsapp.net')).toBe(false);

    accumulator.destroy();
  });

  it('preserves quoted/swiped message context across burst messages', async () => {
    let deliveredBurst: FusedBurst | null = null;

    const accumulator = new BurstAccumulator({
      windowMs: 40,
      onBurst: (burst) => {
        deliveredBurst = burst;
      }
    });

    const msg1: ChatMessage = {
      id: 'm1',
      chatId: 'user2@s.whatsapp.net',
      sender: 'user2@s.whatsapp.net',
      text: 'بقولك بخصوص دي',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text',
      replyToId: 'orig_123',
      quotedMessage: {
        id: 'orig_123',
        sender: 'me',
        senderName: 'أنت',
        text: 'عرض الصيف ينتهي اليوم',
        type: 'text'
      }
    };

    const msg2: ChatMessage = {
      id: 'm2',
      chatId: 'user2@s.whatsapp.net',
      sender: 'user2@s.whatsapp.net',
      text: 'ممكن تمدوه لبكرة؟',
      timestamp: Date.now() + 10,
      isFromMe: false,
      type: 'text'
    };

    accumulator.push(msg1);
    accumulator.push(msg2);

    await new Promise((r) => setTimeout(r, 60));

    expect(deliveredBurst).not.toBeNull();
    expect(deliveredBurst!.quotedMessage).toBeDefined();
    expect(deliveredBurst!.quotedMessage?.text).toBe('عرض الصيف ينتهي اليوم');
    expect(deliveredBurst!.replyToId).toBe('orig_123');

    accumulator.destroy();
  });
});
