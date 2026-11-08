import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { createFableWhatsAppAgent } from '../src/index';

const META_CONFIG = {
  graphVersion: 'v23.0',
  phoneNumberId: '12345678901',
  businessAccountId: '98765432101',
  accessToken: 'test-only-access',
  appSecret: 'test-only-secret',
  webhookVerifyToken: 'test-only-verify'
};
const JID = '201011122233@s.whatsapp.net';

describe('B2 A08 to S01 official Meta runtime composition', () => {
  test('schedules one approved follow-up as a durable native-wamid S01 template intent', async () => {
    const transportRequests: unknown[] = [];
    const consentAt = Date.now() - 60_000;
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      transport: 'meta-cloud',
      capabilityAutopilotBrandId: 'store',
      metaCloud: {
        config: META_CONFIG,
        fetch: async (_url, init) => {
          transportRequests.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ messages: [{ id: 'wamid.proactive-one' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      },
      proactiveEligibility: async (trigger, now) => ({
        now,
        channel: 'meta-cloud',
        optIn: true,
        optedInAtMs: consentAt,
        templateApproved: true,
        template: { name: 'order_followup', languageCode: 'en_US' },
        timeZone: 'Africa/Cairo',
        quietHours: { from: 0, to: 0 },
        contactJid: JID,
        relevance: {
          relevant: true,
          sourceWorkflowId: trigger.sourceWorkflowId,
          verifiedAtMs: now - 1000,
          expiresAtMs: now + 30 * 60_000
        }
      })
    });
    try {
      const alias = agent.recipientDirectory!.observeAlias({ brandId: 'store', jid: JID });
      const now = Date.now();
      const triggerId = agent.capabilities.followups.schedule({
        brandId: 'store',
        contactId: alias.contactId,
        reason: 'Order status update',
        sourceWorkflowId: 'order-441',
        consentRef: 'crm-optin-20261108',
        templateRef: 'order_followup',
        dueAt: now - 1000
      });
      expect(agent.proactiveScheduler).toBeDefined();
      const first = await agent.proactiveScheduler!.runOnce(now);
      expect(first.find(result => result.triggerId === triggerId)?.status).toBe('sent');
      expect(transportRequests).toHaveLength(1);
      const sent = transportRequests[0] as { type: string; template: { name: string } };
      expect(sent.type).toBe('template');
      expect(sent.template.name).toBe('order_followup');
      const persisted = agent.capabilities.followups.get(triggerId);
      expect(persisted?.status).toBe('sent');
      expect(persisted?.receiptId).toBe('wamid.proactive-one');
      const intent = agent.memoryStore.getSendLedger().getBySource({
        sourceKind: 'autopilot',
        sourceId: 'a08:' + triggerId,
        sourceRevision: 1,
        actionKind: 'template'
      });
      expect(intent?.state).toBe('accepted');
      expect(intent?.recipientBinding?.jid).toBe(JID);
      expect(intent?.nativeMessageId).toBe('wamid.proactive-one');
      await agent.proactiveScheduler!.runOnce(now + 1000);
      expect(transportRequests).toHaveLength(1);
    } finally {
      agent.inboundPlanner?.close();
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
      agent.recipientDirectory?.close();
    }
  });

  test('revoked live consent leaves a terminal failed intent and never contacts Meta', async () => {
    let evidenceChecks = 0;
    let networkCalls = 0;
    const consentAt = Date.now() - 60_000;
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:', autoConnect: false,
      transport: 'meta-cloud', capabilityAutopilotBrandId: 'store',
      metaCloud: {
        config: META_CONFIG,
        fetch: async () => {
          networkCalls++;
          return new Response(JSON.stringify({ messages: [{ id: 'wamid.forbidden' }] }));
        }
      },
      proactiveEligibility: async (trigger, now) => ({
        now, channel: 'meta-cloud',
        optIn: ++evidenceChecks === 1,
        optedInAtMs: consentAt,
        templateApproved: true,
        template: { name: 'order_followup', languageCode: 'en_US' },
        timeZone: 'Africa/Cairo', quietHours: { from: 0, to: 0 },
        contactJid: JID,
        relevance: {
          relevant: true, sourceWorkflowId: trigger.sourceWorkflowId,
          verifiedAtMs: now - 1000, expiresAtMs: now + 30 * 60_000
        }
      })
    });
    try {
      const contact = agent.recipientDirectory!.observeAlias({ brandId: 'store', jid: JID });
      const triggerId = agent.capabilities.followups.schedule({
        brandId: 'store', contactId: contact.contactId,
        reason: 'Status', sourceWorkflowId: 'order-442',
        consentRef: 'crm-optin-442', templateRef: 'order_followup',
        dueAt: Date.now() - 1000
      });
      const result = await agent.proactiveScheduler!.runOnce();
      expect(result.find(value => value.triggerId === triggerId)?.status).toBe('skipped');
      expect(agent.capabilities.followups.get(triggerId)?.status).toBe('cancelled');
      expect(agent.capabilities.followups.get(triggerId)?.decisionReason).toBe('template_policy_denied');
      expect(evidenceChecks).toBe(2);
      expect(networkCalls).toBe(0);
      const intent = agent.memoryStore.getSendLedger().getBySource({
        sourceKind: 'autopilot', sourceId: 'a08:' + triggerId,
        sourceRevision: 1, actionKind: 'template'
      });
      expect(intent?.state).toBe('failed');
    } finally {
      agent.stopProactiveScheduler();
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
      agent.recipientDirectory?.close();
    }
  });

  test('signed inbound STOP cancels the contact follow-up and records permanent opt-out', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:', autoConnect: false, transport: 'meta-cloud',
      capabilityAutopilotBrandId: 'store',
      metaCloud: { config: META_CONFIG },
      proactiveEligibility: async (trigger, now) => ({
        now, channel: 'meta-cloud', optIn: true, optedInAtMs: now - 1000,
        templateApproved: true, template: { name: 'order_followup', languageCode: 'en_US' },
        contactJid: JID, timeZone: 'Africa/Cairo', quietHours: { from: 0, to: 0 },
        relevance: { relevant: true, sourceWorkflowId: trigger.sourceWorkflowId,
          verifiedAtMs: now - 1000, expiresAtMs: now + 30 * 60_000 }
      })
    });
    try {
      const contact = agent.recipientDirectory!.observeAlias({ brandId: 'store', jid: JID });
      const input = {
        brandId: 'store', contactId: contact.contactId, reason: 'Pending confirmation',
        sourceWorkflowId: 'order-443', consentRef: 'consent-443',
        templateRef: 'order_followup', dueAt: Date.now() + 60_000
      };
      const triggerId = agent.capabilities.followups.schedule(input);
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: META_CONFIG.businessAccountId, changes: [{
          field: 'messages', value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: META_CONFIG.phoneNumberId },
            messages: [{
              id: 'wamid.stop-one', from: JID.split('@')[0],
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text', text: { body: 'STOP' }
            }]
          }
        }] }]
      });
      const signature = 'sha256=' + createHmac('sha256', META_CONFIG.appSecret)
        .update(body).digest('hex');
      const receipt = await agent.app.request('/webhooks/meta', {
        method: 'POST', headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature
        }, body
      });
      expect(receipt.status).toBe(200);
      expect(agent.capabilities.followups.get(triggerId)?.status).toBe('cancelled');
      expect(agent.capabilities.followups.get(triggerId)?.decisionReason).toBe('opted_out');
      expect(() => agent.capabilities.followups.schedule({
        ...input, reason: 'Should never schedule'
      })).toThrow(/opted out/i);
    } finally {
      agent.stopProactiveScheduler();
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
      agent.recipientDirectory?.close();
    }
  });

  test('leaves proactive sending disabled without a trusted eligibility source', async () => {
    const agent = await createFableWhatsAppAgent({
      dataDir: ':memory:',
      autoConnect: false,
      capabilityAutopilotBrandId: 'store',
      transport: 'meta-cloud',
      metaCloud: { config: META_CONFIG }
    });
    try {
      expect(agent.proactiveScheduler).toBeUndefined();
    } finally {
      agent.burstAccumulator.destroy();
      agent.capabilities.close();
      agent.memoryStore.close();
      agent.recipientDirectory?.close();
    }
  });
});
