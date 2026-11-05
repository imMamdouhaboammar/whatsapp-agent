import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ModeratorAgent } from '../ai/moderator-agent';
import type { MemoryStore } from '../domain/memory-store';
import type { ChatMessage } from '../domain/types';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import type { SSEBroadcaster } from './sse';

export function createApiServer(deps: {
  memoryStore: MemoryStore;
  whatsappClient: WhatsAppSocketClient;
  moderatorAgent: ModeratorAgent;
  sse: SSEBroadcaster;
  audioTranscriber?: AudioTranscriber;
}): Hono {
  const app = new Hono();

  // Enable CORS for local Vite dev and web clients
  app.use('*', cors());

  // Status & Connection
  app.get('/api/status', (c) => {
    const state = deps.whatsappClient.getState();
    const pendingDrafts = deps.memoryStore.getPendingDrafts();
    return c.json({
      ...state,
      pendingDraftsCount: pendingDrafts.length
    });
  });

  app.post('/api/connect', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const phone = body.pairingPhoneNumber ? String(body.pairingPhoneNumber) : undefined;
    void deps.whatsappClient.start(phone);
    return c.json({ status: 'initiated', phone });
  });

  app.post('/api/disconnect', async (c) => {
    await deps.whatsappClient.disconnect();
    return c.json({ status: 'disconnected' });
  });

  // Chats
  app.get('/api/chats', (c) => {
    const chats = deps.memoryStore.listChats();
    return c.json({ chats });
  });

  app.get('/api/chats/:chatId/messages', (c) => {
    const chatId = c.req.param('chatId');
    const limit = Number(c.req.query('limit') ?? 50);
    const messages = deps.memoryStore.getMessages(chatId, limit);
    deps.memoryStore.markChatRead(chatId);
    deps.sse.broadcast('chat_updated', { chatId, unreadCount: 0 });
    return c.json({ messages });
  });

  app.post('/api/chats/:chatId/messages', async (c) => {
    const chatId = c.req.param('chatId');
    const body = await c.req.json();
    const text = String(body.text ?? '');
    const replyToMessageId = body.replyToMessageId ? String(body.replyToMessageId) : undefined;

    if (!text.trim()) {
      return c.json({ error: 'Text is required' }, 400);
    }

    try {
      const sent = await deps.whatsappClient.sendMessage(chatId, text, {
        replyToMessageId,
        simulatedDelayMs: 500
      });

      const message: ChatMessage = {
        id: sent.messageId,
        chatId,
        sender: 'me',
        text,
        timestamp: Date.now(),
        isFromMe: true,
        type: 'text',
        replyToId: replyToMessageId,
        status: 'sent'
      };

      deps.memoryStore.addMessage(message);
      deps.sse.broadcast('new_message', message);

      return c.json({ success: true, message });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post('/api/chats/:chatId/mode', async (c) => {
    const chatId = c.req.param('chatId');
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
    const chatId = c.req.param('chatId');
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

    const replyText = body.editedText || draft.proposedReply;

    try {
      const sent = await deps.whatsappClient.sendMessage(draft.chatId, replyText, {
        replyToMessageId: draft.incomingMessageId,
        simulatedDelayMs: 1000
      });

      deps.memoryStore.updateDraftStatus(draftId, 'approved', replyText);

      const message: ChatMessage = {
        id: sent.messageId,
        chatId: draft.chatId,
        sender: 'me',
        text: replyText,
        timestamp: Date.now(),
        isFromMe: true,
        type: 'text',
        replyToId: draft.incomingMessageId,
        status: 'sent'
      };

      deps.memoryStore.addMessage(message);
      deps.sse.broadcast('new_message', message);
      deps.sse.broadcast('draft_updated', { draftId, status: 'approved' });

      return c.json({ success: true, message });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post('/api/drafts/:draftId/reject', (c) => {
    const draftId = c.req.param('draftId');
    deps.memoryStore.updateDraftStatus(draftId, 'rejected');
    deps.sse.broadcast('draft_updated', { draftId, status: 'rejected' });
    return c.json({ success: true, draftId });
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

  // Simulator endpoint
  app.post('/api/simulate', async (c) => {
    const body = await c.req.json();
    const simulatedMsg: ChatMessage = {
      id: `sim_${Date.now()}`,
      chatId: body.chatId || 'simulation@s.whatsapp.net',
      sender: body.sender || 'simulator_user',
      senderName: body.senderName || 'مستخدم تجريبي',
      text: String(body.text ?? 'أهلاً بك'),
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    deps.memoryStore.addMessage(simulatedMsg);
    deps.sse.broadcast('new_message', simulatedMsg);

    const result = await deps.moderatorAgent.processInboundMessage(simulatedMsg);
    deps.sse.broadcast('agent_thought', {
      chatId: simulatedMsg.chatId,
      messageId: simulatedMsg.id,
      decision: result.decision
    });

    if (result.draftCreated) {
      deps.sse.broadcast('new_draft', result.draftCreated);
    }

    if (result.shouldSendImmediately && result.decision.replyText) {
      const outbound: ChatMessage = {
        id: `sim_out_${Date.now()}`,
        chatId: simulatedMsg.chatId,
        sender: 'me',
        text: result.decision.replyText,
        timestamp: Date.now(),
        isFromMe: true,
        type: 'text',
        replyToId: simulatedMsg.id,
        status: 'sent'
      };
      deps.memoryStore.addMessage(outbound);
      deps.sse.broadcast('new_message', outbound);
    }

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
        void stream.writeSSE({ event: 'ping', data: '{}' });
      }, 15000);

      stream.onAbort(() => {
        clearInterval(pingInterval);
        unsubscribe();
      });

      // Sleep until stream closes
      await stream.sleep(86400000);
    });
  });

  return app;
}
