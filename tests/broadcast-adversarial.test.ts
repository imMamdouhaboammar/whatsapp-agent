import { describe, expect, spyOn, test } from 'bun:test';
import { isRecord } from '../src/mcp/records';
import { BroadcastComposer } from '../src/agent/broadcast-composer';
import { BroadcastOrchestrator } from '../src/agent/broadcast-orchestrator';
import { MemoryStore } from '../src/domain/memory-store';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { MetaCloudApi } from '../src/transport/meta-cloud-api';

function seedConnectedChat(store: MemoryStore, chatId: string, name: string, ts: number) {
  store.saveChat({
    id: chatId,
    name,
    phoneNumber: chatId.replace(/@.*/, ''),
    unreadCount: 0,
    lastMessage: 'Hello',
    lastTimestamp: ts,
    isGroup: false,
    agentMode: 'autopilot',
  });
  store.addMessage({
    id: `msg-${chatId}-${ts}`,
    chatId,
    sender: chatId,
    senderName: name,
    text: 'Hello',
    timestamp: ts,
    isFromMe: false,
    type: 'text',
  });
}

function createTestApi(options: { dashboardToken?: string } = {}) {
  const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
  const sse = new SSEBroadcaster();
  const moderatorAgent = new ModeratorAgent(new GeminiClient(), memoryStore);
  const app = createApiServer({
    memoryStore,
    moderatorAgent,
    sse,
    dashboardToken: options.dashboardToken ?? '',
  });
  return { app, memoryStore, sse };
}

describe('Broadcast Adversarial & Red Behavioral Suite', () => {
  test.each(['autonomous', 'preview_approve'] as const)(
    '%s dispatch reports a background interruption without retrying sends',
    async (approvalMode) => {
      const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
      const store = memoryStore.getBroadcastStore();
      const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
      const interruption = Object.assign(new Error('Dispatch pacing interrupted'), { code: 'PACING_INTERRUPTED' });
      const pacing = Promise.withResolvers<void>();
      const pacingStarted = Promise.withResolvers<void>();
      const sends: string[] = [];
      try {
        seedConnectedChat(memoryStore, '201001111111@s.whatsapp.net', 'First', Date.now() - 1000);
        seedConnectedChat(memoryStore, '201002222222@s.whatsapp.net', 'Second', Date.now() - 2000);
        const orchestrator = new BroadcastOrchestrator({
          store,
          memoryStore,
          composer: new BroadcastComposer(),
          whatsappClient: {
            getState: () => ({ state: 'connected', updatedAt: Date.now() }),
            sendMessage: async (chatId) => {
              sends.push(chatId);
              return { messageId: 'sent-1' };
            },
            sendVoiceNote: async () => ({ messageId: 'voice' }),
            sendRichMedia: async () => ({ messageId: 'media' }),
          },
          sleep: () => {
            pacingStarted.resolve();
            return pacing.promise;
          },
        });
        const { campaign } = await orchestrator.createCampaign({
          name: 'Interrupted dispatch',
          goal: 'Hello',
          approvalMode,
          richContent: { kind: 'text', messageGoal: 'Hello' },
          pacing: { minDelayMs: 1, maxDelayMs: 1 },
        });
        if (approvalMode === 'preview_approve') {
          expect(campaign.status).toBe('draft');
          expect(orchestrator.approveCampaign(campaign.id)?.status).toBe('approved');
        } else {
          expect(campaign.status).toBe('approved');
        }
        await pacingStarted.promise;
        expect(orchestrator.approveCampaign(campaign.id)?.status).toBe('approved');

        pacing.reject(interruption);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledWith(JSON.stringify({
          campaignId: campaign.id,
          error: 'Error:PACING_INTERRUPTED',
          level: 'error',
          event: 'broadcast_dispatch_interrupted',
        }));
        expect(sends).toHaveLength(1);
        expect(store.listRecipients(campaign.id)).toEqual(expect.arrayContaining([
          expect.objectContaining({ chatId: sends[0], status: 'sent', providerMessageId: 'sent-1' }),
          expect.objectContaining({ status: 'approved' }),
        ]));
        expect(store.getCampaign(campaign.id)?.status).toBe('approved');
      } finally {
        diagnostic.mockRestore();
        memoryStore.close();
      }
    },
  );

  test('test_api_unknown_routes_return_404_json_never_html', async () => {
    const { app, memoryStore } = createTestApi();
    const res = await app.request('/api/broadcasts/non-existent-id');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body: unknown = await res.json();
    if (!isRecord(body)) throw new Error('Expected an error response object');
    expect(typeof body.error).toBe('string');
    memoryStore.close();
  });

  test('test_unauthenticated_broadcast_requests_fail_closed_when_token_configured', async () => {
    const { app, memoryStore } = createTestApi({ dashboardToken: 'secret-owner-token' });
    const listRes = await app.request('/api/broadcasts');
    expect(listRes.status).toBe(401);

    const createRes = await app.request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', goal: 'Hi', richContent: { kind: 'text', messageGoal: 'Hi' } }),
    });
    expect(createRes.status).toBe(401);
    memoryStore.close();
  });

  test('test_explicit_chatIds_cannot_bypass_previous_connection_or_group_or_optout_guards', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const store = memoryStore.getBroadcastStore();
    const now = Date.now();

    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'Valid User', now - 1000);
    // Cold contact: chat exists with 0 messages and null lastTimestamp
    memoryStore.saveChat({ id: '201009990000@s.whatsapp.net', name: 'Zero Msg', isGroup: false, unreadCount: 0, agentMode: 'autopilot' });
    // Group chat
    memoryStore.saveChat({ id: '120363999@g.us', name: 'Group', isGroup: true, unreadCount: 0, lastTimestamp: now, agentMode: 'autopilot' });
    // Opted-out user with previous connection
    seedConnectedChat(memoryStore, '201008887777@s.whatsapp.net', 'Opted Out', now - 1000);
    store.markOptOut('201008887777@s.whatsapp.net', 'stop', now);

    const orchestrator = new BroadcastOrchestrator({
      store,
      memoryStore,
      composer: new BroadcastComposer(),
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Strict Guard',
      goal: 'Offer',
      audienceFilter: {
        chatIds: [
          '201001112233@s.whatsapp.net',
          '201009990000@s.whatsapp.net',
          '120363999@g.us',
          '201008887777@s.whatsapp.net',
        ],
      },
      richContent: { kind: 'text', messageGoal: 'Offer' },
    });

    expect(created.recipients.map((r) => r.chatId)).toEqual(['201001112233@s.whatsapp.net']);
    memoryStore.close();
  });

  test('test_concurrent_approve_calls_never_double_send_to_same_recipient', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const store = memoryStore.getBroadcastStore();
    seedConnectedChat(memoryStore, '201001112233@s.whatsapp.net', 'Ahmed', Date.now() - 1000);

    let sendCount = 0;
    const orchestrator = new BroadcastOrchestrator({
      store,
      memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          sendCount++;
          return { messageId: `wa-${sendCount}` };
        },
        sendVoiceNote: async () => ({ messageId: 'v-1' }),
        sendRichMedia: async () => ({ messageId: 'm-1' }),
      },
      defaultTransport: 'baileys',
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Concurrency',
      goal: 'Hi {{name}}',
      approvalMode: 'preview_approve',
      richContent: { kind: 'text', messageGoal: 'Hi {{name}}' },
      pacing: { minDelayMs: 0, maxDelayMs: 0 },
    });

    // Try repeated approvals and overlapping dispatches.
    orchestrator.approveCampaign(created.campaign.id);
    orchestrator.approveCampaign(created.campaign.id);
    await Promise.all([
      orchestrator.startDispatchInBackground(created.campaign.id),
      orchestrator.startDispatchInBackground(created.campaign.id),
      orchestrator.startDispatchInBackground(created.campaign.id),
    ]);
    await orchestrator.startDispatchInBackground(created.campaign.id);

    expect(sendCount).toBe(1);
    memoryStore.close();
  });

  test('test_pause_mid_flight_halts_remaining_recipients', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const store = memoryStore.getBroadcastStore();
    const now = Date.now();
    seedConnectedChat(memoryStore, '201001111111@s.whatsapp.net', 'U1', now - 1000);
    seedConnectedChat(memoryStore, '201002222222@s.whatsapp.net', 'U2', now - 2000);
    seedConnectedChat(memoryStore, '201003333333@s.whatsapp.net', 'U3', now - 3000);

    const sent: string[] = [];
    const orchestrator = new BroadcastOrchestrator({
      store,
      memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async (chatId) => {
          sent.push(chatId);
          // Pause immediately after first send
          orchestrator.pauseCampaign(created.campaign.id);
          return { messageId: `msg-${sent.length}` };
        },
        sendVoiceNote: async () => ({ messageId: 'v' }),
        sendRichMedia: async () => ({ messageId: 'm' }),
      },
      defaultTransport: 'baileys',
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Pause Test',
      goal: 'Hello',
      approvalMode: 'preview_approve',
      richContent: { kind: 'text', messageGoal: 'Hello' },
      pacing: { minDelayMs: 0, maxDelayMs: 0 },
    });
    orchestrator.approveCampaign(created.campaign.id);
    await orchestrator.startDispatchInBackground(created.campaign.id);

    expect(sent.length).toBe(1);
    expect(store.getCampaign(created.campaign.id)?.status).toBe('paused');
    memoryStore.close();
  });

  test('test_single_recipient_failure_does_not_abort_remaining_recipients', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const store = memoryStore.getBroadcastStore();
    const now = Date.now();
    seedConnectedChat(memoryStore, '201001111111@s.whatsapp.net', 'FailUser', now - 1000);
    seedConnectedChat(memoryStore, '201002222222@s.whatsapp.net', 'SuccessUser', now - 2000);

    const orchestrator = new BroadcastOrchestrator({
      store,
      memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async (chatId) => {
          if (chatId.includes('111111')) throw new Error('Simulated socket timeout');
          return { messageId: 'ok-1' };
        },
        sendVoiceNote: async () => ({ messageId: 'v' }),
        sendRichMedia: async () => ({ messageId: 'm' }),
      },
      defaultTransport: 'baileys',
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Resilience',
      goal: 'Hi',
      approvalMode: 'autonomous',
      richContent: { kind: 'text', messageGoal: 'Hi' },
      pacing: { minDelayMs: 0, maxDelayMs: 0 },
    });
    await orchestrator.startDispatchInBackground(created.campaign.id);

    const stats = store.getCampaignStats(created.campaign.id);
    expect(stats.failed).toBe(1);
    expect(stats.sent).toBe(1);
    expect(store.getCampaign(created.campaign.id)?.status).toBe('completed');
    memoryStore.close();
  });

  test('test_quiet_hours_defers_campaign_without_sending', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:', dbPath: ':memory:' });
    const store = memoryStore.getBroadcastStore();
    // 02:00 UTC
    const twoAmUtc = Date.UTC(2026, 10, 26, 2, 0, 0);
    seedConnectedChat(memoryStore, '201001111111@s.whatsapp.net', 'NightUser', twoAmUtc - 60_000);

    let sentCount = 0;
    const orchestrator = new BroadcastOrchestrator({
      store,
      memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: {
        getState: () => ({ state: 'connected', updatedAt: Date.now() }),
        sendMessage: async () => { sentCount++; return { messageId: 'x' }; },
        sendVoiceNote: async () => ({ messageId: 'v' }),
        sendRichMedia: async () => ({ messageId: 'm' }),
      },
      defaultTransport: 'baileys',
      now: () => twoAmUtc,
      sleep: async () => {},
    });

    const created = await orchestrator.createCampaign({
      name: 'Quiet Hours',
      goal: 'Hi',
      approvalMode: 'autonomous',
      richContent: { kind: 'text', messageGoal: 'Hi' },
      pacing: {
        minDelayMs: 0,
        maxDelayMs: 0,
        quietHours: { from: 22, to: 8, timeZone: 'UTC' },
      },
    });
    await orchestrator.startDispatchInBackground(created.campaign.id);

    expect(sentCount).toBe(0);
    expect(store.getCampaign(created.campaign.id)?.status).toBe('paused');
    memoryStore.close();
  });

  test('test_composer_redacts_leaked_credentials_from_ai_output', async () => {
    const fakeSecret = ['sk', 'live', '1234567890abcdefghijklmnop'].join('-');
    const composer = new BroadcastComposer({
      gemini: {
        generateContent: async () => ({
          text: `Hi Ahmed, use key ${fakeSecret} for access.`,
          functionCalls: [],
        }),
      },
    });
    const out = await composer.personalizeForContact(
      {
        chatId: '201001112233@s.whatsapp.net',
        name: 'Ahmed',
        stage: 'lead',
        facts: [],
        memories: [],
        messageCount: 1,
      },
      'Send welcome'
    );
    expect(out).not.toContain(fakeSecret);
    expect(out).toContain('[REDACTED_CREDENTIAL]');
  });

  test('test_meta_cloud_rich_media_rejects_insecure_http_urls_before_fetch', async () => {
    let fetched = false;
    const now = 1_700_000_000_000;
    const meta = new MetaCloudApi({
      config: {
        graphVersion: 'v21.0',
        phoneNumberId: '123456789',
        accessToken: ['meta', 'token', 'test'].join('-'),
        appSecret: ['app', 'secret', 'test'].join('-'),
        webhookVerifyToken: 'verify-token',
      },
      now: () => now,
      fetch: async () => {
        fetched = true;
        return new Response('{}', { status: 200 });
      },
    });

    expect(
      meta.sendRichMedia({
        to: '201001112233',
        kind: 'image',
        mediaUrl: 'http://insecure.example.com/img.png',
        lastInboundAtMs: now - 1000,
      })
    ).rejects.toThrow();
    expect(fetched).toBe(false);
  });

  test('test_malformed_json_on_create_broadcast_returns_400', async () => {
    const { app, memoryStore } = createTestApi();
    const res = await app.request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    expect(res.status).toBe(400);
    memoryStore.close();
  });
});
