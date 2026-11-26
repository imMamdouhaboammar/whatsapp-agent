import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { isRecord } from '../src/mcp/records';
import { BroadcastComposer } from '../src/agent/broadcast-composer';
import { BroadcastOrchestrator } from '../src/agent/broadcast-orchestrator';
import { registerBroadcastTools } from '../src/agent/broadcast-tools';
import { ActionJournal, ToolRegistry } from '../src/agent/tools';
import { MemoryStore } from '../src/domain/memory-store';
import { registerBroadcastRoutes } from '../src/server/broadcast-routes';
import { MetaCloudApi } from '../src/transport/meta-cloud-api';

function seedConnectedChat(store: MemoryStore, chatId: string, name: string, lastInboundAtMs: number) {
  store.saveChat({
    id: chatId,
    name,
    phoneNumber: chatId.replace(/@.*/, ''),
    unreadCount: 0,
    lastMessage: 'Interested in pricing',
    lastTimestamp: lastInboundAtMs,
    isGroup: false,
    agentMode: 'autopilot',
  });
  store.addMessage({
    id: `msg-${chatId}-1`,
    chatId,
    sender: chatId,
    senderName: name,
    text: 'Interested in pricing',
    timestamp: lastInboundAtMs,
    isFromMe: false,
    type: 'text',
  });
}

describe('Smart Agentic Broadcast System', () => {
  test('filters strictly by previous connection, excludes groups and opt-outs', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const broadcastStore = memoryStore.getBroadcastStore();
    const now = Date.now();

    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'Ahmed Ali', now - 3_600_000);
    seedConnectedChat(memoryStore, '201009998877@s.whatsapp.net', 'Sara Hassan', now - 7_200_000);
    // Group chat should be excluded
    memoryStore.saveChat({ id: '120363000@g.us', name: 'VIP Group', isGroup: true, unreadCount: 0, lastTimestamp: now, agentMode: 'autopilot' });
    // Chat with no messages and no timestamp should be excluded
    memoryStore.saveChat({ id: '201000000000@s.whatsapp.net', name: 'Cold Lead', isGroup: false, unreadCount: 0, agentMode: 'autopilot' });

    broadcastStore.markOptOut('201009998877@s.whatsapp.net', 'user_requested', now);

    const eligible = broadcastStore.findEligibleAudience({}, now);
    expect(eligible.map((c) => c.chatId)).toEqual(['201001112233@s.whatsapp.net']);
    memoryStore.close();
  });

  test('supports preview_approve workflow with Baileys rich media and skip/edit', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const broadcastStore = memoryStore.getBroadcastStore();
    const now = Date.now();

    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'Ahmed', now - 1000);
    seedConnectedChat(memoryStore, '201004445566@s.whatsapp.net', 'Mona', now - 2000);

    const sentMedia: Array<{ chatId: string; kind: string; caption?: string }> = [];
    const orchestrator = new BroadcastOrchestrator({
      store: broadcastStore,
      memoryStore,
      composer: new BroadcastComposer({ brandName: 'Fable' }),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async () => ({ messageId: 'wa-text-1' }),
        sendVoiceNote: async () => ({ messageId: 'wa-voice-1' }),
        sendRichMedia: async (chatId, media) => {
          sentMedia.push({ chatId, kind: media.kind, caption: media.caption });
          return { messageId: `wa-media-${sentMedia.length}` };
        },
      },
      defaultTransport: 'baileys',
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Spring Promo',
      goal: 'New 20% discount for {{name}}',
      approvalMode: 'preview_approve',
      richContent: {
        kind: 'image',
        messageGoal: 'New 20% discount for {{name}}',
        mediaBase64: Buffer.from('fake-png').toString('base64'),
        mimeType: 'image/png',
      },
      pacing: { minDelayMs: 0, maxDelayMs: 0 },
    });

    expect(created.campaign.status).toBe('draft');
    expect(created.recipients.length).toBe(2);
    expect(sentMedia.length).toBe(0);

    // Edit first recipient and skip second
    const [first, second] = created.recipients;
    if (!first || !second) throw new Error('Expected 2 recipients');
    broadcastStore.updateRecipientDraft(first.id, { personalizedText: 'Custom offer for Ahmed!' });
    broadcastStore.updateRecipientDraft(second.id, { status: 'skipped' });

    orchestrator.approveCampaign(created.campaign.id);
    await orchestrator.startDispatchInBackground(created.campaign.id);

    expect(sentMedia).toEqual([
      { chatId: '201001112233@s.whatsapp.net', kind: 'image', caption: 'Custom offer for Ahmed!' },
    ]);
    const finalCampaign = broadcastStore.getCampaign(created.campaign.id);
    expect(finalCampaign?.status).toBe('completed');
    memoryStore.close();
  });

  test('routes Meta Cloud outside-24h to rich template and within-24h to rich media', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const broadcastStore = memoryStore.getBroadcastStore();
    const now = 1_700_000_000_000;

    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'Recent User', now - 60 * 60 * 1000);
    seedConnectedChat(memoryStore, '201007778899@s.whatsapp.net', 'Older User', now - 48 * 60 * 60 * 1000);

    const payloads: Array<{ type: string; to: string }> = [];
    const metaClient = new MetaCloudApi({
      config: {
        graphVersion: 'v21.0',
        phoneNumberId: '123456789',
        accessToken: ['meta', 'token', 'test'].join('-'),
        appSecret: ['app', 'secret', 'test'].join('-'),
        webhookVerifyToken: 'verify-token',
      },
      now: () => now,
      fetch: async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON transport payload');
        const body: unknown = JSON.parse(init.body);
        if (!isRecord(body) || typeof body.type !== 'string' || typeof body.to !== 'string') {
          throw new Error('Expected a transport message type and recipient');
        }
        payloads.push({ type: body.type, to: body.to });
        return new Response(JSON.stringify({ messages: [{ id: `wamid.test_${payloads.length}` }] }), { status: 200 });
      },
    });

    const orchestrator = new BroadcastOrchestrator({
      store: broadcastStore,
      memoryStore,
      composer: new BroadcastComposer(),
      metaClient,
      defaultTransport: 'meta-cloud',
      now: () => now,
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Meta Hybrid',
      goal: 'Check out our new catalog',
      transport: 'meta-cloud',
      approvalMode: 'autonomous',
      richContent: {
        kind: 'image',
        messageGoal: 'Check out our new catalog',
        mediaUrl: 'https://example.com/catalog.jpg',
        templateName: 'catalog_update',
        templateLanguage: 'en_US',
        templateHeaderMediaType: 'image',
        templateHeaderMediaUrl: 'https://example.com/catalog.jpg',
        templateButtons: [{ type: 'url', text: 'View', urlOrPayload: 'offer-2026' }],
      },
      pacing: { minDelayMs: 0, maxDelayMs: 0 },
    });

    await orchestrator.startDispatchInBackground(created.campaign.id);

    expect(payloads).toEqual([
      { type: 'image', to: '201001112233' },
      { type: 'template', to: '201007778899' },
    ]);
    memoryStore.close();
  });

  test('schedules follow-up on read receipt, cancels on reply, and handles opt-out', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const broadcastStore = memoryStore.getBroadcastStore();
    let clock = 1_700_000_000_000;

    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'ReadNoReply', clock - 1000);
    seedConnectedChat(memoryStore, '201002223344@s.whatsapp.net', 'RepliedUser', clock - 1000);

    const sentTexts: Array<{ chatId: string; text: string }> = [];
    const orchestrator = new BroadcastOrchestrator({
      store: broadcastStore,
      memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async (chatId, text) => {
          sentTexts.push({ chatId, text });
          return { messageId: `msg-sent-${sentTexts.length}` };
        },
        sendVoiceNote: async () => ({ messageId: 'voice-1' }),
        sendRichMedia: async () => ({ messageId: 'media-1' }),
      },
      defaultTransport: 'baileys',
      now: () => clock,
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'FollowUp Test',
      goal: 'Special offer for {{name}}',
      approvalMode: 'autonomous',
      richContent: { kind: 'text', messageGoal: 'Special offer for {{name}}' },
      followUp: { enabled: true, delayMinutes: 30, maxFollowUps: 1, triggerOn: 'read_no_reply', messagePrompt: 'Checking in' },
      pacing: { minDelayMs: 0, maxDelayMs: 0 },
    });
    await orchestrator.startDispatchInBackground(created.campaign.id);

    // Both read the message
    orchestrator.onMessageReceipt('msg-sent-1', 'read');
    orchestrator.onMessageReceipt('msg-sent-2', 'read');

    // Second user replies, cancelling their follow-up
    orchestrator.onInboundMessage('201002223344@s.whatsapp.net', 'Yes, send details!');

    // Advance clock 31 minutes and tick follow-ups
    clock += 31 * 60_000;
    const processed = await orchestrator.tickFollowUps();
    expect(processed).toBe(1);
    expect(sentTexts.length).toBe(3);
    expect(sentTexts[2]?.chatId).toBe('201001112233@s.whatsapp.net');

    // Opt-out keyword blocks future broadcasts
    orchestrator.onInboundMessage('201001112233@s.whatsapp.net', 'STOP');
    expect(broadcastStore.isOptedOut('201001112233@s.whatsapp.net')).toBe(true);
    memoryStore.close();
  });

  test('exposes HTTP API routes and agent tools', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const broadcastStore = memoryStore.getBroadcastStore();
    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'Laila', Date.now() - 5000);

    const orchestrator = new BroadcastOrchestrator({
      store: broadcastStore,
      memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async () => ({ messageId: 'wa-api-1' }),
        sendVoiceNote: async () => ({ messageId: 'wa-api-v1' }),
        sendRichMedia: async () => ({ messageId: 'wa-api-m1' }),
      },
      defaultTransport: 'baileys',
      sleep: async () => {},
    });

    const app = new Hono();
    registerBroadcastRoutes(app, { store: broadcastStore, orchestrator });

    const audienceRes = await app.request('/api/broadcasts/audience');
    expect(audienceRes.status).toBe(200);
    const audienceJson: unknown = await audienceRes.json();
    if (!isRecord(audienceJson) || !Array.isArray(audienceJson.contacts)) throw new Error('Expected an audience list');
    expect(audienceJson.contacts.length).toBe(1);

    const journal = new ActionJournal({ dbPath: ':memory:' });
    const registry = new ToolRegistry(journal);
    registerBroadcastTools(registry, 'brand-1', { store: broadcastStore, orchestrator });
    const toolRes = await registry.run({
      brandId: 'brand-1',
      toolName: 'broadcast_find_audience',
      workflowId: 'wf-1',
      idempotencyKey: 'key-1',
      input: { limit: 10 },
    });
    expect(toolRes.status).toBe('confirmed');
    expect(toolRes.output).toMatchObject({ count: 1 });

    journal.close();
    memoryStore.close();
  });
});
