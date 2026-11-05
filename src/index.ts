import { serveStatic } from 'hono/bun';
import { AudioTranscriber } from './ai/audio-transcriber';
import { GeminiClient } from './ai/gemini-client';
import { ModeratorAgent } from './ai/moderator-agent';
import { MemoryStore } from './domain/memory-store';
import { HumanRateLimiter } from './domain/rate-limiter';
import type { ChatMessage } from './domain/types';
import { createApiServer } from './server/api';
import { SSEBroadcaster } from './server/sse';
import { WhatsAppSocketClient } from './transport/whatsapp-socket';

export async function createFableWhatsAppAgent(options: {
  port?: number;
  dataDir?: string;
  autoConnect?: boolean;
} = {}) {
  const port = options.port ?? Number(process.env.PORT || 3000);
  const dataDir = options.dataDir ?? './data';

  console.log('🚀 [Fable Agentic WhatsApp] Initializing supervisor & agent engine...');

  const sse = new SSEBroadcaster();
  const memoryStore = new MemoryStore({ dataDir });
  const geminiClient = new GeminiClient();
  const audioTranscriber = new AudioTranscriber(geminiClient);
  const rateLimiter = new HumanRateLimiter({
    minDelayMs: 2000,
    maxDelayMs: 5000
  });

  const moderatorAgent = new ModeratorAgent(geminiClient, memoryStore, {
    rateLimiter
  });

  const whatsappClient = new WhatsAppSocketClient({
    sessionDir: `${dataDir}/session`,
    audioTranscriber,
    onStateChange: (state) => {
      console.log(`📡 [WhatsApp State] ${state.state}`);
      sse.broadcast('state_change', state);
    },
    onMessage: async (msg: ChatMessage) => {
      // 1. Record incoming message
      memoryStore.addMessage(msg);
      sse.broadcast('new_message', msg);
      sse.broadcast('chat_updated', { chatId: msg.chatId });

      // If message is from me, do not run agent reply loop
      if (msg.isFromMe) return;

      console.log(`💬 [Inbound Message] From: ${msg.senderName || msg.sender} | Text: ${msg.text.slice(0, 50)}`);

      // 2. Process message through Moderator Agent
      try {
        const result = await moderatorAgent.processInboundMessage(msg);

        // Broadcast thought & reasoning to live UI
        sse.broadcast('agent_thought', {
          chatId: msg.chatId,
          messageId: msg.id,
          decision: result.decision
        });

        if (result.draftCreated) {
          console.log(`📝 [Draft Created] Approval needed for chat ${msg.chatId}`);
          sse.broadcast('new_draft', result.draftCreated);
        }

        if (result.shouldSendImmediately && result.decision.replyText) {
          console.log(`🤖 [Agent Auto-Reply] Replying with ${result.decision.simulatedDelayMs}ms typing delay...`);

          // Optionally send reaction first
          if (result.decision.suggestedReaction) {
            whatsappClient.sendReaction(msg.chatId, msg.id, result.decision.suggestedReaction).catch(() => {});
          }

          // Enqueue reply through human rate limiter
          await rateLimiter.enqueue(msg.chatId, async () => {
            const sent = await whatsappClient.sendMessage(msg.chatId, result.decision.replyText!, {
              replyToMessageId: msg.id,
              simulatedDelayMs: result.decision.simulatedDelayMs
            });

            const outboundMsg: ChatMessage = {
              id: sent.messageId,
              chatId: msg.chatId,
              sender: 'me',
              text: result.decision.replyText!,
              timestamp: Date.now(),
              isFromMe: true,
              type: 'text',
              replyToId: msg.id,
              status: 'sent'
            };

            memoryStore.addMessage(outboundMsg);
            sse.broadcast('new_message', outboundMsg);
            sse.broadcast('chat_updated', { chatId: msg.chatId });
          });
        }
      } catch (err: any) {
        console.error('❌ [Agent Processing Error]:', err.message);
      }
    }
  });

  // Create API App
  const app = createApiServer({
    memoryStore,
    whatsappClient,
    moderatorAgent,
    sse,
    audioTranscriber
  });

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
    sse
  };
}

if (import.meta.main) {
  const agent = await createFableWhatsAppAgent({ autoConnect: true });
  console.log(`✨ [Fable Agentic WhatsApp] Live at http://localhost:${agent.port}`);
  Bun.serve({
    fetch: agent.app.fetch,
    port: agent.port
  });
}
