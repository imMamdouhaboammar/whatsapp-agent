import { serveStatic } from 'hono/bun';
import { createCapabilities, registerCapabilityRoutes } from './agent/capabilities-api';
import { AgentTurnCoordinator } from './agent/turn-coordinator';
import { AudioTranscriber } from './ai/audio-transcriber';
import { GeminiClient } from './ai/gemini-client';
import { ModeratorAgent } from './ai/moderator-agent';
import { VoiceSynthesizer } from './ai/voice-synthesizer';
import { BurstAccumulator, type FusedBurst } from './domain/burst-accumulator';
import { MessageSplitter } from './domain/message-splitter';
import { MemoryStore } from './domain/memory-store';
import { HumanRateLimiter } from './domain/rate-limiter';
import type { ChatMessage } from './domain/types';
import { createApiServer } from './server/api';
import { SSEBroadcaster } from './server/sse';
import { assertSafeDashboardBind } from './server/dashboard-auth';
import { WhatsAppSocketClient } from './transport/whatsapp-socket';
import { FableFunnelEngine, FunnelRegistry } from './funnel';
import { DualMemoryManager } from './domain/learning-memory';
import { ReflectionEngine } from './ai/reflection-engine';
import { ReflectionWorker } from './agent/reflection-worker';
import { PostgresLearningStore } from './persistence/postgres/learning-store';
import { join } from 'node:path';

export async function createFableWhatsAppAgent(options: {
  port?: number;
  dataDir?: string;
  autoConnect?: boolean;
  capabilityToken?: string;
  dashboardToken?: string;
  capabilityAutopilotBrandId?: string;
  capabilityModel?: Pick<GeminiClient,'generateContent'>;
} = {}) {
  const port = options.port ?? Number(process.env.PORT || 3000);
  const dataDir = options.dataDir ?? './data';

  console.log('🚀 [Fable Agentic WhatsApp] Initializing supervisor & agent engine...');

  const sse = new SSEBroadcaster();
  const memoryStore = new MemoryStore({ dataDir });
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

  const coordinator = new AgentTurnCoordinator({
    moderator: moderatorAgent,
    memory: memoryStore,
    operator: capabilities.operator,
    brandId: options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID,
    enabled: process.env.AGENT_CAPABILITIES_AUTOPILOT === '1' || Boolean(options.capabilityAutopilotBrandId)
  });

  let whatsappClient: WhatsAppSocketClient;

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
            if (result.decision.sendAsVoiceNote) {
              const personaVoice = moderatorAgent.getPersona().voiceName;
              console.log(`🎙️ [Agent Voice Auto-Reply] Synthesizing & sending WhatsApp voice note using ${personaVoice || 'Chirp3-HD-Fenrir'}...`);
              try {
                const audioBuffer = await voiceSynthesizer.synthesizeVoice(result.decision.replyText!, personaVoice);
                const sent = await whatsappClient.sendVoiceNote(fusedMsg.chatId, audioBuffer, {
                  replyToMessageId: fusedMsg.id
                });

                const outboundMsg: ChatMessage = {
                  id: sent.messageId,
                  chatId: fusedMsg.chatId,
                  sender: 'me',
                  text: `🎵 [رسالة صوتية صادرة: ${result.decision.replyText!}]`,
                  transcription: result.decision.replyText!,
                  timestamp: Date.now(),
                  isFromMe: true,
                  type: 'audio',
                  replyToId: fusedMsg.id,
                  quotedMessage: fusedMsg.quotedMessage,
                  status: 'sent'
                };

                const persistedMessage = memoryStore.addMessage(outboundMsg);
                sse.broadcast('new_message', persistedMessage);
                sse.broadcast('chat_updated', { chatId: fusedMsg.chatId });
                return;
              } catch (err: any) {
                console.warn('⚠️ [Voice Synthesis Failed, falling back to text]:', err.message);
              }
            }

            // Natural multi-bubble human splitting for text replies
            const bubbles = messageSplitter.split(result.decision.replyText!);
            console.log(`🤖 [Agent Auto-Reply] Replying in ${bubbles.length} natural bubble(s)...`);

            for (let i = 0; i < bubbles.length; i++) {
              const bubbleText = bubbles[i];
              const isFirstBubble = i === 0;
              const delay = messageSplitter.calculateDelay(bubbleText, isFirstBubble);

              const sent = await whatsappClient.sendMessage(fusedMsg.chatId, bubbleText, {
                replyToMessageId: isFirstBubble ? fusedMsg.id : undefined,
                simulatedDelayMs: delay
              });

              const outboundMsg: ChatMessage = {
                id: sent.messageId,
                chatId: fusedMsg.chatId,
                sender: 'me',
                text: bubbleText,
                timestamp: Date.now(),
                isFromMe: true,
                type: 'text',
                replyToId: isFirstBubble ? fusedMsg.id : undefined,
                quotedMessage: isFirstBubble ? fusedMsg.quotedMessage : undefined,
                status: 'sent'
              };

              const persistedMessage = memoryStore.addMessage(outboundMsg);
              sse.broadcast('new_message', persistedMessage);
              sse.broadcast('chat_updated', { chatId: fusedMsg.chatId });
            }
          });
        }
      } catch (err: any) {
        console.error('❌ [Agent Processing Error]:', err.message);
      }
    }
  });

  whatsappClient = new WhatsAppSocketClient({
    sessionDir: `${dataDir}/session`,
    audioTranscriber,
    onStateChange: (state) => {
      console.log(`📡 [WhatsApp State] ${state.state}`);
      sse.broadcast('state_change', state);
    },
    onMessageStatus: ({ chatId, messageId, status }) => {
      const persistedStatus = memoryStore.updateMessageStatus(chatId, messageId, status);
      if (persistedStatus) sse.broadcast('message_status', { chatId, messageId, status: persistedStatus });
    },
    onReaction: ({ chatId, messageId, emoji }) => {
      memoryStore.addReaction(chatId, messageId, emoji);
      sse.broadcast('message_reaction', { chatId, messageId, emoji });
      sse.broadcast('chat_updated', { chatId });
    },
    onMessage: async (msg: ChatMessage, delivery?: { historical: boolean }) => {
      if (!msg.text?.trim() && msg.type === 'text') return;
      if (msg.text === '[رسالة]') return;
      // Transport reconnects/history replay the same message ID. Do not count or reply twice.
      if (memoryStore.getMessage(msg.chatId,msg.id)) return;

      // 1. Record incoming message immediately to SQLite and broadcast to UI
      const persistedMessage = memoryStore.addMessage(msg);
      sse.broadcast('new_message', persistedMessage);
      sse.broadcast('chat_updated', { chatId: msg.chatId });

      // If message is from me, do not run agent reply loop
      if (msg.isFromMe || delivery?.historical) {
        return;
      }

      const myPhone = whatsappClient.getState().connectedUser?.phone;
      if (myPhone && msg.chatId.startsWith(myPhone)) {
        // Self note (Note to Self) - do not auto-reply to own sync chat
        return;
      }

      // 2. Push into Burst Accumulator (debounces rapid messages into single conversational turn)
      burstAccumulator.push(msg);
    }
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
    sse,
    audioTranscriber,
    voiceSynthesizer,
    funnelEngine,
    dashboardToken: options.dashboardToken ?? process.env.AGENT_DASHBOARD_TOKEN ?? '',
    dualMemoryManager,
    reflectionWorker,
    reflectionEngine
  });

  registerCapabilityRoutes(app, capabilities, options.capabilityToken ?? process.env.AGENT_CAPABILITIES_OWNER_TOKEN ?? '');

  // Serve static UI assets if built
  app.use('/*', serveStatic({ root: './ui/dist' }));
  app.get('*', serveStatic({ path: './ui/dist/index.html' }));

  if (options.autoConnect) {
    void whatsappClient.start();
  }

  return {
    app,
    port,
    memoryStore,
    whatsappClient,
    moderatorAgent,
    coordinator,
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
