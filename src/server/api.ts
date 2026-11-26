import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { MEDIA_LIMITS, sniffImageMime, sharedMediaLimiter, decodeStickerBase64, readRequestBodyTextWithCap, MediaTooLargeError } from '../agent/media-bounds';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ModeratorAgent } from '../ai/moderator-agent';
import type { VoiceSynthesizer } from '../ai/voice-synthesizer';
import type { MemoryStore } from '../domain/memory-store';
import { SendIntentService } from '../domain/send-intent-service';
import type { ChatMessage } from '../domain/types';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import type { SSEBroadcaster } from './sse';
import type { FableFunnelEngine } from '../funnel';
import { createDefaultFunnelEngine } from '../funnel/default-engine';
import { registerDashboardAuth } from './dashboard-auth';
import { UserMemoryManager } from '../domain/user-memory';
import { handleGitHubWebhook } from './github-webhook';
import { cleanWorkspaceData } from './workspace-cleaner';
import { registerBroadcastRoutes } from './broadcast-routes';
import { BroadcastComposer } from '../agent/broadcast-composer';
import { BroadcastOrchestrator } from '../agent/broadcast-orchestrator';
import type { DualMemoryManager } from '../domain/learning-memory';
import type { ReflectionWorker } from '../agent/reflection-worker';
import type { ReflectionEngine } from '../ai/reflection-engine';
import type { DiagnosticsCore } from '../observability/diagnostics-core';
import type { RsiLedger } from '../domain/rsi-ledger';
import type { RsiCycleOrchestrator } from '../ai/rsi-loop';
import type { JepaWorldModel } from '../ai/jepa-world-model';
import type { McpClientManager } from '../mcp/client-manager';

const allowedOrigins = new Set(['http://localhost:3000','http://127.0.0.1:3000','http://localhost:5173','http://127.0.0.1:5173',...((process.env.AGENT_ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean))]);
const trustedOrigin=(origin:string)=>allowedOrigins.has(origin);

// A short heartbeat survives reverse proxies that drop idle HTTP streams after 10 seconds.
export const SSE_KEEP_ALIVE_MS = 5000;

export interface ApiDependencies {
  memoryStore: MemoryStore;
  whatsappClient?: WhatsAppSocketClient;
  /** WA-023: explicit profile state for capability reporting and disabled responses. */
  runtimeProfile?: string;
  capabilityMatrix?: Array<{ capability: string; enabled: boolean; reason: string }>;
  funnelDisabled?: boolean;
  moderatorAgent: ModeratorAgent;
  sse: SSEBroadcaster;
  audioTranscriber?: AudioTranscriber;
  voiceSynthesizer?: VoiceSynthesizer;
  funnelEngine?: FableFunnelEngine;
  dashboardToken?: string;
  sseHeartbeatMs?: number;
  dualMemoryManager?: DualMemoryManager;
  reflectionWorker?: ReflectionWorker;
  reflectionEngine?: ReflectionEngine;
  rsiLedger?: RsiLedger;
  rsiOrchestrator?: RsiCycleOrchestrator;
  jepaWorldModel?: JepaWorldModel;
  sendIntents?: SendIntentService;
  diagnostics?: DiagnosticsCore;
  transportMode?: 'baileys' | 'meta-cloud';
  dataDir?: string;
  mcpClientManager?: McpClientManager;
  broadcastOrchestrator?: BroadcastOrchestrator;
}

export function createApiServer(deps: ApiDependencies): Hono {
  const app = new Hono();
  const getWorkspaceDataDir = () => deps.dataDir ?? deps.memoryStore.getDataDir?.() ?? './data';
  let delivery = deps.sendIntents;
  const getDelivery = () => delivery ??= new SendIntentService({
    memoryStore: deps.memoryStore,
    diagnostics: deps.diagnostics,
    sendText: (chatId, text, options) => {
      if (!deps.whatsappClient) throw new Error('Baileys transport is not enabled in this runtime profile');
      return deps.whatsappClient.sendMessage(chatId, text, options);
    },
    sendSticker: deps.whatsappClient && deps.transportMode !== 'meta-cloud'
      ? (chatId, bytes, options) => {
          if (!deps.whatsappClient) throw new Error('WhatsApp client unavailable');
          return deps.whatsappClient.sendSticker(chatId, bytes, options);
        }
      : undefined,
    prepareVoice: deps.voiceSynthesizer
      ? (text) => {
          if (!deps.voiceSynthesizer) throw new Error('Voice synthesizer unavailable');
          return deps.voiceSynthesizer.synthesizeVoice(text, deps.moderatorAgent.getPersona().voiceName);
        }
      : undefined,
    sendVoice: deps.voiceSynthesizer && deps.whatsappClient
      ? (chatId, audio, options) => {
          if (!deps.whatsappClient) throw new Error('WhatsApp client unavailable');
          return deps.whatsappClient.sendVoiceNote(chatId, audio, { replyToMessageId: options?.replyToMessageId });
        }
      : undefined,
    publish: (event, data) => deps.sse.broadcast(event, data)
  });
  // WA-023: when the profile disables the funnel, routes answer with explicit disabled
  // responses instead of silently creating an engine.
  const funnelEngine = deps.funnelDisabled ? undefined : (deps.funnelEngine ?? createDefaultFunnelEngine());

  // Only configured origins may issue browser mutations or read cross-origin API responses.
  // CLI/service callers without a browser Origin remain supported; bind the server to loopback by default.
  app.use('*',async(c,next)=>{
    const origin=c.req.header('origin');
    if(origin && origin !== new URL(c.req.url).origin && !trustedOrigin(origin) && !['GET','HEAD','OPTIONS'].includes(c.req.method))return c.json({error:'Cross-origin request forbidden'},403);
    await next();
    return undefined;
  });
  app.use('*', cors({origin:(origin)=>trustedOrigin(origin)?origin:''}));
  registerDashboardAuth(app, deps.dashboardToken ?? '');

  // Both scopes are explicit: persisted SQLite counts survive restarts; traces do not.
  app.get('/api/diagnostics', (c) => {
    c.header('Cache-Control', 'no-store');
    let snapshot = null as ReturnType<DiagnosticsCore['snapshot']> | null;
    try {
      snapshot = deps.diagnostics?.snapshot() ?? null;
    } catch {
      // A failed in-memory collector cannot hide durable delivery statistics.
    }
    return c.json({
      persisted: deps.memoryStore.getSendLedger().getDiagnosticsSummary(),
      process: {
        scope: 'current_process',
        status: snapshot ? 'available' : 'unavailable',
        snapshot
      }
    });
  });

  // Liveness & Readiness Probes
  const handleLiveness = (c: Context) => {
    let dbAvailable = false;
    try {
      dbAvailable = Boolean(deps.memoryStore);
    } catch (err) {
      console.warn('[API] Healthcheck datastore probe failed:', err);
      dbAvailable = false;
    }
    const isHealthy = dbAvailable;
    return c.json({
      status: isHealthy ? 'ok' : 'unhealthy',
      uptimeSeconds: Math.round(process.uptime()),
      database: dbAvailable ? 'available' : 'unavailable',
      timestamp: Date.now()
    }, isHealthy ? 200 : 503);
  };
  app.get('/healthz', handleLiveness);
  app.get('/api/healthz', handleLiveness);

  const handleReadiness = (c: Context) => {
    let dbOk = false;
    let chatsCount = 0;
    try {
      chatsCount = deps.memoryStore.listChats().length;
      dbOk = true;
    } catch (err) {
      console.warn('[API] Readiness probe database verification failed:', err);
      dbOk = false;
    }

    const state = deps.whatsappClient && typeof deps.whatsappClient.getState === 'function'
      ? deps.whatsappClient.getState()
      : { state: 'disconnected' };
    const transportMode = deps.transportMode ?? 'baileys';
    // WA-010: readiness must reflect the serving channel, not the datastore
    // alone. Baileys serves only when connected; meta-cloud is a stateless
    // webhook channel, so mode configuration is the readiness signal and
    // outbound credential validity is enforced per send.
    const channelReady = transportMode === 'meta-cloud' ? true : state.state === 'connected';
    const isReady = dbOk && channelReady;

    const payload = {
      status: isReady ? 'ready' : 'unready',
      checks: {
        database: dbOk ? 'healthy' : 'unhealthy',
        chatsCount,
        transport: {
          mode: transportMode,
          state: state.state,
          ready: channelReady
        }
      },
      timestamp: Date.now()
    };

    return c.json(payload, isReady ? 200 : 503);
  };
  app.get('/readyz', handleReadiness);
  app.get('/api/readyz', handleReadiness);

  // Status & Connection
  app.get('/api/status', (c) => {
    if (!deps.whatsappClient) {
      return c.json({
        state: 'disabled',
        transportMode: deps.transportMode ?? 'baileys',
        metaCloudConfigured: deps.transportMode === 'meta-cloud',
        reason: 'Baileys transport is not enabled in this runtime profile'
      });
    }
    const state = deps.whatsappClient.getState();
    const pendingDrafts = deps.memoryStore.getPendingDrafts();
    return c.json({
      ...state,
      transportMode: deps.transportMode ?? 'baileys',
      metaCloudConfigured: deps.transportMode === 'meta-cloud',
      pendingDraftsCount: pendingDrafts.length
    });
  });

  // WA-023: capability matrix for the active runtime profile
  app.get('/api/runtime/capabilities', (c) => {
    return c.json({
      profile: deps.runtimeProfile ?? 'FULL',
      capabilities: deps.capabilityMatrix ?? []
    });
  });

  app.get('/api/db/health', async (c) => {
    const { testDatabaseConnection } = await import('./supabase');
    const health = await testDatabaseConnection();
    return c.json(health);
  });

  app.post('/api/connect', async (c) => {
    if (deps.transportMode === 'meta-cloud') {
      return c.json({ error: 'Baileys pairing is disabled in Meta Cloud transport mode' }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const phone = body.pairingPhoneNumber ? String(body.pairingPhoneNumber) : undefined;
    const refresh = Boolean(body.refresh);
    if (!deps.whatsappClient) {
      return c.json({ error: 'Baileys pairing is not enabled in this runtime profile' }, 503);
    }
    void deps.whatsappClient.start(phone, { refresh });
    return c.json({ status: 'initiated', phone, refresh });
  });

  app.post('/api/disconnect', async (c) => {
    if (deps.transportMode === 'meta-cloud') {
      return c.json({ error: 'Baileys disconnect is disabled in Meta Cloud transport mode' }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    if (!deps.whatsappClient) {
      return c.json({ error: 'Baileys disconnect is not enabled in this runtime profile' }, 503);
    }
    const clearSession = body.clearSession !== false;
    await deps.whatsappClient.disconnect(clearSession);
    return c.json({ status: 'disconnected' });
  });

  // Chats
  app.get('/api/chats', (c) => {
    const chats = deps.memoryStore.listChats();
    return c.json({ chats });
  });

  app.delete('/api/chats/:chatId', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const success = deps.memoryStore.deleteChat(chatId);
    deps.sse.broadcast('chat_deleted', { chatId });
    return c.json({ success, chatId });
  });

  app.delete('/api/chats/:chatId/messages', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const success = deps.memoryStore.clearChatMessages(chatId);
    deps.sse.broadcast('messages_cleared', { chatId });
    return c.json({ success, chatId });
  });

  app.get('/api/chats/:chatId/folds', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    c.header('Cache-Control', 'no-store');
    const rawTier = c.req.query('tier');
    const tier = rawTier === undefined || rawTier === '' ? undefined : Number(rawTier);
    if (tier !== undefined && tier !== 1 && tier !== 2 && tier !== 3) {
      return c.json({ error: 'Invalid tier: expected 1, 2 or 3' }, 400);
    }
    return c.json({ chatId, folds: deps.memoryStore.getFolds(chatId, tier) });
  });

  app.get('/api/chats/:chatId/context-status', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    c.header('Cache-Control', 'no-store');
    const engine = typeof deps.moderatorAgent?.getContextFoldEngine === 'function'
      ? deps.moderatorAgent.getContextFoldEngine()
      : null;
    const maybePreferredModel = deps.moderatorAgent && 'getPreferredModel' in deps.moderatorAgent ? deps.moderatorAgent.getPreferredModel : undefined;
    const model = typeof deps.moderatorAgent?.getPersona === 'function'
      ? deps.moderatorAgent.getPersona()?.model
      : (typeof maybePreferredModel === 'function'
        ? maybePreferredModel.call(deps.moderatorAgent)
        : undefined);
    const status = engine?.getContextBudgetStatus(chatId, model);
    return c.json({ chatId, status: status ?? null });
  });

  app.get('/api/chats/:chatId/memory-search', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const query = c.req.query('query') ?? c.req.query('q') ?? '';
    const limit = Math.max(1, Math.min(50, Number(c.req.query('limit') ?? 25)));
    c.header('Cache-Control', 'no-store');
    return c.json({ chatId, query, results: deps.memoryStore.searchMemory(chatId, query, limit) });
  });

  app.get('/api/chats/:chatId/folds/:foldId/decompress', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const foldId = c.req.param('foldId');
    const fold = deps.memoryStore.getFold(foldId);
    if (!fold || fold.chatId !== chatId) return c.json({ error: 'Fold not found' }, 404);
    const raw = deps.memoryStore.getFoldMessages(foldId);
    const aroundId = c.req.query('around');
    if (aroundId && !fold.directMessageIds.includes(aroundId)) {
      return c.json({ error: 'Message outside fold' }, 400);
    }
    const messages = aroundId
      ? deps.memoryStore.getMessageWindow(chatId, aroundId, 2)
      : raw;
    c.header('Cache-Control', 'no-store');
    return c.json({ foldId, chatId, total: raw.length, messages });
  });

  app.post('/api/chats/:chatId/fold-now', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const engine = deps.moderatorAgent.getContextFoldEngine();
    if (!engine) return c.json({ error: 'Context folding is disabled' }, 503);
    void engine.triggerFoldCheck(chatId);
    return c.json({ chatId, status: 'scheduled' }, 202);
  });

  app.get('/api/chats/:chatId/messages', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const rawLimit = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.max(1, Math.min(Math.floor(rawLimit), 200)) : 50;
    const messages = deps.memoryStore.getMessages(chatId, limit);
    const outstandingIntents = deps.memoryStore.getSendLedger().getOutstanding(chatId);
    const lastAttemptMap = outstandingIntents.length > 0
      ? deps.memoryStore.getSendLedger().getLastAttempts(outstandingIntents.map((i) => i.id))
      : new Map<string, number>();

    const outstanding: ChatMessage[] = outstandingIntents.map((intent): ChatMessage => {
      return {
        id: `intent:${intent.id}`,
        sendIntentId: intent.id,
        chatId: intent.chatId,
        sender: 'me',
        text: intent.text,
        timestamp: intent.createdAt,
        isFromMe: true,
        type: intent.actionKind === 'voice' ? 'audio' : 'text',
        replyToId: intent.replyToMessageId,
        status: 'pending',
        deliveryState: intent.state === 'queued' || intent.state === 'attempting' || intent.state === 'uncertain' || intent.state === 'failed' ? intent.state : undefined,
        lastAttemptAt: lastAttemptMap.get(intent.id),
        nativeMessageId: intent.nativeMessageId
      };
    });
    messages.push(...outstanding);
    messages.sort((a, b) => a.timestamp - b.timestamp);
    deps.memoryStore.markChatRead(chatId);
    deps.sse.broadcast('chat_updated', { chatId, unreadCount: 0 });
    return c.json({ messages });
  });

  app.post('/api/chats/:chatId/messages', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const body = await c.req.json().catch(() => ({}));
    const messageText = String(body.text ?? '');
    const replyToMessageId = body.replyToMessageId ? String(body.replyToMessageId) : undefined;

    if (!messageText.trim()) return c.json({ error: 'Text is required' }, 400);

    try {
      const result = await getDelivery().sendText({
        sourceKind: 'ui',
        sourceId: String(body.clientMutationId || c.req.header('Idempotency-Key') || crypto.randomUUID()),
        sourceRevision: Number(body.sourceRevision ?? 1),
        actionKind: 'text',
        chatId,
        text: messageText,
        replyToMessageId,
        policyRevision: 1
      });
      const success = ['accepted', 'delivered', 'read'].includes(result.intent.state);
      const payload = {
        success,
        intentId: result.intent.id,
        state: result.intent.state,
        message: result.message,
        needsReconciliation: result.intent.state === 'uncertain'
      };
      return success ? c.json(payload) : c.json(payload, 202);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : '';
      return c.json({ error: msg }, name === 'SendIntentConflictError' ? 409 : 500);
    }
  });

  app.post('/api/chats/:chatId/stickers', async (c) => {
    if (!deps.whatsappClient || deps.transportMode === 'meta-cloud') {
      return c.json({ error: 'Sticker delivery requires Baileys transport' }, 503);
    }
    const maxBody = 144_000;
    if (Number(c.req.header('content-length') ?? 0) > maxBody) return c.json({ error: 'Sticker request too large' }, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(await readRequestBodyTextWithCap(c.req.raw, maxBody));
    } catch (err) {
      return c.json({ error: 'Invalid sticker request' }, err instanceof MediaTooLargeError ? 413 : 400);
    }
    if (typeof payload !== 'object' || payload === null ||
        !('stickerBase64' in payload) || typeof payload.stickerBase64 !== 'string' || !decodeStickerBase64(payload.stickerBase64) ||
        !('clientMutationId' in payload) || typeof payload.clientMutationId !== 'string' ||
        !payload.clientMutationId.trim() || payload.clientMutationId.length > 128) {
      return c.json({ error: 'A valid WebP sticker and client mutation ID are required' }, 400);
    }
    try {
      const chatId = await deps.whatsappClient.canonicalizeJid(c.req.param('chatId'));
      const result = await getDelivery().sendSticker({
        sourceKind: 'ui', sourceId: payload.clientMutationId, sourceRevision: 1,
        actionKind: 'sticker', chatId, text: '[Sticker]', stickerBase64: payload.stickerBase64, policyRevision: 1,
      });
      const success = ['accepted', 'delivered', 'read'].includes(result.intent.state);
      const response = { success, intentId: result.intent.id, state: result.intent.state, message: result.message };
      return c.json(response, success ? 200 : 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sticker delivery failed';
      return c.json({ error: message }, err instanceof Error && err.name === 'SendIntentConflictError' ? 409 : 500);
    }
  });

  app.post('/api/send-intents/:intentId/retry', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.confirm !== true) return c.json({ error: 'Explicit retry confirmation is required' }, 400);
    const intentId = c.req.param('intentId');
    try {
      const result = await getDelivery().retryUncertain(
        intentId, String(body.clientMutationId || crypto.randomUUID())
      );
      const success = ['accepted', 'delivered', 'read'].includes(result.intent.state);
      const payload = {
        success,
        intentId: result.intent.id,
        state: result.intent.state,
        message: result.message,
        needsReconciliation: result.intent.state === 'uncertain'
      };
      return success ? c.json(payload) : c.json(payload, 202);
    } catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post('/api/chats/:chatId/mode', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const body = await c.req.json();
    const mode = body.mode;
    if (!['autopilot', 'copilot', 'human'].includes(mode)) {
      return c.json({ error: 'Invalid mode' }, 400);
    }
    deps.memoryStore.setChatMode(chatId, mode);
    deps.sse.broadcast('chat_updated', { chatId, agentMode: mode });
    return c.json({ success: true, chatId, mode });
  });

  app.post('/api/chats/:chatId/reaction', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const body = await c.req.json();
    const { messageId, emoji } = body;
    if (!messageId || !emoji) {
      return c.json({ error: 'messageId and emoji are required' }, 400);
    }
    if (!deps.whatsappClient) {
      return c.json({ error: 'Baileys transport is not enabled in this runtime profile' }, 503);
    }
    await deps.whatsappClient.sendReaction(chatId, messageId, emoji);
    return c.json({ success: true });
  });

  // Drafts
  app.get('/api/drafts', (c) => {
    const drafts = deps.memoryStore.getPendingDrafts();
    return c.json({ drafts });
  });

  app.get('/api/mcp/external', (c) => {
    return c.json({
      servers: deps.mcpClientManager?.getHealthReport() ?? [],
      tools: deps.mcpClientManager?.listAvailableTools() ?? []
    });
  });

  app.post('/api/drafts/:draftId/approve', async (c) => {
    const draftId = c.req.param('draftId');
    const body = await c.req.json().catch(() => ({}));
    const draft = deps.memoryStore.getDraft(draftId);
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    let replyText = String(body.editedText || body.replyText || draft.proposedReply || '');
    const asVoice = Boolean(deps.voiceSynthesizer) &&
      (body.asVoice !== undefined ? Boolean(body.asVoice) : Boolean(draft.sendAsVoiceNote));

    if (draft.toolCall && draft.status === 'pending') {
      if (!deps.mcpClientManager) {
        return c.json({ error: 'External MCP client manager is not configured to execute tool draft' }, 503);
      }
      const toolResult = await deps.mcpClientManager.callTool(draft.toolCall.namespacedName, draft.toolCall.args);
      if (!toolResult.ok) {
        return c.json({ error: toolResult.error || 'External MCP tool execution failed', toolResult }, 502);
      }
      if (!replyText.trim()) {
        replyText = draft.toolCall.proposedFollowUp?.trim() || `Done — executed ${draft.toolCall.toolName}.`;
      }
    }

    try {
      const approved = await getDelivery().approveDraft(draftId, replyText, 1, asVoice);
      if (!approved.result) return c.json({ error: 'Draft already processed' }, 409);
      if (approved.created && deps.reflectionWorker) {
        if (draft.proposedReply !== replyText) {
          deps.reflectionWorker.recordModerationFeedback({
            chatId: draft.chatId,
            draftId,
            feedbackType: 'edited',
            originalReply: draft.proposedReply,
            revisedReply: replyText,
            humanNote: 'Operator revised draft prior to approval'
          });
        } else {
          deps.reflectionWorker.recordModerationFeedback({
            chatId: draft.chatId,
            draftId,
            feedbackType: 'approved',
            originalReply: draft.proposedReply,
            humanNote: 'Operator approved draft as-is'
          });
        }
      }
      deps.sse.broadcast('draft_updated', {
        draftId,
        status: approved.result.intent.state === 'accepted' ? 'sent' : 'approved'
      });
      const success = ['accepted', 'delivered', 'read'].includes(approved.result.intent.state);
      const payload = {
        success,
        alreadyProcessed: !approved.created,
        intentId: approved.result.intent.id,
        state: approved.result.intent.state,
        message: approved.result.message,
        needsReconciliation: approved.result.intent.state === 'uncertain'
      };
      return success ? c.json(payload) : c.json(payload, 202);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : '';
      return c.json({ error: msg }, name === 'SendIntentConflictError' ? 409 : 500);
    }
  });

  app.post('/api/drafts/:draftId/reject', (c) => {
    const draftId = c.req.param('draftId');
    const draft = deps.memoryStore.getDraft(draftId);
    deps.memoryStore.updateDraftStatus(draftId, 'rejected');
    deps.sse.broadcast('draft_updated', { draftId, status: 'rejected' });

    if (deps.reflectionWorker && draft) {
      deps.reflectionWorker.recordModerationFeedback({
        chatId: draft.chatId,
        draftId,
        feedbackType: 'rejected',
        originalReply: draft.proposedReply,
        humanNote: 'Operator rejected draft'
      });
    }

    return c.json({ success: true, draftId });
  });

  // Continuous Learning & Memory Reflection API
  app.get('/api/learning/state', (c) => {
    const memoryManager = deps.dualMemoryManager || deps.moderatorAgent.getDualMemoryManager();
    if (!memoryManager) {
      return c.json({ error: 'Dual memory manager not initialized' }, 404);
    }
    const wb = memoryManager.getWorkbook();
    const nb = memoryManager.getNotebook();
    const reflections = deps.memoryStore.getReflectionRuns(undefined, 10);
    return c.json({
      workbook: wb,
      notebook: nb,
      needsCompaction: memoryManager.needsCompaction(),
      recentReflections: reflections
    });
  });

  app.post('/api/learning/reflect', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const chatId = body?.chatId;
    if (deps.reflectionWorker && chatId) {
      const result = await deps.reflectionWorker.reflectOnThread(chatId, 'manual_api');
      return c.json({ success: true, result });
    } else if (deps.reflectionWorker) {
      const sweep = await deps.reflectionWorker.sweepColdThreads();
      return c.json({ success: true, sweep });
    }
    return c.json({ error: 'Reflection worker not available' }, 400);
  });

  app.put('/api/learning/rules', async (c) => {
    const body = await c.req.json();
    const memoryManager = deps.dualMemoryManager || deps.moderatorAgent.getDualMemoryManager();
    if (!memoryManager) {
      return c.json({ error: 'Dual memory manager not initialized' }, 404);
    }
    if (typeof body?.rule === 'string' && body.rule.trim()) {
      memoryManager.addEnforcedRule(body.rule);
      return c.json({ success: true, workbook: memoryManager.getWorkbook() });
    }
    return c.json({ error: 'Invalid rule string' }, 400);
  });

  app.post('/api/learning/compact', async (c) => {
    const engine = deps.reflectionEngine;
    if (!engine) {
      return c.json({ error: 'Reflection engine not initialized' }, 400);
    }
    const compacted = await engine.performCompaction();
    const memoryManager = deps.dualMemoryManager || deps.moderatorAgent.getDualMemoryManager();
    return c.json({
      success: true,
      compacted,
      workbook: memoryManager?.getWorkbook()
    });
  });

  app.get('/api/learning/rsi/status', (c) => {
    const brandId = c.req.query('brandId') || 'default';
    if (!deps.rsiLedger || !deps.jepaWorldModel) {
      return c.json({ error: 'RSI world model not initialized' }, 404);
    }
    const recentTransitions = deps.rsiLedger.getRecentTransitions(brandId, 100);
    const opfDiagnostics = deps.jepaWorldModel.computeOpfDiagnostics(recentTransitions);
    return c.json({
      brandId,
      latestGeneration: deps.rsiLedger.getLatestPromotedGeneration(brandId),
      recentGenerations: deps.rsiLedger.getRecentGenerations(brandId, 10),
      recentTransitions: recentTransitions.slice(0, 20),
      opfDiagnostics
    });
  });

  app.post('/api/learning/rsi/cycle', async (c) => {
    if (!deps.rsiOrchestrator) {
      return c.json({ error: 'RSI orchestrator not initialized' }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const brandId = typeof body?.brandId === 'string' && body.brandId.trim() ? body.brandId.trim() : 'default';
    const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
    const result = deps.rsiOrchestrator.runCycle({
      brandId,
      chatId: typeof body?.chatId === 'string' ? body.chatId : undefined,
      candidates,
      feedbackType: body?.feedbackType,
      intent: typeof body?.intent === 'string' ? body.intent : undefined
    });
    return c.json({ success: true, result });
  });

  app.get('/api/learning/harness', (c) => {
    const memoryManager = deps.dualMemoryManager || deps.moderatorAgent.getDualMemoryManager();
    if (!memoryManager) {
      return c.json({ error: 'Dual memory manager not initialized' }, 404);
    }
    const query = c.req.query('q') || '';
    const chatId = c.req.query('chatId') || undefined;
    const store = memoryManager.getHarnessStore();
    const entries = query
      ? store.rankEntries(query, { chatId, limit: 25 })
      : store.listEntries({ chatId });
    return c.json({ entries });
  });

  app.post('/api/learning/rsi/rollback', async (c) => {
    if (!deps.rsiOrchestrator) {
      return c.json({ error: 'RSI orchestrator not initialized' }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const brandId = typeof body?.brandId === 'string' && body.brandId.trim() ? body.brandId.trim() : 'default';
    const generationId = Number(body?.generationId);
    if (!Number.isSafeInteger(generationId) || generationId < 1) {
      return c.json({ error: 'Invalid generationId' }, 400);
    }
    const outcome = deps.rsiOrchestrator.rollbackGeneration(brandId, generationId);
    return outcome.rolledBack
      ? c.json({ success: true, ...outcome })
      : c.json({ success: false, ...outcome }, 404);
  });

  // Persona & Configuration
  app.get('/api/persona', (c) => {
    return c.json({
      persona: deps.moderatorAgent.getPersona(),
      policy: deps.moderatorAgent.getPolicy()
    });
  });

  app.put('/api/persona', async (c) => {
    const body = await c.req.json();
    if (body.persona) deps.moderatorAgent.updatePersona(body.persona);
    if (body.policy) deps.moderatorAgent.updatePolicy(body.policy);
    return c.json({
      success: true,
      persona: deps.moderatorAgent.getPersona(),
      policy: deps.moderatorAgent.getPolicy()
    });
  });

  // Contact Dossier (Entity Memory & Commitments)
  app.get('/api/contacts/:chatId/dossier', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const dossier = deps.memoryStore.getDossier(chatId) ?? {
      chatId,
      name: chatId.split('@')[0],
      stage: 'lead',
      facts: [],
      commitments: [],
      updatedAt: Date.now()
    };
    return c.json({ dossier });
  });

  app.put('/api/contacts/:chatId/dossier', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const body = await c.req.json();
    const existing = deps.memoryStore.getDossier(chatId) ?? {
      chatId,
      name: body.name || chatId.split('@')[0],
      stage: 'lead',
      facts: [],
      commitments: [],
      updatedAt: Date.now()
    };

    const updated = {
      ...existing,
      ...body,
      chatId,
      updatedAt: Date.now()
    };
    deps.memoryStore.saveDossier(updated);
    deps.sse.broadcast('dossier_updated', { chatId, dossier: updated });
    return c.json({ success: true, dossier: updated });
  });

  app.post('/api/contacts/:chatId/dossier/facts', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const body = await c.req.json();
    const fact = String(body.fact || '').trim();
    if (!fact) return c.json({ error: 'Fact is required' }, 400);

    deps.memoryStore.addFactToDossier(chatId, fact);
    const updated = deps.memoryStore.getDossier(chatId);
    deps.sse.broadcast('dossier_updated', { chatId, dossier: updated });
    return c.json({ success: true, dossier: updated });
  });

  app.post('/api/contacts/:chatId/dossier/commitments', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    const body = await c.req.json();
    const commitment = String(body.commitment || '').trim();
    if (!commitment) return c.json({ error: 'Commitment is required' }, 400);

    deps.memoryStore.addCommitmentToDossier(chatId, commitment);
    const updated = deps.memoryStore.getDossier(chatId);
    deps.sse.broadcast('dossier_updated', { chatId, dossier: updated });
    return c.json({ success: true, dossier: updated });
  });

  // Keep preview requests outside live conversations and customer history.
  app.post('/api/simulate', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000 ||
        (body.senderName !== undefined && (typeof body.senderName !== 'string' || body.senderName.length > 120))) {
      return c.json({ error: 'Enter a test message of up to 4,000 characters' }, 400);
    }

    const simulatedMsg: ChatMessage = {
      id: crypto.randomUUID(),
      chatId: `sim_${crypto.randomUUID()}@simulator.invalid`,
      sender: 'simulator_user',
      senderName: body.senderName?.trim() || 'عميل تجريبي',
      text: body.text.trim(),
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = await deps.moderatorAgent.processInboundMessage(simulatedMsg, { dryRun: true });
    c.header('Cache-Control', 'no-store');
    return c.json({
      success: true,
      simulatedMessage: simulatedMsg,
      decision: result.decision,
      draftCreated: result.draftCreated,
      shouldSendImmediately: result.shouldSendImmediately
    });
  });

  // Sticker Studio conversion endpoint
  app.post('/api/media/sticker', async (c) => {
    // WA-017: reject oversized requests before JSON/base64 decoding allocates memory.
    const declaredLength = Number(c.req.header('content-length') ?? 0);
    if (declaredLength > MEDIA_LIMITS.maxStickerRequestBytes) {
      return c.json({ error: 'Sticker request exceeds maximum allowable size' }, 413);
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.imageBase64 !== 'string' || !body.imageBase64.trim()) {
      return c.json({ error: 'imageBase64 is required' }, 400);
    }
    if (body.imageBase64.length > 15 * 1024 * 1024) {
      return c.json({ error: 'Image exceeds maximum allowable size (10MB)' }, 413);
    }

    try {
      const cleanBase64 = body.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
      const inputBuffer = Buffer.from(cleanBase64, 'base64');
      if (inputBuffer.length === 0) {
        return c.json({ error: 'Decoded image buffer is empty' }, 400);
      }
      // WA-017: decoded-size cap and magic-byte MIME validation; declared types are never trusted.
      if (inputBuffer.length > MEDIA_LIMITS.maxStickerDecodedBytes) {
        return c.json({ error: 'Decoded image exceeds maximum allowable size (10MB)' }, 413);
      }
      if (!sniffImageMime(inputBuffer)) {
        return c.json({ error: 'Unsupported image content: expected PNG, JPEG, GIF or WebP' }, 415);
      }

      if (!Bun.which('cwebp')) {
        return c.json({ error: 'cwebp utility is not installed on this server' }, 503);
      }

      const tempId = crypto.randomUUID();
      const inPath = join(tmpdir(), `wa_sticker_in_${tempId}`);
      const outPath = join(tmpdir(), `wa_sticker_out_${tempId}.webp`);

      try {
        await Bun.write(inPath, inputBuffer);

        const qualities = [75, 50, 30];

        // WA-017: bounded global media concurrency + subprocess deadline with kill/cleanup.
        const webpBuffer: Buffer | null = await sharedMediaLimiter.run(async () => {
          for (const q of qualities) {
            try {
              const proc = Bun.spawn(['cwebp', '-q', String(q), '-resize', '512', '512', inPath, '-o', outPath], {
                stdout: 'ignore',
                stderr: 'ignore'
              });
              const killTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* already exited */ }
              }, MEDIA_LIMITS.stickerSubprocessTimeoutMs);
              let exitCode: number;
              try {
                exitCode = await proc.exited;
              } finally {
                clearTimeout(killTimer);
              }
              if (exitCode === 0) {
                const file = Bun.file(outPath);
                if (file.size > 0 && file.size <= 101888) {
                  return Buffer.from(await file.arrayBuffer());
                } else if (file.size > 101888 && q === qualities[qualities.length - 1]) {
                  return Buffer.from(await file.arrayBuffer());
                }
              }
            } catch (spawnErr) {
              console.warn('[StickerStudio] cwebp spawn failed:', spawnErr);
              return null;
            }
          }
          return null;
        });

        if (!webpBuffer) {
          return c.json({ error: 'Failed to convert image to WhatsApp WebP sticker' }, 500);
        }

        if (webpBuffer.length > 101888) {
          return c.json({ error: `Generated sticker size (${webpBuffer.length} bytes) exceeds WhatsApp 100 KB limit (101,888 bytes)` }, 422);
        }

        return c.json({
          success: true,
          bytes: webpBuffer.length,
          stickerBase64: webpBuffer.toString('base64'),
          mimeType: 'image/webp'
        });
      } finally {
        try {
          unlinkSync(inPath);
        } catch (err: unknown) {
          const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
          if (code !== 'ENOENT') {
            console.warn('[StickerStudio] Failed to remove temp input file:', err instanceof Error ? err.message : err);
          }
        }
        try {
          unlinkSync(outPath);
        } catch (err: unknown) {
          const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
          if (code !== 'ENOENT') {
            console.warn('[StickerStudio] Failed to remove temp output file:', err instanceof Error ? err.message : err);
          }
        }
      }
    } catch (err: unknown) {
      return c.json({ error: `Sticker processing failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  });

  // Real-Time Server-Sent Events (SSE)
  app.get('/api/events', (c) => {
    // WA-019: refuse new streams once the broadcaster is at capacity.
    if (deps.sse.streamClientCount >= deps.sse.maxStreamClients) {
      return c.json({ error: 'Too many SSE clients connected' }, 503);
    }
    return streamSSE(c, async (stream) => {
      let pingInterval: ReturnType<typeof setInterval> | undefined;
      const stopPing = () => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = undefined;
        }
      };
      let resolveEndStream: (() => void) | undefined;
      const streamEnded = new Promise<void>((resolve) => {
        resolveEndStream = resolve;
      });
      let unsubscribe: (() => void) | null = null;
      const finish = () => {
        stopPing();
        unsubscribe?.();
        resolveEndStream?.();
      };
      // Broadcast writes are serialized and awaited per subscriber behind a
      // bounded queue; a slow client is disconnected so it reconnects and
      // resyncs from the authoritative snapshot instead of growing RAM.
      unsubscribe = deps.sse.subscribeStream(
        async (msg) => {
          await stream.writeSSE({
            event: msg.event,
            data: JSON.stringify(msg.data)
          });
        },
        {
          onDisconnect: () => {
            finish();
          }
        }
      );
      if (!unsubscribe) {
        // Lost a capacity race; ending here lets streamSSE close the stream.
        resolveEndStream?.();
        return;
      }

      // Send initial keep-alive
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ timestamp: Date.now() })
      });

      // Keep alive interval; never leave more than one ping write pending.
      let pingInFlight = false;
      pingInterval = setInterval(() => {
        if (pingInFlight) return;
        pingInFlight = true;
        void stream
          .writeSSE({ event: 'ping', data: '{}' })
          .catch(() => {
            finish();
          })
          .finally(() => {
            pingInFlight = false;
          });
      }, deps.sseHeartbeatMs ?? SSE_KEEP_ALIVE_MS);

      stream.onAbort(() => {
        finish();
      });

      // Stay open until the client aborts or the broadcaster disconnects us;
      // the callback then returns and streamSSE closes the stream.
      await streamEnded;
    });
  });

  // Funnel Engine Routes (Scatter-Gather & Hedged Dispatches)
  app.get('/api/funnel/methods', (c) => {
    if (!funnelEngine) {
      return c.json({ error: 'Funnel engine is disabled in this runtime profile' }, 503);
    }
    // Unauthenticated route: never expose per-target credentials.
    const rawMethods = funnelEngine.registry.listMethods();
    const methods = [];
    for (const m of rawMethods) {
      const safeTargets = [];
      for (const t of m.targets ?? []) {
        const { authHeader, headers, ...safe } = t;
        safeTargets.push({
          ...safe,
          hasAuthHeader: Boolean(authHeader),
          headerNames: Object.keys(headers ?? {})
        });
      }
      methods.push({ ...m, targets: safeTargets });
    }
    return c.json({ methods });
  });

  app.post('/api/funnel/methods', async (c) => {
    const authHeader = c.req.header('authorization') || c.req.header('x-api-key');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!funnelEngine) {
      return c.json({ error: 'Funnel engine is disabled in this runtime profile' }, 503);
    }
    if (!funnelEngine.registry.validateKey(token)) {
      return c.json({ error: 'Unauthorized: Invalid funnel API key' }, 401);
    }
    const body = await c.req.json().catch(() => null);
    if (!body || !body.method) {
      return c.json({ error: 'Invalid method configuration' }, 400);
    }
    funnelEngine.registry.registerMethod(body);
    return c.json({ status: 'registered', method: body.method });
  });

  app.post('/api/funnel/dispatch', async (c) => {
    const authHeader = c.req.header('authorization') || c.req.header('x-api-key');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!funnelEngine) {
      return c.json({ error: 'Funnel engine is disabled in this runtime profile' }, 503);
    }
    if (!funnelEngine.registry.validateKey(token)) {
      return c.json({ error: 'Unauthorized: Invalid funnel API key' }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    if (!body.method) {
      return c.json({ error: 'Missing method parameter' }, 400);
    }
    const receipt = await funnelEngine.dispatch({
      method: body.method,
      payload: body.payload,
      queryParams: body.queryParams,
      headers: body.headers,
      timeoutMs: body.timeoutMs
    });
    return c.json(receipt);
  });

  app.get('/api/funnel/stats', (c) => {
    if (!funnelEngine) {
      return c.json({ error: 'Funnel engine is disabled in this runtime profile' }, 503);
    }
    return c.json({
      circuitBreakers: funnelEngine.getCircuitBreakerStats(),
      activeMethodsCount: funnelEngine.registry.listMethods().length
    });
  });

  app.post('/api/funnel/circuit-breaker/reset', async (c) => {
    const authHeader = c.req.header('authorization') || c.req.header('x-api-key');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!funnelEngine) {
      return c.json({ error: 'Funnel engine is disabled in this runtime profile' }, 503);
    }
    if (!funnelEngine.registry.validateKey(token)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    if (!body.targetId) {
      return c.json({ error: 'Missing targetId' }, 400);
    }
    const reset = funnelEngine.resetCircuitBreaker(body.targetId);
    return c.json({ success: reset, targetId: body.targetId });
  });

  // Contact Memory Routes
  app.get('/api/contacts/:jid/memories', (c) => {
    const jid = c.req.param('jid');
    const memories = deps.memoryStore.getContactMemories('default', jid);
    return c.json({ memories });
  });

  app.post('/api/contacts/:jid/memories', async (c) => {
    const jid = c.req.param('jid');
    const body = await c.req.json().catch(() => ({}));
    const manager = new UserMemoryManager(deps.memoryStore.getSqliteStore());

    const commandText = body.command || `Remember that ${body.content || ''}`;
    const result = await manager.handleCommand('default', jid, commandText);

    if (result.status === 'rejected_credential') {
      return c.json(result, 422);
    }
    return c.json(result);
  });

  app.delete('/api/contacts/:jid/memories/:id', (c) => {
    const jid = c.req.param('jid');
    const memoryId = c.req.param('id');
    const success = deps.memoryStore.deleteContactMemory('default', jid, memoryId);
    return c.json({ success });
  });

  // Adaptive Conversation Style Routes
  app.get('/api/chats/:jid/style', (c) => {
    const jid = c.req.param('jid');
    const style = deps.memoryStore.getChatStyle(jid) || 'casual';
    return c.json({ style });
  });

  app.post('/api/chats/:jid/style', async (c) => {
    const jid = c.req.param('jid');
    const body: unknown = await c.req.json().catch(() => ({}));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'Invalid style payload' }, 400);
    }
    const value = 'style' in body ? body.style : undefined;
    const style = value === undefined ? 'casual' : value;
    if (style !== 'professional' && style !== 'casual' && style !== 'playful' && style !== 'assertive' && style !== 'empathetic') {
      return c.json({ error: 'Unsupported conversation style' }, 400);
    }
    deps.memoryStore.setChatStyle(jid, style);
    return c.json({ success: true, style });
  });

  // OpenReview GitHub App Webhook Endpoint
  app.post('/api/webhooks/github', async (c) => {
    // verifySignature verifies x-hub-signature-256 HMAC
    return handleGitHubWebhook(c);
  });

  // --- Workspace & Data Lifecycle Management ---

  app.get('/api/workspace/stats', (c) => {
    const stats = deps.memoryStore.getStorageStats();
    const wsState = deps.whatsappClient?.getState();
    return c.json({
      ...stats,
      connectionState: wsState?.state ?? null,
      connectedUser: wsState?.connectedUser ?? null,
      transportMode: deps.transportMode ?? 'baileys'
    });
  });

  app.post('/api/workspace/clean', (c) => {
    const cleanResult = cleanWorkspaceData(getWorkspaceDataDir());
    deps.memoryStore.checkpointAndVacuum();
    return c.json({
      success: cleanResult.success,
      freedBytes: cleanResult.freedBytes,
      cleanedItems: cleanResult.cleanedItems
    });
  });

  app.post('/api/workspace/reset', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const target = String(body?.target || 'all');

    if (target === 'all') {
      await deps.whatsappClient?.disconnect(true);
      const resetResult = deps.memoryStore.resetAll();
      deps.dualMemoryManager?.resetLearning();
      const cleanResult = cleanWorkspaceData(getWorkspaceDataDir());
      deps.sse.broadcast('workspace_reset', { target: 'all' });
      return c.json({
        success: true,
        target: 'all',
        clearedTables: resetResult.clearedTables,
        freedBytes: cleanResult.freedBytes
      });
    }

    if (target === 'session') {
      await deps.whatsappClient?.disconnect(true);
      deps.sse.broadcast('workspace_reset', { target: 'session' });
      return c.json({ success: true, target: 'session' });
    }

    if (target === 'chats') {
      const result = deps.memoryStore.clearAllChats();
      deps.sse.broadcast('workspace_reset', { target: 'chats' });
      deps.sse.broadcast('chat_updated', {});
      return c.json({ success: true, target: 'chats', details: result });
    }

    if (target === 'drafts') {
      const deleted = deps.memoryStore.clearAllDrafts();
      deps.sse.broadcast('workspace_reset', { target: 'drafts' });
      deps.sse.broadcast('draft_updated', {});
      return c.json({ success: true, target: 'drafts', deleted });
    }

    if (target === 'memories') {
      const result = deps.memoryStore.clearAllMemories();
      deps.sse.broadcast('workspace_reset', { target: 'memories' });
      return c.json({ success: true, target: 'memories', details: result });
    }

    if (target === 'learning') {
      deps.dualMemoryManager?.resetLearning();
      const result = deps.memoryStore.clearAllLearning();
      deps.sse.broadcast('workspace_reset', { target: 'learning' });
      return c.json({ success: true, target: 'learning', details: result });
    }

    if (target === 'cache') {
      const cleanResult = cleanWorkspaceData(getWorkspaceDataDir());
      deps.memoryStore.checkpointAndVacuum();
      return c.json({ success: true, target: 'cache', freedBytes: cleanResult.freedBytes });
    }

    return c.json({ error: `Unknown reset target '${target}'. Allowed: all, session, chats, drafts, memories, learning, cache` }, 400);
  });

  const broadcastStore = typeof deps.memoryStore?.getBroadcastStore === 'function'
    ? deps.memoryStore.getBroadcastStore()
    : undefined;
  if (broadcastStore) {
    const broadcastOrchestrator = deps.broadcastOrchestrator ?? new BroadcastOrchestrator({
      store: broadcastStore,
      memoryStore: deps.memoryStore,
      composer: new BroadcastComposer(),
      whatsappClient: deps.whatsappClient,
      voiceSynthesizer: deps.voiceSynthesizer,
      voiceName: () => deps.moderatorAgent.getPersona().voiceName,
      defaultTransport: deps.transportMode,
      publish: (event, data) => deps.sse.broadcast(event, data),
    });
    registerBroadcastRoutes(app, { store: broadcastStore, orchestrator: broadcastOrchestrator });
  }

  return app;
}
