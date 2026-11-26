import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GeminiClient } from '../ai/gemini-client';
import { ModeratorAgent } from '../ai/moderator-agent';
import { MemoryStore } from '../domain/memory-store';
import { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import { createMcpRuntime } from './runtime';
import { resolveRuntimeDatastore } from '../persistence/postgres/runtime-selection';

async function main() {
  resolveRuntimeDatastore();
  const memoryStore = new MemoryStore();
  const geminiClient = new GeminiClient();
  const moderatorAgent = new ModeratorAgent(geminiClient, memoryStore);

  // MCP_WHATSAPP_CHANNEL=none runs read-only tools without opening a WhatsApp socket.
  // The default starts a managed socket from the saved session: do not run it while
  // the main app holds the same session (./data/session), WhatsApp allows one live socket per session.
  const runtime = await createMcpRuntime({
    memoryStore,
    moderatorAgent,
    channelMode: process.env.MCP_WHATSAPP_CHANNEL === 'none' ? 'none' : 'managed',
    createClient: (onStateChange) => new WhatsAppSocketClient({
      onStateChange: ({ qrDataUrl, pairingCode, error, ...state }) => {
        onStateChange({
          ...state,
          qrDataUrl: qrDataUrl ?? undefined,
          pairingCode: pairingCode ?? undefined,
          error: error ?? undefined
        });
      }
    }),
    connectTimeoutMs: Number(process.env.MCP_CONNECT_TIMEOUT_MS) || undefined
  });

  const transport = new StdioServerTransport();
  await runtime.server.connect(transport);
  // A host that closes stdio without a signal must not leave the WhatsApp socket running.
  Object.assign(runtime.server, {
    onclose: () => { void runtime.shutdown().finally(() => process.exit(0)); }
  });
  console.error('[Fable Agentic WhatsApp] MCP Server listening on stdio');

  const stop = () => { void runtime.shutdown().finally(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((err) => {
  console.error('[Fable Agentic WhatsApp] Fatal MCP error:', err);
  process.exit(1);
});
