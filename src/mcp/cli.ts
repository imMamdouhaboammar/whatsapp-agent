import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GeminiClient } from '../ai/gemini-client';
import { ModeratorAgent } from '../ai/moderator-agent';
import { MemoryStore } from '../domain/memory-store';
import { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import { createWhatsAppMcpServer } from './server';

async function main() {
  const memoryStore = new MemoryStore();
  const geminiClient = new GeminiClient();
  const moderatorAgent = new ModeratorAgent(geminiClient, memoryStore);
  const whatsappClient = new WhatsAppSocketClient();

  const server = createWhatsAppMcpServer({
    memoryStore,
    whatsappClient,
    moderatorAgent
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Fable Agentic WhatsApp] MCP Server listening on stdio');
}

main().catch((err) => {
  console.error('[Fable Agentic WhatsApp] Fatal MCP error:', err);
  process.exit(1);
});
