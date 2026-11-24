import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { MetaCloudApi, type MetaCloudApiConfig, type MetaCloudWebhookEvent } from '../src/transport/meta-cloud-api';
import { transportCapabilities, supportsFeature } from '../src/transport/capabilities';
import { capabilityMatrix, resolveRuntimeProfile } from '../src/runtime-profile';

const phoneNumberId = '12345098765';
const recipient = '201112223333';
const chatId = `${recipient}@s.whatsapp.net`;
const config: MetaCloudApiConfig = {
  graphVersion: 'v24.0',
  phoneNumberId,
  businessAccountId: 'waba-123',
  accessToken: ['test', 'cloud', 'access'].join('-'),
  appSecret: ['test', 'webhook', 'secret'].join('-'),
  webhookVerifyToken: ['test', 'verify', 'code'].join('-')
};
const fixedNow = 1_785_000_000_000;

function signedWebhook(value: unknown) {
  const body = JSON.stringify(value);
  const computed = 'sha256=' + createHmac('sha256', config.appSecret).update(body).digest('hex');
  return new Request('https://local.example/api/meta/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': computed },
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

function webhookClient(onEvent: (event: MetaCloudWebhookEvent) => void) {
  return new MetaCloudApi({ config, now: () => fixedNow, onEvent });
}

describe('WA-024 transport capability contract', () => {
  test('meta-cloud does not claim reactions, voice notes or inbound media; baileys does', () => {
    const meta = transportCapabilities('meta-cloud');
    expect(supportsFeature(meta, 'reactions')).toBe(false);
    expect(supportsFeature(meta, 'voice-notes')).toBe(false);
    expect(supportsFeature(meta, 'inbound-media')).toBe(false);
    expect(supportsFeature(meta, 'text')).toBe(true);
    expect(supportsFeature(meta, 'receipts')).toBe(true);
    const baileys = transportCapabilities('baileys');
    expect(supportsFeature(baileys, 'reactions')).toBe(true);
    expect(supportsFeature(baileys, 'voice-notes')).toBe(true);
    expect(supportsFeature(baileys, 'inbound-media')).toBe(true);
  });

  test('capability matrix surfaces transport feature rows with reasons', () => {
    const profile = resolveRuntimeProfile('FULL');
    const rows = capabilityMatrix(profile, 'meta-cloud');
    const reactions = rows.find((r) => r.capability === 'feature:reactions');
    expect(reactions?.enabled).toBe(false);
    expect(reactions?.reason.length).toBeGreaterThan(0);
    const voice = rows.find((r) => r.capability === 'feature:voice-notes');
    expect(voice?.enabled).toBe(false);
    const baileysRows = capabilityMatrix(profile, 'baileys');
    expect(baileysRows.find((r) => r.capability === 'feature:reactions')?.enabled).toBe(true);
  });

  test('valid non-text meta messages surface an explicit unsupported_content event', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = webhookClient((event) => { events.push(event); });
    const payload = envelope({
      messages: [{
        id: 'wamid.HBgSIMAGE1', from: recipient, type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg' }, timestamp: '1785000000'
      }]
    });
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toEqual([{
      kind: 'unsupported_content', chatId, nativeMessageId: 'wamid.HBgSIMAGE1', messageType: 'image'
    }]);
  });

  test('structurally invalid meta messages are still dropped without an unsupported event', async () => {
    const events: MetaCloudWebhookEvent[] = [];
    const transport = webhookClient((event) => { events.push(event); });
    const payload = envelope({
      messages: [{ id: 'not-a-valid-id', from: recipient, type: 'audio', timestamp: '1785000000' }]
    });
    expect((await transport.handleWebhookPost(signedWebhook(payload))).status).toBe(200);
    expect(events).toHaveLength(0);
  });
});
