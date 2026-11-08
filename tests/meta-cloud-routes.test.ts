import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { MetaCloudApi, type MetaCloudApiConfig, type MetaCloudWebhookEvent } from '../src/transport/meta-cloud-api';
import { registerMetaCloudWebhookRoutes } from '../src/server/meta-cloud-routes';

const phoneNumberId = '12345098765';
const recipient = '201112223333';
const chatId = `${recipient}@s.whatsapp.net`;
const nativeId = 'wamid.HBgSMTIzNDU2Nzg5=';
const config: MetaCloudApiConfig = {
  graphVersion: 'v24.0',
  phoneNumberId,
  businessAccountId: 'waba-123',
  accessToken: ['local', 'test', 'access'].join('-'),
  appSecret: ['local', 'test', 'app', 'secret'].join('-'),
  webhookVerifyToken: ['local', 'test', 'verify'].join('-')
};

function envelope(value: Record<string, unknown>, waba = config.businessAccountId) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: waba, changes: [{
      field: 'messages',
      value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, ...value }
    }] }]
  };
}

function signedRequest(payload: unknown, options: { secret?: string; body?: string; signature?: string } = {}) {
  const body = options.body ?? JSON.stringify(payload);
  const signature = options.signature ?? 'sha256=' +
    createHmac('sha256', options.secret ?? config.appSecret).update(body).digest('hex');
  return new Request('http://local.test/webhooks/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body
  });
}

function setup(options: {
  onEvent?: (event: MetaCloudWebhookEvent) => void | Promise<void>;
  credentials?: MetaCloudApiConfig;
} = {}) {
  const app = new Hono();
  let fetchCalls = 0;
  const meta = new MetaCloudApi({
    config: options.credentials ?? config,
    onEvent: options.onEvent,
    fetch: (async () => {
      fetchCalls++;
      throw new Error('Outbound Meta API must never run during webhook routing');
    }) as typeof fetch
  });
  registerMetaCloudWebhookRoutes(app, meta);
  return { app, meta, outboundCalls: () => fetchCalls };
}

describe('Meta webhook HTTP route adapter', () => {
  test('exposes the public GET verification challenge without owner credentials', async () => {
    const { app } = setup();
    const query = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': config.webhookVerifyToken,
      'hub.challenge': '00123456789'
    });
    const valid = await app.request(`http://local.test/webhooks/meta?${query}`);
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe('00123456789');
    expect(valid.headers.get('content-type')).toContain('text/plain');
    expect(valid.headers.get('cache-control')).toBe('no-store');

    query.set('hub.verify_token', 'invalid');
    expect((await app.request(`http://local.test/webhooks/meta?${query}`)).status).toBe(403);
    query.set('hub.verify_token', config.webhookVerifyToken);
    query.set('hub.mode', 'unsubscribe');
    expect((await app.request(`http://local.test/webhooks/meta?${query}`)).status).toBe(403);
    expect((await app.request('http://local.test/webhooks/meta')).status).toBe(403);
  });

  test('preserves exact signed raw bytes, emits inbound text and correlatable native receipts once', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const { app, outboundCalls } = setup({ onEvent: event => { events.push(event); } });
    const payload = envelope({
      messages: [{ id: 'wamid.INBOUND123=', from: recipient, type: 'text', text: { body: 'أهلاً، محتاج مساعدة' }, timestamp: '1785000000' }],
      statuses: [
        { id: nativeId, recipient_id: recipient, status: 'sent' },
        { id: nativeId, recipient_id: recipient, status: 'delivered' },
        { id: nativeId, recipient_id: recipient, status: 'read' }
      ]
    });
    // The extra newline and spacing must be included unchanged in the signed bytes.
    const body = JSON.stringify(payload, null, 2) + '\n';
    expect((await app.request(signedRequest(payload, { body }))).status).toBe(200);
    expect(events).toEqual([
      { kind: 'inbound_text', chatId, nativeMessageId: 'wamid.INBOUND123=', text: 'أهلاً، محتاج مساعدة', timestampMs: 1_785_000_000_000 },
      { kind: 'receipt', chatId, nativeMessageId: nativeId, status: 'sent' },
      { kind: 'receipt', chatId, nativeMessageId: nativeId, status: 'delivered' },
      { kind: 'receipt', chatId, nativeMessageId: nativeId, status: 'read' }
    ]);
    const [duplicateA, duplicateB] = await Promise.all([
      app.request(signedRequest(payload, { body })),
      app.request(signedRequest(payload, { body }))
    ]);
    expect(duplicateA.status).toBe(200);
    expect(duplicateB.status).toBe(200);
    expect(events).toHaveLength(4);
    expect(outboundCalls()).toBe(0);
  });

  test('rejects missing, wrong, malformed, or tampered signatures before delivering events', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const { app } = setup({ onEvent: event => { events.push(event); } });
    const payload = envelope({ statuses: [{ id: nativeId, recipient_id: recipient, status: 'read' }] });
    const unsigned = await app.request('/webhooks/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    expect(unsigned.status).toBe(401);
    expect((await app.request(signedRequest(payload, { secret: 'different-secret' }))).status).toBe(401);
    expect((await app.request(signedRequest(payload, { signature: 'sha256=bogus' }))).status).toBe(401);

    const original = JSON.stringify(payload);
    const signature = 'sha256=' + createHmac('sha256', config.appSecret).update(original).digest('hex');
    const tampered = await app.request(signedRequest(payload, {
      body: original + ' ',
      signature
    }));
    expect(tampered.status).toBe(401);
    expect(events).toHaveLength(0);
  });

  test('rejects signed cross-brand WABA/phone events and ignores unknown status', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const { app } = setup({ onEvent: event => { events.push(event); } });
    const status = [{ id: nativeId, recipient_id: recipient, status: 'read' }];
    const wrongWaba = envelope({ statuses: status }, 'waba-other');
    const wrongPhone = envelope({ statuses: status, metadata: { phone_number_id: '90909090909' } });
    expect((await app.request(signedRequest(wrongWaba))).status).toBe(403);
    expect((await app.request(signedRequest(wrongPhone))).status).toBe(403);
    const unknownStatus = envelope({ statuses: [{ id: nativeId, recipient_id: recipient, status: 'clicked' }] });
    expect((await app.request(signedRequest(unknownStatus))).status).toBe(200);
    expect(events).toHaveLength(0);
  });

  test('routes signed failed delivery separately without forwarding sensitive provider error text', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const { app } = setup({ onEvent: event => { events.push(event); } });
    const payload = envelope({ statuses: [{
      id: nativeId, recipient_id: recipient, status: 'failed',
      errors: [{ title: 'Private provider error detail' }]
    }] });
    expect((await app.request(signedRequest(payload))).status).toBe(200);
    expect(events).toEqual([{ kind: 'delivery_failed', chatId, nativeMessageId: nativeId }]);
    expect(JSON.stringify(events)).not.toContain('Private provider error detail');
  });

  test('does not ACK meaningful events without a durable callback and retries on callback failure', async () => {
    const payload = envelope({ statuses: [{ id: nativeId, recipient_id: recipient, status: 'delivered' }] });
    const missingHandler = setup();
    expect((await missingHandler.app.request(signedRequest(payload))).status).toBe(503);

    let attempts = 0;
    const { app } = setup({ onEvent: () => {
      attempts++;
      if (attempts === 1) throw new Error('private storage failure');
    } });
    const first = await app.request(signedRequest(payload));
    expect(first.status).toBe(503);
    expect(await first.text()).not.toContain('private storage failure');
    expect((await app.request(signedRequest(payload))).status).toBe(200);
    expect((await app.request(signedRequest(payload))).status).toBe(200);
    expect(attempts).toBe(2);
  });

  test('cancels oversized chunked HTTP bodies without Content-Length before HMAC or callbacks', async () => {
    let canceled = false;
    let callbackCalls = 0;
    const { app } = setup({ onEvent: () => { callbackCalls++; } });
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(700_000)); },
      cancel() { canceled = true; }
    });
    const request = new Request('http://local.test/webhooks/meta', {
      method: 'POST',
      headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) },
      body
    });
    expect(request.headers.get('content-length')).toBeNull();
    const response = await app.request(request);
    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
    expect(callbackCalls).toBe(0);
  });

  test('does not expose exceptions from the HTTP adapter and lets the provider retry', async () => {
    const app = new Hono();
    registerMetaCloudWebhookRoutes(app, {
      handleWebhookGet() { throw new Error('private verifier exception'); },
      async handleWebhookPost() { throw new Error('private callback exception'); }
    });
    const getResponse = await app.request('/webhooks/meta');
    expect(getResponse.status).toBe(503);
    expect(await getResponse.text()).not.toContain('private verifier exception');
    const postResponse = await app.request('/webhooks/meta', { method: 'POST', body: '{}' });
    expect(postResponse.status).toBe(503);
    expect(await postResponse.text()).not.toContain('private callback exception');
  });
});
