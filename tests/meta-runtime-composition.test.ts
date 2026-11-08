import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';

const CONFIG = {
  graphVersion: 'v23.0',
  phoneNumberId: '12345678901',
  businessAccountId: '98765432101',
  accessToken: 'integration-test-only-token',
  appSecret: 'integration-test-only-secret',
  webhookVerifyToken: 'integration-test-verify-token'
};

function signedInbound(messageId: string, phone: string, text: string): { body: string; signature: string } {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: CONFIG.businessAccountId,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: CONFIG.phoneNumberId },
          messages: [{
            id: messageId,
            from: phone,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: text }
          }]
        }
      }]
    }]
  });
  const signature = 'sha256=' + createHmac('sha256', CONFIG.appSecret).update(body).digest('hex');
  return { body, signature };
}

describe('B2 Meta runtime composition', () => {
  test('registers a signed webhook and persists official inbound events once without connecting Baileys', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      capabilityAutopilotBrandId: 'store',
      transport: 'meta-cloud',
      metaCloud: { config: CONFIG }
    });
    const phone = '201011122233';
    const chatId = phone + '@s.whatsapp.net';
    try {
      const verify = await agent.app.request(
        '/webhooks/meta?hub.mode=subscribe&hub.verify_token=' + CONFIG.webhookVerifyToken + '&hub.challenge=registered'
      );
      expect(verify.status).toBe(200);
      expect(await verify.text()).toBe('registered');

      const signed = signedInbound('wamid.runtime-inbound-1', phone, 'السلام عليكم');
      const request = () => agent.app.request('/webhooks/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
        body: signed.body
      });
      const accepted = await request();
      expect(accepted.status).toBe(200);
      expect(agent.memoryStore.getMessage(chatId, 'wamid.runtime-inbound-1')?.text).toBe('السلام عليكم');
      expect(agent.burstAccumulator.hasPending(chatId)).toBe(true);
      expect((await request()).status).toBe(200);
      expect(agent.memoryStore.getMessages(chatId, 10).filter(msg => msg.id === 'wamid.runtime-inbound-1')).toHaveLength(1);

      const denied = await agent.app.request('/webhooks/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
        body: signed.body
      });
      expect(denied.status).toBe(401);

      const status = await agent.app.request('/api/status');
      expect(status.status).toBe(200);
      expect((await status.json()).transportMode).toBe('meta-cloud');
      const connect = await agent.app.request('/api/connect', { method: 'POST', body: '{}' });
      expect(connect.status).toBe(409);
    } finally {
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
      agent.recipientDirectory?.close();
    }
  });

  test('refuses Meta mode before initializing a transport when required account credentials are absent', async () => {
    await expect(createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      transport: 'meta-cloud'
    })).rejects.toThrow(/meta|credential|config/i);
  });
});
