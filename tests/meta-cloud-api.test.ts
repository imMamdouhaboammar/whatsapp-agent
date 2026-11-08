import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test } from 'bun:test';
import { MetaCloudApi, type MetaCloudApiConfig, type MetaCloudWebhookEvent } from '../src/transport/meta-cloud-api';
import { MemoryStore } from '../src/domain/memory-store';
import { SendIntentService } from '../src/domain/send-intent-service';

const phoneNumberId = '12345098765';
const recipient = '201112223333';
const chatId = `${recipient}@s.whatsapp.net`;
const nativeId = 'wamid.HBgSMTIzNDU2Nzg5';
const config: MetaCloudApiConfig = {
  graphVersion: 'v24.0',
  phoneNumberId,
  businessAccountId: 'waba-123',
  accessToken: ['test', 'cloud', 'access'].join('-'),
  appSecret: ['test', 'webhook', 'secret'].join('-'),
  webhookVerifyToken: ['test', 'verify', 'code'].join('-')
};
const fixedNow = 1_785_000_000_000;

function fakeFetch(
  reply: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
    Response.json({ messaging_product: 'whatsapp', messages: [{ id: nativeId }] }, { status: 200 })
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return reply(call.url, call.init);
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

function client(options: {
  fetcher?: typeof fetch;
  onEvent?: (event: MetaCloudWebhookEvent) => void | Promise<void>;
  credentials?: MetaCloudApiConfig;
} = {}) {
  return new MetaCloudApi({
    config: options.credentials ?? config,
    fetch: options.fetcher,
    now: () => fixedNow,
    onEvent: options.onEvent
  });
}

function signedWebhook(value: unknown, secret = config.appSecret, signature?: string) {
  const body = JSON.stringify(value);
  const computed = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return new Request('https://local.example/api/meta/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature ?? computed
    },
    body
  });
}

function envelope(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-123',
      changes: [{
        field: 'messages',
        value: { metadata: { phone_number_id: phoneNumberId }, ...value }
      }]
    }]
  };
}

describe('Meta Cloud API outbound transport', () => {
  test('sends an ordinary text only inside a proven customer service window, using native message ID', async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = client({ fetcher });
    const sent = await transport.sendText({
      to: chatId,
      text: 'Can I help with your order?',
      lastInboundAtMs: fixedNow - 30_000
    });
    expect(sent).toEqual({ messageId: nativeId });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://graph.facebook.com/v24.0/${phoneNumberId}/messages`);
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.accessToken}`);
    const json = JSON.parse(String(calls[0]?.init.body));
    expect(json).toEqual({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: 'Can I help with your order?', preview_url: false }
    });
  });

  test('rejects text outside the customer service window and rejects group/LID recipients before HTTP', async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = client({ fetcher });
    await expect(transport.sendText({
      to: chatId, text: 'late reply', lastInboundAtMs: fixedNow - 24 * 60 * 60 * 1000
    })).rejects.toThrow();
    await expect(transport.sendText({
      to: '5511999@g.us', text: 'group text', lastInboundAtMs: fixedNow - 1_000
    })).rejects.toThrow();
    await expect(transport.sendText({
      to: '849201@lid', text: 'lid alias', lastInboundAtMs: fixedNow - 1_000
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test('sends an approved consented template with text parameters through the same Meta endpoint', async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = client({ fetcher });
    const accepted = await transport.sendTemplate({
      to: recipient,
      template: {
        name: 'order_update', languageCode: 'ar',
        components: [{ type: 'body', parameters: [{ type: 'text', text: '441' }] }]
      },
      eligibility: { optedInAtMs: fixedNow - 1_000, approvedTemplate: true }
    });
    expect(accepted).toEqual({ messageId: nativeId });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      messaging_product: 'whatsapp', to: recipient, type: 'template',
      template: {
        name: 'order_update', language: { code: 'ar' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: '441' }] }]
      }
    });
  });

  test('requires real opt-in evidence and approved template, and does not make HTTP requests on invalid input', async () => {
    const { fetcher, calls } = fakeFetch();
    const transport = client({ fetcher });
    const base = { to: recipient, template: { name: 'order_update', languageCode: 'en_US' } };
    await expect(transport.sendTemplate({
      ...base, eligibility: { optedInAtMs: 0, approvedTemplate: true }
    })).rejects.toThrow();
    await expect(transport.sendTemplate({
      ...base, eligibility: { optedInAtMs: fixedNow + 30_000, approvedTemplate: true }
    })).rejects.toThrow();
    await expect(transport.sendTemplate({
      ...base, eligibility: { optedInAtMs: fixedNow - 1_000, approvedTemplate: false }
    })).rejects.toThrow();
    await expect(transport.sendTemplate({
      ...base, template: { name: 'not valid!', languageCode: 'en_US' },
      eligibility: { optedInAtMs: fixedNow - 1_000, approvedTemplate: true }
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('Meta Cloud API native identifiers', () => {
  test('retains genuine padded Base64 wamid values from send responses and signed receipts', async () => {
    const paddedId = 'wamid.HBgLMTgwOTEyMzQ1NjcVAgASGBQzRUIwMEY2QjBCNDY2N0YwMzAzMAA=';
    const { fetcher } = fakeFetch(() => Response.json({ messages: [{ id: paddedId }] }));
    const accepted = await client({ fetcher }).sendText({
      to: recipient, text: 'hello', lastInboundAtMs: fixedNow - 1_000
    });
    expect(accepted.messageId).toBe(paddedId);
    const events: MetaCloudWebhookEvent[] = [];
    const inbound = client({ onEvent: event => { events.push(event); } });
    const payload = envelope({ statuses: [{ id: paddedId, status: 'read', recipient_id: recipient }] });
    expect((await inbound.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toEqual([{ kind: 'receipt', chatId, nativeMessageId: paddedId, status: 'read' }]);
  });
});

describe('Meta Cloud API authenticated webhooks', () => {
  test('verifies GET subscription challenge and rejects wrong token or mode', () => {
    const transport = client();
    const good = new URL('https://local.example/api/meta/webhook');
    good.searchParams.set('hub.mode', 'subscribe');
    good.searchParams.set('hub.verify_token', config.webhookVerifyToken);
    good.searchParams.set('hub.challenge', '0123456789');
    const ok = transport.handleWebhookGet(new Request(good));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toContain('text/plain');
    return Promise.all([
      ok.text().then(text => expect(text).toBe('0123456789')),
      (async () => {
        good.searchParams.set('hub.verify_token', 'wrong-verification');
        expect(transport.handleWebhookGet(new Request(good)).status).toBe(403);
        good.searchParams.set('hub.verify_token', config.webhookVerifyToken);
        good.searchParams.set('hub.mode', 'different');
        expect(transport.handleWebhookGet(new Request(good)).status).toBe(403);
      })()
    ]);
  });

  test('accepts exact-byte signed inbox messages and native receipts, with duplicate suppression', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: event => { events.push(event); } });
    const payload = envelope({
      messages: [{
        id: 'wamid.HBgSINBOUND1', from: recipient, type: 'text',
        text: { body: 'مرحبا 👋' }, timestamp: '1785000000'
      }],
      statuses: [
        { id: nativeId, status: 'sent', recipient_id: recipient, timestamp: '1785000001' },
        { id: nativeId, status: 'delivered', recipient_id: recipient, timestamp: '1785000002' }
      ]
    });
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toEqual([
      { kind: 'inbound_text', chatId, nativeMessageId: 'wamid.HBgSINBOUND1', text: 'مرحبا 👋', timestampMs: 1_785_000_000_000 },
      { kind: 'receipt', chatId, nativeMessageId: nativeId, status: 'sent' },
      { kind: 'receipt', chatId, nativeMessageId: nativeId, status: 'delivered' }
    ]);
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toHaveLength(3);
  });

  test('does not acknowledge a meaningful event without a durable sink or bound WABA', async () => {
    const payload = envelope({ statuses: [{ id: nativeId, status: 'sent', recipient_id: recipient }] });
    expect((await client().handleWebhookPost(signedWebhook(payload))).status).toBe(503);
    const unbound = client({
      credentials: { ...config, businessAccountId: undefined }, onEvent: () => {}
    });
    expect((await unbound.handleWebhookPost(signedWebhook(payload))).status).toBe(503);
  });

  test('serializes concurrent signed webhook retries to suppress duplicate callback delivery', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: async event => {
      await Promise.resolve();
      events.push(event);
    } });
    const payload = envelope({ statuses: [{ id: nativeId, status: 'sent', recipient_id: recipient }] });
    const [first, second] = await Promise.all([
      transport.handleWebhookPost(signedWebhook(payload)),
      transport.handleWebhookPost(signedWebhook(payload))
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  test('ignores malformed inbound timestamps instead of promoting invalid customer-service evidence', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: event => { events.push(event); } });
    const payload = envelope({ messages: [
      { id: 'wamid.MSG1', from: recipient, type: 'text', text: { body: 'hi' }, timestamp: '9007199254741' },
      { id: 'wamid.MSG2', from: recipient, type: 'text', text: { body: 'hi' }, timestamp: 'NaN' },
      { id: 'wamid.MSG3', from: recipient, type: 'text', text: { body: 'hi' }, timestamp: '-10' }
    ] });
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toHaveLength(0);
  });

  test('rejects tampered bytes, absent signature and malformed signature before callbacks', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: event => { events.push(event); } });
    const payload = envelope({ statuses: [
      { id: nativeId, status: 'read', recipient_id: recipient, timestamp: '1785000003' }
    ] });
    expect((await transport.handleWebhookPost(signedWebhook(payload, 'different-signing-secret'))).status).toBe(401);
    expect((await transport.handleWebhookPost(signedWebhook(payload, config.appSecret, 'sha256=bad'))).status).toBe(401);
    expect((await transport.handleWebhookPost(new Request('https://local.example/api/meta/webhook', {
      method: 'POST', body: JSON.stringify(payload)
    }))).status).toBe(401);
    expect(events).toHaveLength(0);
  });

  test('does not route a signed webhook for a different Meta business number or WABA', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: event => { events.push(event); }, credentials: {
      ...config, businessAccountId: 'waba-123'
    } });
    const wrongPhone = envelope({
      metadata: { phone_number_id: '99999000000' },
      statuses: [{ id: nativeId, status: 'read', recipient_id: recipient }]
    });
    const wrongWaba = {
      ...envelope({ statuses: [{ id: nativeId, status: 'read', recipient_id: recipient }] }),
      entry: [{
        id: 'waba-999',
        changes: [{ field: 'messages', value: {
          metadata: { phone_number_id: phoneNumberId },
          statuses: [{ id: nativeId, status: 'read', recipient_id: recipient }]
        } }]
      }]
    };
    expect((await transport.handleWebhookPost(signedWebhook(wrongPhone))).status).toBe(403);
    expect((await transport.handleWebhookPost(signedWebhook(wrongWaba))).status).toBe(403);
    expect(events).toHaveLength(0);
  });

  test('retries a failed processing callback without marking the event as handled', async () => {
    let attempts = 0;
    const transport = client({
      onEvent: () => { attempts++; if (attempts === 1) throw new Error('internal callback detail'); }
    });
    const payload = envelope({ statuses: [
      { id: nativeId, status: 'read', recipient_id: recipient, timestamp: '1785000003' }
    ] });
    const failed = await transport.handleWebhookPost(signedWebhook(payload));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('internal callback detail');
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(attempts).toBe(2);
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(attempts).toBe(2);
  });

  test('maps verified delivered/read receipts through S01 native-id correlation and monotonic states', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:' });
    try {
      const service = new SendIntentService({
        memoryStore,
        sendText: async () => ({ messageId: nativeId })
      });
      const sent = await service.sendText({
        sourceKind: 'ui', sourceId: 'meta-transport-s01-test', sourceRevision: 1,
        actionKind: 'text', chatId, text: 'Order update', policyRevision: 1
      });
      expect(sent.intent.state).toBe('accepted');
      const transport = client({ onEvent: event => {
        if (event.kind === 'receipt') service.receipt(event.chatId, event.nativeMessageId, event.status);
      } });
      const read = envelope({ statuses: [
        { id: nativeId, status: 'read', recipient_id: recipient, timestamp: '1785000003' },
        { id: nativeId, status: 'delivered', recipient_id: recipient, timestamp: '1785000002' }
      ] });
      expect((await transport.handleWebhookPost(signedWebhook(read))).status).toBe(200);
      expect(memoryStore.getSendLedger().getIntent(sent.intent.id)?.state).toBe('read');
      const wrongChat = envelope({ statuses: [
        { id: nativeId, status: 'sent', recipient_id: '441234567890', timestamp: '1785000001' }
      ] });
      expect((await transport.handleWebhookPost(signedWebhook(wrongChat))).status).toBe(200);
      expect(memoryStore.getSendLedger().getIntent(sent.intent.id)?.state).toBe('read');
    } finally {
      memoryStore.close();
    }
  });

  test('reports failed delivery separately and safely ignores unknown statuses', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: event => { events.push(event); } });
    const payload = envelope({ statuses: [
      { id: nativeId, status: 'failed', recipient_id: recipient, errors: [{ code: 131026, title: 'private detail' }] },
      { id: nativeId, status: 'clicked', recipient_id: recipient }
    ] });
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toEqual([{ kind: 'delivery_failed', chatId, nativeMessageId: nativeId }]);
    expect(JSON.stringify(events)).not.toContain('private detail');
  });

  test('rejects validly signed oversized and malformed JSON payloads before routing', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = client({ onEvent: event => { events.push(event); } });
    const invalidJson = '{not-json';
    const invalidSignature = 'sha256=' + createHmac('sha256', config.appSecret).update(invalidJson).digest('hex');
    const malformed = await transport.handleWebhookPost(new Request('https://local.example/api/meta/webhook', {
      method: 'POST', headers: { 'X-Hub-Signature-256': invalidSignature }, body: invalidJson
    }));
    expect(malformed.status).toBe(400);
    const huge = JSON.stringify({ filler: 'x'.repeat(1_100_000) });
    const hugeSignature = 'sha256=' + createHmac('sha256', config.appSecret).update(huge).digest('hex');
    const oversized = await transport.handleWebhookPost(new Request('https://local.example/api/meta/webhook', {
      method: 'POST', headers: { 'X-Hub-Signature-256': hugeSignature }, body: huge
    }));
    expect(oversized.status).toBe(413);
    expect(events).toHaveLength(0);
  });

  test('cancels a streaming request as soon as it exceeds the body limit without Content-Length', async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(700_000)); },
      cancel() { canceled = true; }
    });
    const request = new Request('https://local.example/api/meta/webhook', {
      method: 'POST',
      headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) },
      body: stream
    });
    expect(request.headers.get('Content-Length')).toBeNull();
    const result = await client().handleWebhookPost(request);
    expect(result.status).toBe(413);
    expect(canceled).toBe(true);
  });
});

describe('Meta Cloud API acceptance ambiguity', () => {
  test('never fabricates a native message ID after missing, failed or ambiguous provider responses', async () => {
    const noId = client({ fetcher: fakeFetch(() => Response.json({ messages: [{}] })).fetcher });
    const rejected = client({ fetcher: fakeFetch(() => Response.json({
      error: { message: 'provider message with sensitive data' }
    }, { status: 403 })).fetcher });
    const timedOut = client({ fetcher: (async () => { throw new Error('internal credential detail'); }) as typeof fetch });
    const input = { to: recipient, text: 'Hi', lastInboundAtMs: fixedNow - 1_000 };
    for (const transport of [noId, rejected, timedOut]) {
      try {
        await transport.sendText(input);
        throw new Error('Expected ambiguous delivery');
      } catch (error) {
        expect(error).toMatchObject({ code: 'WHATSAPP_ACCEPTANCE_AMBIGUOUS' });
        expect(String(error)).not.toContain('sensitive data');
        expect(String(error)).not.toContain('credential detail');
        expect(String(error)).not.toContain(config.accessToken);
      }
    }
  });
});
