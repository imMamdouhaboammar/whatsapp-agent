import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';

const CONFIG = {
  graphVersion: 'v23.0',
  phoneNumberId: '12345678901',
  businessAccountId: '98765432101',
  accessToken: 'tok-' + randomUUID(),
  appSecret: 'sec-' + randomUUID(),
  webhookVerifyToken: 'ver-' + randomUUID()
};
const PHONE = '201011122233';
const CHAT = PHONE + '@s.whatsapp.net';

function sign(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: 'sha256=' + createHmac('sha256', CONFIG.appSecret).update(body).digest('hex') };
}

function wrap(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: CONFIG.businessAccountId,
      changes: [{
        field: 'messages',
        value: { messaging_product: 'whatsapp', metadata: { phone_number_id: CONFIG.phoneNumberId }, ...value }
      }]
    }]
  };
}

describe('Meta runtime outbound composition', () => {
  test('UI send reaches the Graph API once, then signed receipts advance the intent and a failure is recorded', async () => {
    const graphCalls: Array<{ url: string; auth: string | null; body: unknown }> = [];
    let nextId = 1;
    const fakeFetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      graphCalls.push({
        url: request.url,
        auth: request.headers.get('authorization'),
        body: await request.json()
      });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.outbound-${nextId++}` }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }, {
      preconnect: () => { throw new Error('Unexpected preconnect'); }
    });

    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      capabilityAutopilotBrandId: 'store',
      transport: 'meta-cloud',
      metaCloud: { config: CONFIG, fetch: fakeFetch }
    });
    const post = (signed: { body: string; signature: string }) => agent.app.request('/webhooks/meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
      body: signed.body
    });
    const send = (text: string, key: string) => agent.app.request(`/api/chats/${CHAT}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ text })
    });
    const ledger = () => agent.memoryStore.getSendLedger();

    try {
      // No inbound customer message yet: free-form text must not reach Meta.
      const blocked = await send('hello before any inbound', 'key-blocked');
      expect(blocked.status).not.toBe(200);
      expect(graphCalls).toHaveLength(0);

      const inbound = sign(wrap({
        messages: [{
          id: 'wamid.inbound-1', from: PHONE,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text', text: { body: 'مرحبا' }
        }]
      }));
      expect((await post(inbound)).status).toBe(200);

      const sent = await send('أهلا بك', 'key-ok');
      const sentBody = await sent.json();
      expect(sent.status).toBe(200);
      expect(sentBody.success).toBe(true);
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0]?.url).toBe('https://graph.facebook.com/v23.0/12345678901/messages');
      expect(graphCalls[0]?.auth).toBe('Bearer ' + CONFIG.accessToken);
      expect(graphCalls[0]?.body).toMatchObject({
        messaging_product: 'whatsapp', to: PHONE, type: 'text',
        text: { body: 'أهلا بك', preview_url: false }
      });

      // The same idempotency key must not reach Meta a second time.
      await send('أهلا بك', 'key-ok');
      expect(graphCalls).toHaveLength(1);

      const receipt = (id: string, status: string) => sign(wrap({
        statuses: [{ id, status, recipient_id: PHONE, timestamp: String(Math.floor(Date.now() / 1000)) }]
      }));
      expect((await post(receipt('wamid.outbound-1', 'delivered'))).status).toBe(200);
      expect(ledger().getIntent(sentBody.intentId)?.state).toBe('delivered');
      expect((await post(receipt('wamid.outbound-1', 'read'))).status).toBe(200);
      expect(ledger().getIntent(sentBody.intentId)?.state).toBe('read');
      // A replayed webhook event is dropped by the Meta adapter before it reaches the
      // receipt handler, so this checks the end state only. Receipt ordering inside the
      // ledger is covered in tests/delivery-lifecycle.test.ts.
      expect((await post(receipt('wamid.outbound-1', 'delivered'))).status).toBe(200);
      expect(ledger().getIntent(sentBody.intentId)?.state).toBe('read');

      const second = await (await send('second message', 'key-fail')).json();
      expect(graphCalls).toHaveLength(2);
      expect((await post(receipt('wamid.outbound-2', 'failed'))).status).toBe(200);
      const failed = ledger().getIntent(second.intentId);
      expect(failed?.state).toBe('failed');
    } finally {
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
      agent.recipientDirectory?.close();
    }
  }, 15_000);
});
