import { serveStatic } from 'hono/bun';
import { createCapabilities, registerCapabilityRoutes } from './agent/capabilities-api';
import { AgentTurnCoordinator } from './agent/turn-coordinator';
import { createInboundPlanner } from './agent/inbound-planner';
import { AudioTranscriber } from './ai/audio-transcriber';
import { GeminiClient } from './ai/gemini-client';
import { ModeratorAgent } from './ai/moderator-agent';
import { VoiceSynthesizer } from './ai/voice-synthesizer';
import { BurstAccumulator, type FusedBurst } from './domain/burst-accumulator';
import { MessageSplitter } from './domain/message-splitter';
import { MemoryStore } from './domain/memory-store';
import { SendIntentService } from './domain/send-intent-service';
import { DiagnosticsCore } from './observability/diagnostics-core';
import { HumanRateLimiter } from './domain/rate-limiter';
import type { ChatMessage } from './domain/types';
import { createApiServer } from './server/api';
import { SSEBroadcaster } from './server/sse';
import { assertSafeDashboardBind } from './server/dashboard-auth';
import { WhatsAppSocketClient } from './transport/whatsapp-socket';
import { MetaCloudApi, type MetaCloudApiConfig, type MetaCloudWebhookEvent } from './transport/meta-cloud-api';
import { registerMetaCloudWebhookRoutes } from './server/meta-cloud-routes';
import { ContactIdentityDirectory } from './identity/contact-directory';
import { FableFunnelEngine, FunnelRegistry } from './funnel';
import { DualMemoryManager } from './domain/learning-memory';
import { ReflectionEngine } from './ai/reflection-engine';
import { ReflectionWorker } from './agent/reflection-worker';
import { PostgresLearningStore } from './persistence/postgres/learning-store';
import { resolveRuntimeDatastore } from './persistence/postgres/runtime-selection';
import { join } from 'node:path';

export async function createFableWhatsAppAgent(options: {
  port?: number;
  dataDir?: string;
  autoConnect?: boolean;
  capabilityToken?: string;
  dashboardToken?: string;
  capabilityAutopilotBrandId?: string;
  capabilityModel?: Pick<GeminiClient,'generateContent'>;
  transport?: 'baileys' | 'meta-cloud';
  metaCloud?: { config: MetaCloudApiConfig; fetch?: typeof fetch; now?: () => number };
  plannerEnv?: Readonly<Record<string, string | undefined>>;
} = {}) {
  // Fail before constructing a SQLite store if a partial PostgreSQL cutover was requested.
  resolveRuntimeDatastore();
  const port = options.port ?? Number(process.env.PORT || 3000);
  const dataDir = options.dataDir ?? './data';
  const transportMode = options.transport ?? process.env.WHATSAPP_TRANSPORT ?? 'baileys';
  if (transportMode !== 'baileys' && transportMode !== 'meta-cloud') {
    throw new Error('Unsupported WhatsApp transport mode');
  }
  const brandId = options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID;
  const metaConfig = options.metaCloud?.config ?? {
    graphVersion: process.env.META_CLOUD_GRAPH_VERSION ?? '',
    phoneNumberId: process.env.META_CLOUD_PHONE_NUMBER_ID ?? '',
    businessAccountId: process.env.META_CLOUD_BUSINESS_ACCOUNT_ID ?? '',
    accessToken: process.env.META_CLOUD_ACCESS_TOKEN ?? '',
    appSecret: process.env.META_CLOUD_APP_SECRET ?? '',
    webhookVerifyToken: process.env.META_CLOUD_VERIFY_TOKEN ?? ''
  };
  if (transportMode === 'meta-cloud' && (!brandId ||
      !metaConfig.graphVersion || !metaConfig.phoneNumberId || !metaConfig.businessAccountId ||
      !metaConfig.accessToken || !metaConfig.appSecret || !metaConfig.webhookVerifyToken)) {
    throw new Error('Meta Cloud transport requires a configured brand and complete account credentials');
  }

  console.log('🚀 [Fable Agentic WhatsApp] Initializing supervisor & agent engine...');

  const sse = new SSEBroadcaster();
  const memoryStore = new MemoryStore({ dataDir });
  const diagnostics = new DiagnosticsCore();
  const geminiClient = new GeminiClient();
  const capabilities = createCapabilities(dataDir, options.capabilityModel ?? geminiClient);
  const audioTranscriber = new AudioTranscriber(geminiClient);
  const voiceSynthesizer = new VoiceSynthesizer();
  const rateLimiter = new HumanRateLimiter({
    minDelayMs: 1500,
    maxDelayMs: 4500
  });

  const messageSplitter = new MessageSplitter();

  let postgresLearningStore: PostgresLearningStore | undefined;
  if (process.env.DATABASE_URL) {
    try {
      postgresLearningStore = new PostgresLearningStore({ databaseUrl: process.env.DATABASE_URL });
    } catch (err: any) {
      console.warn('⚠️ [Fable Agentic WhatsApp] Failed to initialize PostgresLearningStore:', err.message);
    }
  }

  const dualMemoryManager = new DualMemoryManager({
    storageDir: dataDir === ':memory:' ? './data/learning' : join(dataDir, 'learning'),
    persistenceStore: postgresLearningStore,
    sqliteStore: postgresLearningStore ? undefined : memoryStore.getSqliteStore(),
    persistSqlite: !postgresLearningStore,
    brandId: options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID ?? 'default'
  });

  const reflectionEngine = new ReflectionEngine(geminiClient, dualMemoryManager);

  const reflectionWorker = new ReflectionWorker({
    memoryStore,
    memoryManager: dualMemoryManager,
    reflectionEngine,
    persistenceStore: postgresLearningStore,
    brandId: options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID ?? 'default',
    idleThresholdMs: 15 * 60 * 1000 // 15 mins cold thread threshold
  });
  reflectionWorker.startPeriodicSweep(60_000);

  const moderatorAgent = new ModeratorAgent(geminiClient, memoryStore, {
    rateLimiter,
    dualMemoryManager
  });

  const inboundPlanner = createInboundPlanner({
    planner: capabilities.planner,
    registry: capabilities.registry,
    dataDir,
    brandId,
    env: options.plannerEnv ?? process.env
  });

  const coordinator = new AgentTurnCoordinator({
    moderator: moderatorAgent,
    memory: memoryStore,
    operator: capabilities.operator,
    planner: inboundPlanner,
    brandId,
    enabled: process.env.AGENT_CAPABILITIES_AUTOPILOT === '1' || Boolean(options.capabilityAutopilotBrandId)
  });

  let whatsappClient: WhatsAppSocketClient;
  let sendIntents: SendIntentService;

  // Burst Accumulator: fuses multi-line rapid messages before calling Gemini
  const burstAccumulator = new BurstAccumulator({
    windowMs: 2000,
    maxBurstMessages: 6,
    onBurst: async (burst: FusedBurst) => {
      const fusedMsg: ChatMessage = {
        id: burst.lastMessageId,
        chatId: burst.chatId,
        sender: burst.sender,
        senderName: burst.senderName,
        text: burst.fusedText,
        timestamp: burst.timestamp,
        isFromMe: false,
        type: 'text',
        replyToId: burst.replyToId,
        quotedMessage: burst.quotedMessage
      };

      console.log(`💬 [Burst Fused] From: ${fusedMsg.senderName || fusedMsg.sender} | Messages: ${fusedMsg.text.replace(/\n/g, ' ↵ ')}`);

      reflectionWorker.recordActivity(fusedMsg.chatId, fusedMsg.timestamp);

      try {
        const result = await coordinator.processInboundMessage(fusedMsg);

        // Broadcast thought & reasoning to live UI
        sse.broadcast('agent_thought', {
          chatId: fusedMsg.chatId,
          messageId: fusedMsg.id,
          decision: result.decision
        });

        if (result.draftCreated) {
          console.log(`📝 [Draft Created] Approval needed for chat ${fusedMsg.chatId}`);
          sse.broadcast('new_draft', result.draftCreated);
        }

        if (result.shouldSendImmediately && result.decision.replyText) {
          await rateLimiter.enqueue(fusedMsg.chatId, async () => {
            // 1. Send out-of-band immediate reaction if suggested
            if (result.decision.suggestedReaction) {
              try {
                await whatsappClient.sendReaction(fusedMsg.chatId, fusedMsg.id, result.decision.suggestedReaction);
                memoryStore.addReaction(fusedMsg.chatId, fusedMsg.id, result.decision.suggestedReaction);
                sse.broadcast('message_reaction', {
                  chatId: fusedMsg.chatId,
                  messageId: fusedMsg.id,
                  emoji: result.decision.suggestedReaction
                });
              } catch {}
            }

            // 2. Decide between Voice Note (PTT) vs Split Text Bubbles
            if (result.decision.sendAsVoiceNote && transportMode === 'baileys') {
              const voiceResult = await sendIntents.sendVoice({
                sourceKind: 'autopilot',
                sourceId: `${fusedMsg.chatId}:${fusedMsg.id}:voice`,
                sourceRevision: 1,
                actionKind: 'voice',
                chatId: fusedMsg.chatId,
                text: result.decision.replyText!,
                replyToMessageId: fusedMsg.id,
                policyRevision: moderatorAgent.getPolicy().version
              });
              if (voiceResult.intent.state !== 'accepted') {
                console.warn('[Delivery] Voice response needs retry or reconciliation', voiceResult.intent.state);
              }
              sse.broadcast('chat_updated', { chatId: fusedMsg.chatId });
              return;
            }

            // Natural multi-bubble human splitting for text replies
            const bubbles = messageSplitter.split(result.decision.replyText!);
            console.log(`🤖 [Agent Auto-Reply] Replying in ${bubbles.length} natural bubble(s)...`);

            for (let i = 0; i < bubbles.length; i++) {
              const bubbleText = bubbles[i];
              const isFirstBubble = i === 0;
              const delay = messageSplitter.calculateDelay(bubbleText, isFirstBubble);

              const deliveryResult = await sendIntents.sendText({
                sourceKind: 'autopilot',
                sourceId: `${fusedMsg.chatId}:${fusedMsg.id}:part-${i + 1}-of-${bubbles.length}`,
                sourceRevision: 1,
                actionKind: 'text',
                chatId: fusedMsg.chatId,
                text: bubbleText,
                replyToMessageId: isFirstBubble ? fusedMsg.id : undefined,
                simulatedDelayMs: delay,
                policyRevision: moderatorAgent.getPolicy().version
              });
              if (!['accepted', 'delivered', 'read'].includes(deliveryResult.intent.state)) {
                console.warn('[Delivery] Stopped remaining bubbles after a pending send', deliveryResult.intent.state);
                break;
              }
              sse.broadcast('chat_updated', { chatId: fusedMsg.chatId });
            }
          });
        }
      } catch (err: any) {
        console.error('❌ [Agent Processing Error]:', err.message);
      }
    }
  });

  const recipientDirectory = transportMode === 'meta-cloud'
    ? new ContactIdentityDirectory({
      dbPath: dataDir === ':memory:' ? ':memory:' : join(dataDir, 'contact-identity.sqlite')
    })
    : undefined;

  // Both transports share the durable inbound path and replay detection.
  const handleInboundMessage = async (msg: ChatMessage, delivery?: { historical: boolean }): Promise<void> => {
    if (!msg.text?.trim() && msg.type === 'text') return;
    if (msg.text === '[رسالة]') return;
    if (memoryStore.getMessage(msg.chatId, msg.id)) return;

    if (!msg.isFromMe && recipientDirectory && brandId) {
      recipientDirectory.observeAlias({ brandId, jid: msg.chatId });
    }
    const persistedMessage = memoryStore.addMessage(msg);
    sse.broadcast('new_message', persistedMessage);
    sse.broadcast('chat_updated', { chatId: msg.chatId });

    if (msg.isFromMe || delivery?.historical) return;
    if (transportMode === 'baileys') {
      const ownPhone = whatsappClient.getState().connectedUser?.phone;
      if (ownPhone && msg.chatId.startsWith(ownPhone)) return;
    }
    burstAccumulator.push(msg);
  };

  whatsappClient = new WhatsAppSocketClient({
    sessionDir: `${dataDir}/session`,
    audioTranscriber,
    onStateChange: (state) => {
      console.log(`📡 [WhatsApp State] ${state.state}`);
      sse.broadcast('state_change', state);
      if (state.state === 'connected') {
        void sendIntents?.dispatchDue().catch((error) => console.warn('[Delivery] Resume failed:', error));
      }
    },
    onMessageStatus: ({ chatId, messageId, status }) => {
      if (status !== 'pending') sendIntents?.receipt(chatId, messageId, status);
      const persistedStatus = memoryStore.updateMessageStatus(chatId, messageId, status);
      if (persistedStatus) sse.broadcast('message_status', { chatId, messageId, status: persistedStatus });
    },
    onReaction: ({ chatId, messageId, emoji }) => {
      memoryStore.addReaction(chatId, messageId, emoji);
      sse.broadcast('message_reaction', { chatId, messageId, emoji });
      sse.broadcast('chat_updated', { chatId });
    },
    onMessage: handleInboundMessage
  });

  const handleMetaEvent = async (event: MetaCloudWebhookEvent): Promise<void> => {
    if (event.kind === 'inbound_text') {
      await handleInboundMessage({
        id: event.nativeMessageId,
        chatId: event.chatId,
        sender: event.chatId,
        text: event.text,
        timestamp: event.timestampMs,
        isFromMe: false,
        type: 'text'
      });
      return;
    }
    if (event.kind === 'receipt') {
      sendIntents.receipt(event.chatId, event.nativeMessageId, event.status);
      const persistedStatus = memoryStore.updateMessageStatus(
        event.chatId, event.nativeMessageId, event.status
      );
      if (persistedStatus) {
        sse.broadcast('message_status', {
          chatId: event.chatId,
          messageId: event.nativeMessageId,
          status: persistedStatus
        });
      }
      return;
    }
    // S01 will attach a terminal failed-receipt transition once its bridge lands.
    sse.broadcast('message_delivery_failed', {
      chatId: event.chatId, messageId: event.nativeMessageId
    });
  };

  const metaClient = transportMode === 'meta-cloud'
    ? new MetaCloudApi({
      config: metaConfig,
      fetch: options.metaCloud?.fetch,
      now: options.metaCloud?.now,
      onEvent: handleMetaEvent
    })
    : undefined;

  sendIntents = new SendIntentService({
    memoryStore,
    diagnostics,
    sendText: (chatId, text, sendOptions) => {
      if (!metaClient) return whatsappClient.sendMessage(chatId, text, sendOptions);
      const lastInboundAtMs = memoryStore.getMessages(chatId, 100)
        .filter(message => !message.isFromMe)
        .reduce((latest, message) => Math.max(latest, message.timestamp), 0);
      return metaClient.sendText({ to: chatId, text, lastInboundAtMs });
    },
    prepareVoice: transportMode === 'baileys'
      ? (text) => voiceSynthesizer.synthesizeVoice(text, moderatorAgent.getPersona().voiceName)
      : undefined,
    sendVoice: transportMode === 'baileys'
      ? (chatId, audio, sendOptions) => whatsappClient.sendVoiceNote(chatId, audio, {
        replyToMessageId: sendOptions?.replyToMessageId
      })
      : undefined,
    publish: (event, data) => sse.broadcast(event, data)
  });

  // Initialize Scatter-Gather Funnel Engine
  const funnelEngine = new FableFunnelEngine({
    registry: new FunnelRegistry({
      initialMethods: [
        {
          method: 'INVENTORY_DISPATCH',
          description: 'Scatter-gather stock lookup across warehouse systems',
          mode: 'ALL_SETTLED',
          timeoutMs: 2500,
          targets: [
            { id: 'internal-stock', name: 'Internal DB Inventory', url: 'http://127.0.0.1:3000/api/brand/stock', enabled: true }
          ]
        },
        {
          method: 'WEBHOOK_FANOUT',
          description: 'Parallel webhook broadcast to CRM and analytics partners',
          mode: 'ALL_SETTLED',
          timeoutMs: 3000,
          targets: []
        }
      ]
    })
  });

  // Create API App
  const app = createApiServer({
    memoryStore,
    whatsappClient,
    moderatorAgent,
    sendIntents,
    diagnostics,
    sse,
    audioTranscriber,
    voiceSynthesizer,
    funnelEngine,
    dashboardToken: options.dashboardToken ?? process.env.AGENT_DASHBOARD_TOKEN ?? '',
    dualMemoryManager,
    reflectionWorker,
    reflectionEngine,
    transportMode
  });

  registerCapabilityRoutes(app, capabilities, options.capabilityToken ?? process.env.AGENT_CAPABILITIES_OWNER_TOKEN ?? '');
  if (metaClient) registerMetaCloudWebhookRoutes(app, metaClient);

  // Serve static UI assets if built
  app.use('/*', serveStatic({ root: './ui/dist' }));
  app.get('*', serveStatic({ path: './ui/dist/index.html' }));

  if (options.autoConnect) {
    setInterval(() => {
      if (metaClient || whatsappClient.getState().state === 'connected') {
        void sendIntents.dispatchDue().catch((error) => console.warn('[Delivery] Retry scan failed:', error));
      }
    }, 5000).unref();
    if (!metaClient) void whatsappClient.start();
  }

  return {
    app,
    port,
    memoryStore,
    whatsappClient,
    metaClient,
    recipientDirectory,
    transportMode,
    moderatorAgent,
    coordinator,
    inboundPlanner,
    burstAccumulator,
    sse,
    capabilities,
    funnelEngine,
    dualMemoryManager,
    reflectionWorker,
    reflectionEngine
  };
}

if (import.meta.main) {
  const host = process.env.HOST || '127.0.0.1';
  assertSafeDashboardBind(host, process.env.AGENT_DASHBOARD_TOKEN ?? '');
  const agent = await createFableWhatsAppAgent({ autoConnect: true });
  console.log(`✨ [Fable Agentic WhatsApp] Live at http://localhost:${agent.port}`);
  Bun.serve({
    fetch: agent.app.fetch,
    port: agent.port,
    hostname: host
  });
}
