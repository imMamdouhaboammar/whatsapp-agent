import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ModeratorAgent } from '../ai/moderator-agent';
import type { VoiceSynthesizer } from '../ai/voice-synthesizer';
import type { MemoryStore } from '../domain/memory-store';
import { SendIntentService } from '../domain/send-intent-service';
import type { ChatMessage } from '../domain/types';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import type { SSEBroadcaster } from './sse';
import { FableFunnelEngine, FunnelRegistry } from '../funnel';
import { registerDashboardAuth } from './dashboard-auth';
import { UserMemoryManager } from '../domain/user-memory';
import type { ConversationStyle } from '../ai/adaptive-style';
import { handleGitHubWebhook } from './github-webhook';
import type { DualMemoryManager } from '../domain/learning-memory';
import type { ReflectionWorker } from '../agent/reflection-worker';
import type { ReflectionEngine } from '../ai/reflection-engine';
import type { DiagnosticsCore } from '../observability/diagnostics-core';

const allowedOrigins = new Set(['http://localhost:3000','http://127.0.0.1:3000','http://localhost:5173','http://127.0.0.1:5173',...((process.env.AGENT_ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean))]);
const trustedOrigin=(origin:string)=>allowedOrigins.has(origin);

// A short heartbeat survives reverse proxies that drop idle HTTP streams after 10 seconds.
export const SSE_KEEP_ALIVE_MS = 5000;

export function createApiServer(deps: {
  memoryStore: MemoryStore;
  whatsappClient: WhatsAppSocketClient;
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
  sendIntents?: SendIntentService;
  diagnostics?: DiagnosticsCore;
  transportMode?: 'baileys' | 'meta-cloud';
}): Hono {
  const app = new Hono();
  let delivery = deps.sendIntents;
  const getDelivery = () => delivery ??= new SendIntentService({
    memoryStore: deps.memoryStore,
    diagnostics: deps.diagnostics,
    sendText: (chatId, text, options) => deps.whatsappClient.sendMessage(chatId, text, options),
    prepareVoice: deps.voiceSynthesizer
      ? (text) => deps.voiceSynthesizer!.synthesizeVoice(text, deps.moderatorAgent.getPersona().voiceName)
      : undefined,
    sendVoice: deps.voiceSynthesizer
      ? (chatId, audio, options) => deps.whatsappClient.sendVoiceNote(chatId, audio, { replyToMessageId: options?.replyToMessageId })
      : undefined,
    publish: (event, data) => deps.sse.broadcast(event, data)
  });
  const funnelEngine = deps.funnelEngine ?? new FableFunnelEngine({
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

  // Only configured origins may issue browser mutations or read cross-origin API responses.
  // CLI/service callers without a browser Origin remain supported; bind the server to loopback by default.
  app.use('*',async(c,next)=>{
    const origin=c.req.header('origin');
    if(origin && origin !== new URL(c.req.url).origin && !trustedOrigin(origin) && !['GET','HEAD','OPTIONS'].includes(c.req.method))return c.json({error:'Cross-origin request forbidden'},403);
    await next();
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

  // Status & Connection
  app.get('/api/status', (c) => {
    const state = deps.whatsappClient.getState();
    const pendingDrafts = deps.memoryStore.getPendingDrafts();
    return c.json({
      ...state,
      transportMode: deps.transportMode ?? 'baileys',
      metaCloudConfigured: deps.transportMode === 'meta-cloud',
      pendingDraftsCount: pendingDrafts.length
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
    void deps.whatsappClient.start(phone);
    return c.json({ status: 'initiated', phone });
  });

  app.post('/api/disconnect', async (c) => {
    if (deps.transportMode === 'meta-cloud') {
      return c.json({ error: 'Baileys disconnect is disabled in Meta Cloud transport mode' }, 409);
    }
    await deps.whatsappClient.disconnect();
    return c.json({ status: 'disconnected' });
  });

  // Chats
  app.get('/api/chats', (c) => {
    const chats = deps.memoryStore.listChats();
    return c.json({ chats });
  });

  app.get('/api/chats/:chatId/folds', async (c) => {
    let chatId = c.req.param('chatId');
    if (deps.whatsappClient?.canonicalizeJid) {
      chatId = await deps.whatsappClient.canonicalizeJid(chatId);
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ chatId, folds: deps.memoryStore.getFolds(chatId) });
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
    const limit = Number(c.req.query('limit') ?? 50);
    const messages = deps.memoryStore.getMessages(chatId, limit);
    const outstanding: ChatMessage[] = deps.memoryStore.getSendLedger().getOutstanding(chatId).map((intent): ChatMessage => {
      const attempts = deps.memoryStore.getSendLedger().getAttempts(intent.id);
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
        deliveryState: intent.state as ChatMessage['deliveryState'],
        lastAttemptAt: attempts.at(-1)?.startedAt,
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
    } catch (error: any) {
      return c.json({ error: error.message }, error.name === 'SendIntentConflictError' ? 409 : 500);
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
    } catch (error: any) {
      return c.json({ error: error.message }, 409);
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
    await deps.whatsappClient.sendReaction(chatId, messageId, emoji);
    return c.json({ success: true });
  });

  // Drafts
  app.get('/api/drafts', (c) => {
    const drafts = deps.memoryStore.getPendingDrafts();
    return c.json({ drafts });
  });

  app.post('/api/drafts/:draftId/approve', async (c) => {
    const draftId = c.req.param('draftId');
    const body = await c.req.json().catch(() => ({}));
    const draft = deps.memoryStore.getDraft(draftId);
    if (!draft) return c.json({ error: 'Draft not found' }, 404);
    const replyText = String(body.editedText || body.replyText || draft.proposedReply);
    const asVoice = Boolean(deps.voiceSynthesizer) &&
      (body.asVoice !== undefined ? Boolean(body.asVoice) : Boolean(draft.sendAsVoiceNote));

    try {
      const approved = await getDelivery().approveDraft(draftId, replyText, 1, asVoice);
      if (!approved.result) return c.json({ error: 'Draft already processed' }, 409);
      if (approved.created && draft.proposedReply !== replyText && deps.reflectionWorker) {
        deps.reflectionWorker.recordModerationFeedback({
          chatId: draft.chatId,
          draftId,
          feedbackType: 'edited',
          originalReply: draft.proposedReply,
          revisedReply: replyText,
          humanNote: 'Operator revised draft prior to approval'
        });
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
    } catch (error: any) {
      return c.json({ error: error.message }, error.name === 'SendIntentConflictError' ? 409 : 500);
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

  // Real-Time Server-Sent Events (SSE)
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = deps.sse.subscribe((msg) => {
        void stream.writeSSE({
          event: msg.event,
          data: JSON.stringify(msg.data)
        });
      });

      // Send initial keep-alive
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ timestamp: Date.now() })
      });

      // Keep alive interval
      const pingInterval = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {
          clearInterval(pingInterval);
          unsubscribe();
        });
      }, deps.sseHeartbeatMs ?? SSE_KEEP_ALIVE_MS);

      stream.onAbort(() => {
        clearInterval(pingInterval);
        unsubscribe();
      });

      // Sleep until stream closes
      await stream.sleep(86400000);
    });
  });

  // Funnel Engine Routes (Scatter-Gather & Hedged Dispatches)
  app.get('/api/funnel/methods', (c) => {
    return c.json({ methods: funnelEngine.registry.listMethods() });
  });

  app.post('/api/funnel/methods', async (c) => {
    const authHeader = c.req.header('authorization') || c.req.header('x-api-key');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
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
    return c.json({
      circuitBreakers: funnelEngine.getCircuitBreakerStats(),
      activeMethodsCount: funnelEngine.registry.listMethods().length
    });
  });

  app.post('/api/funnel/circuit-breaker/reset', async (c) => {
    const authHeader = c.req.header('authorization') || c.req.header('x-api-key');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
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
    const body = await c.req.json().catch(() => ({}));
    const style = (body.style as ConversationStyle) || 'casual';
    deps.memoryStore.setChatStyle(jid, style);
    return c.json({ success: true, style });
  });

  // OpenReview GitHub App Webhook Endpoint
  app.post('/api/webhooks/github', async (c) => {
    // verifySignature verifies x-hub-signature-256 HMAC
    return handleGitHubWebhook(c);
  });

  return app;
}
