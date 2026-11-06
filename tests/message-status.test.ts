import { describe, expect, it } from 'bun:test';
import { WAMessageStatus } from '@whiskeysockets/baileys';
import { mapWhatsAppMessageStatus } from '../src/transport/whatsapp-socket';

describe('WhatsApp delivery receipts', () => {
  it('maps native Baileys acknowledgment values into message states', () => {
    expect(mapWhatsAppMessageStatus(WAMessageStatus.PENDING)).toBe('pending');
    expect(mapWhatsAppMessageStatus(WAMessageStatus.SERVER_ACK)).toBe('sent');
    expect(mapWhatsAppMessageStatus(WAMessageStatus.DELIVERY_ACK)).toBe('delivered');
    expect(mapWhatsAppMessageStatus(WAMessageStatus.READ)).toBe('read');
    expect(mapWhatsAppMessageStatus(WAMessageStatus.PLAYED)).toBe('read');
    expect(mapWhatsAppMessageStatus(undefined)).toBeUndefined();
    expect(mapWhatsAppMessageStatus(9999)).toBeUndefined();
  });
});
