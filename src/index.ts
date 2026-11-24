import { serveStatic } from 'hono/bun';
import { createCapabilities, registerCapabilityRoutes } from './agent/capabilities-api';
import { AgentTurnCoordinator } from './agent/turn-coordinator';
import { createInboundPlanner } from './agent/inbound-planner';
import { ProactiveEngagementScheduler, type ProactiveEligibility, type ProactiveTemplateIntentCommand } from './agent/proactive-scheduler';
import type { FollowUpTrigger } from './agent/follow-ups';
import { AudioTranscriber } from './ai/audio-transcriber';
import { GeminiClient } from './ai/gemini-client';
import { ModeratorAgent } from './ai/moderator-agent';
import { VoiceSynthesizer } from './ai/voice-synthesizer';
import { BurstAccumulator, type FusedBurst } from './domain/burst-accumulator';
import { InboundJobLedger } from './domain/inbound-job-ledger';
import { MessageSplitter } from './domain/message-splitter';
import { MemoryStore } from './domain/memory-store';
import { SendIntentService, type VerifiedTemplateAuthorization } from './domain/send-intent-service';
import type { SendIntent } from './domain/send-ledger';
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
import { createDefaultFunnelEngine } from './funnel/default-engine';
import { DualMemoryManager } from './domain/learning-memory';
import { ReflectionEngine } from './ai/reflection-engine';
import { resolveRuntimeProfile, capabilityMatrix } from './runtime-profile';
import { ReflectionWorker } from './agent/reflection-worker';
import { PostgresLearningStore } from './persistence/postgres/learning-store';
import { resolveLearningMirror } from './persistence/learning-mirror-config';
import { resolveRuntimeDatastore } from './persistence/postgres/runtime-selection';
import { join } from 'node:path';
import { describeBurst, describeError, hashChatId, logEvent } from './observability/safe-log';
import { defaultLifecycle } from './server/lifecycle';

export async function createFableWhatsAppAgent(options: {
  port?: number;
  dataDir?: string;
  autoConnect?: boolean;
  capabilityToken?: string;
  dashboardToken?: string;
  capabilityAutopilotBrandId?: string;
  capabilityModel?: Pick<GeminiClient,'generateContent'>;
  transport?: 'baileys' | 'meta-cloud';
  /** WA-023: explicit runtime profile. Defaults to FULL (current behavior). */
  runtimeProfile?: string;
  metaCloud?: { config: MetaCloudApiConfig; fetch?: typeof fetch; now?: () => number };
  plannerEnv?: Readonly<Record<string, string | undefined>>;
  /** Trusted owner/business data source. No proactive sends when absent. */
  proactiveEligibility?: (trigger: FollowUpTrigger, now: number) => Promise<ProactiveEligibility>;
} = {}) {
  // Fail before constructing a SQLite store if a partial PostgreSQL cutover was requested.
  resolveRuntimeDatastore();
  const port = options.port ?? Number(process.env.PORT || 3000);
  const dataDir = options.dataDir ?? './data';
  const transportMode = options.transport ?? process.env.WHATSAPP_TRANSPORT ?? 'baileys';
  if (transportMode !== 'baileys' && transportMode !== 'meta-cloud') {
    throw new Error('Unsupported WhatsApp transport mode');
  }
  const runtimeProfile = resolveRuntimeProfile(options.runtimeProfile);
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
  const voiceSynthesizer = runtimeProfile.voiceEnabled ? new VoiceSynthesizer() : undefined;
  const rateLimiter = new HumanRateLimiter({
    minDelayMs: 1500,
    maxDelayMs: 4500
  });

  const messageSplitter = new MessageSplitter();

  // WA-009: the Postgres learning mirror activates only through the explicit resolver.
  // SQLite stays authoritative; a mirror construction failure is degraded, never silent.
  const mirrorResolution = resolveLearningMirror();
  const learningMirror: { enabled: boolean; reason: string; degraded?: string } = {
    enabled: mirrorResolution.mode === 'mirror',
    reason: mirrorResolution.reason
  };
  let postgresLearningStore: PostgresLearningStore | undefined;
  if (mirrorResolution.mode === 'mirror') {
    try {
      postgresLearningStore = new PostgresLearningStore({ databaseUrl: mirrorResolution.databaseUrl! });
    } catch (err: any) {
      learningMirror.degraded = err instanceof Error ? err.message : String(err);
      console.warn('⚠️ [Fable Agentic WhatsApp] Learning mirror degraded:', learningMirror.degraded);
    }
  }

  const dualMemoryManager = new DualMemoryManager({
    storageDir: dataDir === ':memory:' ? './data/learning' : join(dataDir, 'learning'),
    persistenceStore: postgresLearningStore,
    sqliteStore: postgresLearningStore ? undefined : memoryStore.getSqliteStore(),
    persistSqlite: !postgresLearningStore,
    brandId: options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID ?? 'default'
  });
  await dualMemoryManager.hydrateFromPersistence();

  // WA-023: reflection owns a periodic sweep timer; construct it only when the profile
  // enables the capability so CORE_MINIMAL boots with no reflection timers or workers.
  let reflectionEngine: ReflectionEngine | undefined;
  let reflectionWorker: ReflectionWorker | undefined;
  if (runtimeProfile.reflectionEnabled) {
    reflectionEngine = new ReflectionEngine(geminiClient, dualMemoryManager);
    reflectionWorker = new ReflectionWorker({
      memoryStore,
      memoryManager: dualMemoryManager,
      reflectionEngine,
      persistenceStore: postgresLearningStore,
      brandId: options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID ?? 'default',
      idleThresholdMs: 15 * 60 * 1000 // 15 mins cold thread threshold
    });
    reflectionWorker.startPeriodicSweep(60_000);
  }

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

  let whatsappClient: WhatsAppSocketClient | undefined;
  let sendIntents: SendIntentService;
  let proactiveScheduler: ProactiveEngagementScheduler | undefined;

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

      logEvent('info', 'burst_fused', describeBurst(fusedMsg));

      reflectionWorker?.recordActivity(fusedMsg.chatId, fusedMsg.timestamp);

      try {
        const result = await coordinator.processInboundMessage(fusedMsg);

        // Broadcast thought & reasoning to live UI
        sse.broadcast('agent_thought', {
          chatId: fusedMsg.chatId,
          messageId: fusedMsg.id,
          decision: result.decision
        });

        if (result.draftCreated) {
          logEvent('info', 'draft_created', { chat: hashChatId(fusedMsg.chatId) });
          sse.broadcast('new_draft', result.draftCreated);
        }

        if (result.shouldSendImmediately && result.decision.replyText) {
          await rateLimiter.enqueue(fusedMsg.chatId, async () => {
            // 1. Send out-of-band immediate reaction if suggested
            if (result.decision.suggestedReaction) {
              try {
                await whatsappClient?.sendReaction(fusedMsg.chatId, fusedMsg.id, result.decision.suggestedReaction);
                memoryStore.addReaction(fusedMsg.chatId, fusedMsg.id, result.decision.suggestedReaction);
                sse.broadcast('message_reaction', {
                  chatId: fusedMsg.chatId,
                  messageId: fusedMsg.id,
                  emoji: result.decision.suggestedReaction
                });
              } catch (err) {
                console.warn('[Delivery] Failed to send or persist reaction:', describeError(err));
              }
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

            // WA-015: commit every bubble durably as one batch BEFORE the first dispatch.
            // A crash mid-replay resumes from the ledger instead of re-splitting, and the
            // predecessor gate keeps bubbles strictly ordered across retries.
            const batch = await sendIntents.createTextBatch(bubbles.map((bubbleText, i) => ({
              sourceKind: 'autopilot',
              sourceId: `${fusedMsg.chatId}:${fusedMsg.id}:part-${i + 1}-of-${bubbles.length}`,
              sourceRevision: 1,
              actionKind: 'text' as const,
              chatId: fusedMsg.chatId,
              text: bubbleText,
              replyToMessageId: i === 0 ? fusedMsg.id : undefined,
              simulatedDelayMs: messageSplitter.calculateDelay(bubbleText, i === 0),
              policyRevision: moderatorAgent.getPolicy().version
            })));

            for (const part of batch) {
              const deliveryResult = await sendIntents.dispatch(part.intent.id);
              if (!['accepted', 'delivered', 'read'].includes(deliveryResult.intent.state)) {
                console.warn('[Delivery] Stopped remaining bubbles after a pending send', deliveryResult.intent.state);
                break;
              }
              sse.broadcast('chat_updated', { chatId: fusedMsg.chatId });
            }
          });
        }

        // WA-005: the turn's durable jobs are done once the decision executed.
        // A fail-closed rejection means the turn NEVER processed: release the
        // job for a later retry instead of completing it, or the customer's
        // message would be answered never (review triage on #97, comment 3).
        const retryIntents = new Set(['turn_queue_expired', 'admission_full', 'planner_lane_busy']);
        for (const m of burst.messages) {
          const jobId = InboundJobLedger.jobIdFor(m.chatId, m.id);
          if (retryIntents.has(result.decision.intent ?? '')) {
            memoryStore.getInboundJobLedger().failAttempt(jobId, result.decision.intent ?? 'queue_rejected');
          } else {
            memoryStore.getInboundJobLedger().complete(jobId);
          }
        }
      } catch (err: any) {
        logEvent('error', 'agent_processing_error', { error: describeError(err) });
        for (const m of burst.messages) {
          memoryStore.getInboundJobLedger().failAttempt(
            InboundJobLedger.jobIdFor(m.chatId, m.id), describeError(err)
          );
        }
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

    if (!msg.isFromMe && recipientDirectory && brandId) {
      const identity = recipientDirectory.observeAlias({ brandId, jid: msg.chatId });
      proactiveScheduler?.onCustomerMessage({ brandId, contactId: identity.contactId, text: msg.text });
    }

    // WA-005: decide eligibility BEFORE the atomic persist so the message and
    // its response job commit together; historical and self traffic is stored
    // without a job, exactly as before.
    let eligible = !msg.isFromMe && !delivery?.historical;
    if (eligible && transportMode === 'baileys') {
      const ownPhone = whatsappClient?.getState().connectedUser?.phone;
      if (ownPhone && msg.chatId.startsWith(ownPhone)) eligible = false;
    }

    // S01/WA-005: only a FIRST live delivery creates work. A replay of an
    // already-stored message (history re-sync, duplicate webhook) never
    // spawns a job; recovery of an interrupted job is the sweep's role.
    const alreadyKnown = !!memoryStore.getMessage(msg.chatId, msg.id);
    const persisted = memoryStore.saveInboundMessageWithJob(msg, { createJob: eligible && !alreadyKnown });
    if (!persisted.message) return;
    if (persisted.isNew) {
      sse.broadcast('new_message', persisted.message);
      sse.broadcast('chat_updated', { chatId: msg.chatId });
    }

    if (!eligible || !persisted.created) return;
    // Claim before pushing: if the process dies while the message sits in the
    // RAM burst buffer, the lease expires and the recovery sweep re-drives it.
    const claimed = memoryStore.getInboundJobLedger().claim(persisted.job!.id, inboundOwner);
    if (claimed) burstAccumulator.push(msg);
    // A rejected push (intake stopped) is safe: the durable job's lease
    // expires and recovery re-drives the work on this or the next process.
  };

  // WA-005: re-drive durable inbound jobs whose owner died mid-flight.
  const inboundOwner = 'inbound-' + process.pid + '-' + Date.now();
  const recoverInboundJobs = () => {
    try {
      const ledger = memoryStore.getInboundJobLedger();
      ledger.recoverExpiredLeases();
      for (const job of ledger.due()) {
        const claimed = ledger.claim(job.id, inboundOwner);
        if (!claimed) continue;
        if (!burstAccumulator.push(claimed.payload)) return;
      }
    } catch (err) {
      console.warn('[Inbound] Recovery sweep failed:', describeError(err));
    }
  };
  recoverInboundJobs();
  const inboundRecoveryTimer = setInterval(recoverInboundJobs, 5000);
  inboundRecoveryTimer.unref();

  // WA-023: the Baileys wrapper exists only for the Baileys transport. Meta mode never
  // constructs it, in any profile.
  if (runtimeProfile.baileysWrapperEnabled(transportMode)) {
    whatsappClient = new WhatsAppSocketClient({
    sessionDir: `${dataDir}/session`,
    audioTranscriber,
    onStateChange: (state) => {
      console.log(`📡 [WhatsApp State] ${state.state}`);
      sse.broadcast('state_change', state);
      if (state.state === 'connected') {
        void sendIntents?.dispatchDue().catch((error) => console.warn('[Delivery] Resume failed:', describeError(error)));
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
  }

  const handleMetaEvent = async (event: MetaCloudWebhookEvent): Promise<void> => {
    if (event.kind === 'unsupported_content') {
      // WA-024: surface unsupported inbound content explicitly; never fake
      // parity by routing it into the text pipeline.
      logEvent('warn', 'meta_unsupported_content', {
        chatId: event.chatId, messageType: event.messageType, nativeMessageId: event.nativeMessageId
      });
      sse.broadcast('unsupported_content', {
        chatId: event.chatId, messageId: event.nativeMessageId, messageType: event.messageType
      });
      return;
    }
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
    sendIntents.deliveryFailed(event.chatId, event.nativeMessageId);
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

  // The template ledger rechecks fresh owner evidence after the durable intent is claimed.
  // A scheduled trigger, including its original consent reference, never proves eligibility.
  const verifyProactiveTemplateAuthorization = async (
    intent: SendIntent, now: number
  ): Promise<VerifiedTemplateAuthorization> => {
    const source = intent.sourceId.match(/^a08:([a-f0-9]{64})$/);
    if (!source || intent.sourceKind !== 'autopilot' || intent.sourceRevision !== 1 ||
        intent.actionKind !== 'template' || !options.proactiveEligibility ||
        !recipientDirectory || !brandId || !intent.template || !intent.templateEligibility) {
      throw new Error('Trusted proactive template authorization is unavailable');
    }
    const trigger = capabilities.followups.get(source[1]!);
    const alias = recipientDirectory.resolve({ brandId, jid: intent.chatId });
    if (!trigger || trigger.status !== 'attempting' || trigger.brandId !== brandId ||
        !alias || alias.kind !== 'direct' || alias.contactId !== trigger.contactId ||
        trigger.consentRef !== intent.templateEligibility.consentRef ||
        trigger.sourceWorkflowId !== intent.templateEligibility.sourceWorkflowId ||
        trigger.templateRef !== intent.template.name) {
      throw new Error('Proactive source or recipient identity changed');
    }
    const live = await options.proactiveEligibility(trigger, now);
    if (live.channel !== 'meta-cloud' || live.optIn !== true ||
        live.templateApproved !== true || live.contactJid !== intent.chatId ||
        live.optedInAtMs !== intent.templateEligibility.optedInAtMs ||
        live.template?.name !== intent.template.name ||
        live.template?.languageCode !== intent.template.languageCode ||
        live.relevance?.relevant !== true ||
        live.relevance.sourceWorkflowId !== trigger.sourceWorkflowId) {
      throw new Error('Proactive consent, recipient or template authorization revoked');
    }
    return {
      consentRef: trigger.consentRef!,
      optedInAtMs: live.optedInAtMs,
      approvedTemplate: {
        name: live.template.name,
        languageCode: live.template.languageCode
      },
      sourceWorkflowId: trigger.sourceWorkflowId,
      relevant: true,
      relevanceVerifiedAtMs: live.relevance.verifiedAtMs,
      relevanceExpiresAtMs: live.relevance.expiresAtMs,
      quietHours: {
        from: live.quietHours.from,
        to: live.quietHours.to,
        timeZone: live.timeZone
      }
    };
  };

  sendIntents = new SendIntentService({
    memoryStore,
    diagnostics,
    brandId: recipientDirectory ? brandId : undefined,
    recipientDirectory,
    sendTemplate: metaClient ? (request) => metaClient.sendTemplate(request) : undefined,
    verifyTemplateEligibility: metaClient && options.proactiveEligibility
      ? verifyProactiveTemplateAuthorization
      : undefined,
    sendText: (chatId, text, sendOptions) => {
      if (!metaClient) {
        if (!whatsappClient) throw new Error('Baileys transport is not enabled in this runtime profile');
        return whatsappClient.sendMessage(chatId, text, sendOptions);
      }
      const lastInboundAtMs = memoryStore.getMessages(chatId, 100)
        .filter(message => !message.isFromMe)
        .reduce((latest, message) => Math.max(latest, message.timestamp), 0);
      return metaClient.sendText({ to: chatId, text, lastInboundAtMs });
    },
    prepareVoice: transportMode === 'baileys' && voiceSynthesizer
      ? (text) => voiceSynthesizer.synthesizeVoice(text, moderatorAgent.getPersona().voiceName)
      : undefined,
    sendVoice: transportMode === 'baileys' && voiceSynthesizer && whatsappClient
      ? (chatId, audio, sendOptions) => whatsappClient.sendVoiceNote(chatId, audio, {
        replyToMessageId: sendOptions?.replyToMessageId
      })
      : undefined,
    publish: (event, data) => sse.broadcast(event, data)
  });

  // Proactive delivery is opt-in at runtime: a trusted source must provide live
  // consent, template approval and workflow relevance for every actual send.
  if (runtimeProfile.proactiveEnabled && metaClient && recipientDirectory && brandId && options.proactiveEligibility) {
    proactiveScheduler = new ProactiveEngagementScheduler({
      store: capabilities.followups,
      eligibility: options.proactiveEligibility,
      sender: {
        submit: async (command: ProactiveTemplateIntentCommand) => {
          const trigger = capabilities.followups.get(command.triggerId);
          const alias = recipientDirectory.resolve({ brandId, jid: command.contactJid });
          if (!trigger || trigger.status !== 'attempting' ||
              command.brandId !== brandId || trigger.brandId !== brandId ||
              trigger.contactId !== command.contactId ||
              trigger.sourceWorkflowId !== command.sourceWorkflowId ||
              trigger.consentRef !== command.consentRef ||
              trigger.templateRef !== command.templateRef ||
              !alias || alias.kind !== 'direct' || alias.contactId !== trigger.contactId ||
              command.sourceId !== `a08:${trigger.triggerId}` ||
              command.template.name !== trigger.templateRef) {
            throw new Error('Proactive trigger or recipient does not match trusted identity');
          }
          const result = await sendIntents.sendTemplate({
            sourceKind: 'autopilot',
            sourceId: command.sourceId,
            sourceRevision: command.sourceRevision,
            actionKind: 'template',
            chatId: alias.jid,
            text: '',
            policyRevision: moderatorAgent.getPolicy().version,
            expiresAt: command.expiresAtMs,
            template: command.template,
            templateEligibility: {
              consentRef: command.consentRef,
              optedInAtMs: command.optedInAtMs,
              sourceWorkflowId: command.sourceWorkflowId,
              relevanceVerifiedAtMs: command.relevanceVerifiedAtMs,
              quietHours: command.quietHours
            }
          });
          return {
            intentId: result.intent.id,
            state: result.intent.state,
            providerMessageId: result.intent.nativeMessageId
          };
        },
        lookup: async (identity) => {
          if (identity.brandId !== brandId) return undefined;
          const saved = memoryStore.getSendLedger().getBySource({
            sourceKind: identity.sourceKind,
            sourceId: identity.sourceId,
            sourceRevision: identity.sourceRevision,
            actionKind: 'template'
          });
          return saved ? {
            intentId: saved.id,
            state: saved.state,
            providerMessageId: saved.nativeMessageId
          } : undefined;
        }
      }
    });
  }

  // Initialize Scatter-Gather Funnel Engine (WA-023: only when the profile enables it)
  const funnelEngine = runtimeProfile.funnelEnabled ? createDefaultFunnelEngine({ port }) : undefined;

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
    transportMode,
    runtimeProfile: runtimeProfile.name,
    capabilityMatrix: capabilityMatrix(runtimeProfile, transportMode),
    funnelDisabled: !runtimeProfile.funnelEnabled
  });

  registerCapabilityRoutes(app, capabilities, options.capabilityToken ?? process.env.AGENT_CAPABILITIES_OWNER_TOKEN ?? '');
  if (metaClient) registerMetaCloudWebhookRoutes(app, metaClient);

  // Serve static UI assets if built
  app.use('/*', serveStatic({ root: './ui/dist' }));
  app.get('*', serveStatic({ path: './ui/dist/index.html' }));

  const proactiveAbort = options.autoConnect && proactiveScheduler ? new AbortController() : undefined;
  if (proactiveAbort && proactiveScheduler) {
    void proactiveScheduler.start({
      signal: proactiveAbort.signal,
      onError: (error) => console.warn('[Proactive] Scheduler tick failed:', describeError(error))
    });
  }
  let deliveryRetryTimer: ReturnType<typeof setInterval> | undefined;
  if (options.autoConnect) {
    deliveryRetryTimer = setInterval(() => {
      if (metaClient || whatsappClient?.getState().state === 'connected') {
        void sendIntents.dispatchDue().catch((error) => console.warn('[Delivery] Retry scan failed:', describeError(error)));
      }
    }, 5000);
    deliveryRetryTimer.unref();
    if (whatsappClient) void whatsappClient.start();
  }

  const shutdown = async () => {
    if (deliveryRetryTimer) clearInterval(deliveryRetryTimer);
    clearInterval(inboundRecoveryTimer);
    await reflectionWorker?.stopPeriodicSweep();
    proactiveAbort?.abort();
    // WA-008: drain and retry outstanding learning-state writes before closing stores.
    await dualMemoryManager.flushPendingWrites();
    // WA-007: stop intake first so late inbound work is durably deferred to
    // the job ledger, then drain within a deadline and report what is left.
    burstAccumulator.stopIntake();
    const drainResult = await burstAccumulator.drain({ deadlineMs: 10_000 });
    if (!drainResult.completed) {
      console.warn('[Shutdown] Burst drain deadline elapsed; callbacks still running for:', drainResult.inFlightChats);
    }
    sse.close();
    if (transportMode === 'baileys') {
      await whatsappClient?.disconnect(false);
    }
    memoryStore.close();
    recipientDirectory?.close();
    capabilities.followups.close();
  };

  const unregSchedulers = defaultLifecycle.register('schedulers', 'stop_ingestion', async () => {
    if (deliveryRetryTimer) clearInterval(deliveryRetryTimer);
    await reflectionWorker?.stopPeriodicSweep();
    proactiveAbort?.abort();
  });
  const unregBurst = defaultLifecycle.register('burst_queue', 'drain_queues', async () => {
    clearInterval(inboundRecoveryTimer);
    burstAccumulator.stopIntake();
    const result = await burstAccumulator.drain({ deadlineMs: 10_000 });
    if (!result.completed) {
      console.warn('[Shutdown] Burst drain deadline elapsed; callbacks still running for:', result.inFlightChats);
    }
  });
  const unregTransport = defaultLifecycle.register('transport', 'disconnect_transport', async () => {
    sse.close();
    if (transportMode === 'baileys') {
      await whatsappClient?.disconnect(false);
    }
  });
  const unregDatastores = defaultLifecycle.register('datastores', 'close_datastores', async () => {
    await dualMemoryManager.flushPendingWrites();
    memoryStore.close();
    recipientDirectory?.close();
    capabilities.followups.close();
  });

  return {
    app,
    port,
    learningMirror,
    memoryStore,
    whatsappClient,
    metaClient,
    runtimeProfile: runtimeProfile.name,
    capabilityMatrix: capabilityMatrix(runtimeProfile, transportMode),
    recipientDirectory,
    transportMode,
    moderatorAgent,
    coordinator,
    inboundPlanner,
    proactiveScheduler,
    stopProactiveScheduler: () => proactiveAbort?.abort(),
    burstAccumulator,
    sse,
    capabilities,
    funnelEngine,
    dualMemoryManager,
    reflectionWorker,
    reflectionEngine,
    shutdown,
    unregisterLifecycle: () => {
      unregSchedulers();
      unregBurst();
      unregTransport();
      unregDatastores();
    }
  };
}

if (import.meta.main) {
  const host = process.env.HOST || '127.0.0.1';
  assertSafeDashboardBind(host, process.env.AGENT_DASHBOARD_TOKEN ?? '');
  defaultLifecycle.attachSignalHandlers();
  const agent = await createFableWhatsAppAgent({ autoConnect: true });
  console.log(`✨ [Fable Agentic WhatsApp] Live at http://localhost:${agent.port}`);
  const server = Bun.serve({
    fetch: agent.app.fetch,
    port: agent.port,
    hostname: host
  });
  defaultLifecycle.register('http_server', 'stop_ingestion', () => {
    server.stop(true);
  });
}
