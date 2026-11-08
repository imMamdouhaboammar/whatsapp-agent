import { describe, expect, test } from 'bun:test';
import { MemoryStore } from '../src/domain/memory-store';
import { SendIntentService } from '../src/domain/send-intent-service';
import { ContactIdentityDirectory } from '../src/identity/contact-directory';
import type { SendTemplateIntentInput } from '../src/domain/send-ledger';

const brandId = 'brand-alpha';
const jid = '201112223334@s.whatsapp.net';
const now = Date.now();

const templateInput = (changes: Partial<SendTemplateIntentInput> = {}): SendTemplateIntentInput => ({
  sourceKind: 'autopilot',
  sourceId: 'a08:delivery-42',
  sourceRevision: 1,
  actionKind: 'template' as const,
  chatId: jid,
  text: '',
  policyRevision: 7,
  expiresAt: now + 60_000,
  template: {
    name: 'delivery_update',
    languageCode: 'en_US',
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Order 42' }] }]
  },
  templateEligibility: {
    consentRef: 'consent-order-42',
    optedInAtMs: now - 86_400_000,
    sourceWorkflowId: 'delivery-42',
    relevanceVerifiedAtMs: now - 1_000,
    quietHours: { from: 0, to: 0, timeZone: 'UTC' }
  },
  ...changes
});

const liveEvidence = () => ({
  consentRef: 'consent-order-42',
  optedInAtMs: now - 86_400_000,
  approvedTemplate: { name: 'delivery_update', languageCode: 'en_US' },
  sourceWorkflowId: 'delivery-42',
  relevant: true,
  relevanceVerifiedAtMs: Date.now(),
  relevanceExpiresAtMs: Date.now() + 30_000,
  quietHours: { from: 0, to: 0, timeZone: 'UTC' }
});

describe('S01 approved Meta template and S07 durable binding', () => {
  test('persists template, consent and immutable S07 recipient before a single native wamid send', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory();
    try {
      const contact = directory.observeAlias({ brandId, jid });
      const sent: unknown[] = [];
      // First-contact proactivity must be eligible before any local conversation exists.
      expect(memory.getChat(jid)).toBeUndefined();
      const service = new SendIntentService({
        memoryStore: memory,
        brandId,
        recipientDirectory: directory,
        verifyTemplateEligibility: async () => liveEvidence(),
        sendText: async () => { throw new Error('freeform transport forbidden'); },
        sendTemplate: async (payload) => {
          sent.push(payload);
          return { messageId: 'wamid.proactive.delivery' };
        }
      });
      const first = await service.sendTemplate(templateInput());
      const duplicate = await service.sendTemplate(templateInput());
      expect(first.intent.id).toBe(duplicate.intent.id);
      expect(first.intent.state).toBe('accepted');
      expect(first.intent.nativeMessageId).toBe('wamid.proactive.delivery');
      expect(first.intent.recipientBinding).toMatchObject({
        brandId, jid, contactId: contact.contactId, aliasId: contact.aliasId, identityVersion: contact.version
      });
      expect(first.intent.template).toEqual(templateInput().template);
      expect(first.intent.templateEligibility).toEqual(templateInput().templateEligibility);
      expect(memory.getSendLedger().getIntent(first.intent.id)?.recipientBinding).toEqual(first.intent.recipientBinding!);
      expect(sent).toEqual([{
        to: '201112223334',
        template: templateInput().template,
        eligibility: { optedInAtMs: now - 86_400_000, approvedTemplate: true }
      }]);
      await expect(service.sendTemplate(templateInput({
        template: { name: 'delivery_update', languageCode: 'en_US', components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Tampered order' }] }
        ] }
      }))).rejects.toThrow(/conflict/i);
      expect(sent).toHaveLength(1);
    } finally { memory.close(); directory.close(); }
  });

  test('ambiguous template outcomes are never automatically retried or manually replayed', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory();
    try {
      directory.observeAlias({ brandId, jid });
      let requests = 0;
      const service = new SendIntentService({
        memoryStore: memory,
        brandId,
        recipientDirectory: directory,
        verifyTemplateEligibility: async () => liveEvidence(),
        sendText: async () => { throw new Error('freeform forbidden'); },
        sendTemplate: async () => { requests++; throw new Error('Unknown provider outcome'); }
      });
      const first = await service.sendTemplate(templateInput());
      expect(first.intent.state).toBe('uncertain');
      const second = await service.sendTemplate(templateInput());
      expect(second.intent.id).toBe(first.intent.id);
      expect(second.intent.state).toBe('uncertain');
      await service.dispatchDue(Date.now() + 10_000);
      expect(requests).toBe(1);
      await expect(service.retryUncertain(first.intent.id, 'manual-repeat')).rejects.toThrow(/template/i);
      expect(requests).toBe(1);
      expect(memory.getSendLedger().getAttempts(first.intent.id)).toHaveLength(1);
    } finally { memory.close(); directory.close(); }
  });
});

describe('S01 S07 immutable destination and trusted policy refusal', () => {
  test('fails a queued template permanently if identity changes after the durable binding was captured', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      const secondJid = '201112223335@s.whatsapp.net';
      directory.observeAlias({ brandId, jid });
      directory.observeAlias({ brandId, jid: secondJid });
      const queued = memory.getSendLedger().createIntent({
        ...templateInput(),
        recipientBinding: directory.bindRecipient({ brandId, jid })
      });
      const originalBinding = queued.recipientBinding;
      directory.verifyAliasRelationship({
        brandId, primaryJid: secondJid, relatedJid: jid,
        source: 'provider_verified', evidenceRef: 'provider-confirmed-contact-042'
      });
      let calls = 0;
      const service = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        verifyTemplateEligibility: async () => liveEvidence(),
        sendText: async () => { throw new Error('freeform forbidden'); },
        sendTemplate: async () => { calls++; return { messageId: 'forbidden' }; }
      });
      const result = await service.dispatch(queued.id);
      expect(result.intent.state).toBe('failed');
      expect(result.intent.recipientBinding).toEqual(originalBinding!);
      expect(memory.getSendLedger().getEvents(queued.id).at(-1)?.reason).toBe('recipient_binding_changed');
      expect(memory.getSendLedger().getAttempts(queued.id)[0]?.networkStartedAt).toBeUndefined();
      await service.dispatchDue(Date.now() + 60_000);
      expect(calls).toBe(0);
    } finally { memory.close(); directory.close(); }
  });

  test('revalidates S07 after async voice preparation and blocks an identity merge before networking', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory({ verifyEvidence: () => true });
    try {
      const secondJid = '201112223335@s.whatsapp.net';
      directory.observeAlias({ brandId, jid });
      directory.observeAlias({ brandId, jid: secondJid });
      let sends = 0;
      const service = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        sendText: async () => { throw new Error('text forbidden'); },
        prepareVoice: async () => {
          directory.verifyAliasRelationship({
            brandId, primaryJid: secondJid, relatedJid: jid,
            source: 'owner_verified', evidenceRef: 'owner-confirmed-voice-001'
          });
          return new Uint8Array([7, 8]);
        },
        sendVoice: async () => { sends++; return { messageId: 'unintended' }; }
      });
      const result = await service.sendVoice({
        sourceKind: 'ui', sourceId: 'voice-after-merge', sourceRevision: 1,
        actionKind: 'voice', chatId: jid, text: 'hello', policyRevision: 1
      });
      expect(result.intent.state).toBe('failed');
      expect(memory.getSendLedger().getEvents(result.intent.id).at(-1)?.reason).toBe('recipient_binding_changed');
      expect(memory.getSendLedger().getAttempts(result.intent.id)[0]?.networkStartedAt).toBeUndefined();
      expect(sends).toBe(0);
    } finally { memory.close(); directory.close(); }
  });

  test('fails an existing unbound text intent when S07 is configured, without using the old destination', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory();
    try {
      directory.observeAlias({ brandId, jid });
      const queued = memory.getSendLedger().createIntent({
        sourceKind: 'ui', sourceId: 'old-queued', sourceRevision: 1,
        actionKind: 'text', chatId: jid, text: 'text from old queue', policyRevision: 1
      });
      let calls = 0;
      const service = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        sendText: async () => { calls++; return { messageId: 'unexpected' }; }
      });
      const sent = await service.dispatch(queued.id);
      expect(sent.intent.state).toBe('failed');
      expect(memory.getSendLedger().getEvents(queued.id).at(-1)?.reason).toBe('recipient_binding_changed');
      expect(calls).toBe(0);
    } finally { memory.close(); directory.close(); }
  });

  test('a caller-reported template approval cannot replace trusted current provider consent', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory();
    try {
      directory.observeAlias({ brandId, jid });
      let calls = 0;
      const service = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        sendText: async () => { throw new Error('text forbidden'); },
        verifyTemplateEligibility: async () => ({ ...liveEvidence(), consentRef: 'revoked-consent' }),
        sendTemplate: async () => { calls++; return { messageId: 'forbidden' }; }
      });
      const result = await service.sendTemplate(templateInput());
      expect(result.intent.state).toBe('failed');
      expect(memory.getSendLedger().getEvents(result.intent.id).at(-1)?.reason).toBe('template_policy_denied');
      expect(calls).toBe(0);
      const unverified = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        sendText: async () => { throw new Error('text forbidden'); },
        sendTemplate: async () => { calls++; return { messageId: 'forbidden' }; }
      });
      await expect(unverified.sendTemplate(templateInput({ sourceId: 'missing-verifier' })))
        .rejects.toThrow(/trusted authorization/i);
      expect(calls).toBe(0);
    } finally { memory.close(); directory.close(); }
  });

  test('trusted brand quiet hours prohibit sends even when queued payload claims no quiet hours', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory();
    try {
      directory.observeAlias({ brandId, jid });
      let calls = 0;
      const service = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        sendText: async () => { throw new Error('text forbidden'); },
        verifyTemplateEligibility: async () => ({ ...liveEvidence(), quietHours: { from: 0, to: 24, timeZone: 'UTC' } }),
        sendTemplate: async () => { calls++; return { messageId: 'forbidden' }; }
      });
      const result = await service.sendTemplate(templateInput());
      expect(result.intent.state).toBe('failed');
      expect(memory.getSendLedger().getEvents(result.intent.id).at(-1)?.reason).toBe('template_policy_denied');
      expect(calls).toBe(0);
    } finally { memory.close(); directory.close(); }
  });
});

test('a first-contact template uses trusted brand authorization without weakening autopilot freeform controls', async () => {
  const memory = new MemoryStore({ dataDir: ':memory:' });
  const directory = new ContactIdentityDirectory();
  try {
    directory.observeAlias({ brandId, jid });
    let freeform = 0;
    let templates = 0;
    const service = new SendIntentService({
      memoryStore: memory, brandId, recipientDirectory: directory,
      verifyTemplateEligibility: async () => liveEvidence(),
      sendText: async () => { freeform++; return { messageId: 'blocked-freeform' }; },
      sendTemplate: async () => { templates++; return { messageId: 'wamid.first-contact' }; }
    });
    await expect(service.sendText({
      sourceKind: 'autopilot', sourceId: 'unsolicited-text', sourceRevision: 1,
      actionKind: 'text', chatId: jid, text: 'Unsolicited message', policyRevision: 1
    })).rejects.toThrow(/chat mode/i);
    expect(memory.getSendLedger().getBySource({
      sourceKind: 'autopilot', sourceId: 'unsolicited-text', sourceRevision: 1, actionKind: 'text'
    })).toBeUndefined();
    expect(freeform).toBe(0);
    expect(memory.getChat(jid)).toBeUndefined();
    const result = await service.sendTemplate(templateInput());
    expect(result.intent.state).toBe('accepted');
    expect(result.intent.nativeMessageId).toBe('wamid.first-contact');
    expect(templates).toBe(1);
  } finally { memory.close(); directory.close(); }
});

describe('S01 native Meta failure receipts', () => {
  test('a correlated delivery_failed after provider acceptance becomes a terminal audited state, without retry', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const directory = new ContactIdentityDirectory();
    try {
      directory.observeAlias({ brandId, jid });
      let sends = 0;
      const service = new SendIntentService({
        memoryStore: memory, brandId, recipientDirectory: directory,
        sendText: async () => { throw new Error('text forbidden'); },
        verifyTemplateEligibility: async () => liveEvidence(),
        sendTemplate: async () => { sends++; return { messageId: 'wamid.delivery-failed' }; }
      });
      const accepted = await service.sendTemplate(templateInput({ sourceId: 'failure-status' }));
      expect(accepted.intent.state).toBe('accepted');
      expect(memory.getSendLedger().advanceReceipt(jid, 'wamid.delivery-failed', 'delivered')?.state).toBe('delivered');
      const failed = service.deliveryFailed(jid, 'wamid.delivery-failed');
      expect(failed?.state).toBe('failed');
      expect(memory.getSendLedger().getIntent(accepted.intent.id)?.state).toBe('failed');
      expect(memory.getSendLedger().getEvents(accepted.intent.id).at(-1)?.reason).toBe('provider_delivery_failed');
      expect(service.deliveryFailed(jid, 'wamid.delivery-failed')).toBeUndefined();
      await service.dispatchDue(Date.now() + 60_000);
      expect(sends).toBe(1);
    } finally { memory.close(); directory.close(); }
  });

  test('delivery_failed cannot overwrite a read receipt or affect another native ID', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    try {
      const service = new SendIntentService({
        memoryStore: memory,
        sendText: async () => ({ messageId: 'wamid.read-safe' })
      });
      const original = await service.sendText({
        sourceKind: 'ui', sourceId: 'read-terminal', sourceRevision: 1,
        actionKind: 'text', chatId: jid, text: 'hello', policyRevision: 1
      });
      expect(memory.getSendLedger().advanceReceipt(jid, 'wamid.read-safe', 'read')?.state).toBe('read');
      expect(service.deliveryFailed(jid, 'wamid.read-safe')).toBeUndefined();
      expect(service.deliveryFailed(jid, 'wamid.not-matching')).toBeUndefined();
      expect(service.deliveryFailed('441234567890@s.whatsapp.net', 'wamid.read-safe')).toBeUndefined();
      expect(memory.getSendLedger().getIntent(original.intent.id)?.state).toBe('read');
    } finally { memory.close(); }
  });
});
