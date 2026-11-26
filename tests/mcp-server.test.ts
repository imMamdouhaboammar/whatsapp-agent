import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'bun:test';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

async function connectClient(server: ReturnType<typeof createWhatsAppMcpServer>): Promise<Client> {
  const client = new Client({ name: 'mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const response = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  const item = response.content[0];
  if (item?.type !== 'text') throw new Error('Expected MCP text content');
  return item.text;
}

describe('WhatsApp MCP Server', () => {
  const chatId = 'test@s.whatsapp.net';
  const badArguments = [
    { name: 'whatsapp_get_messages', args: { chatId: {} }, field: 'chatId' },
    { name: 'whatsapp_search_chat_memory', args: { chatId, query: {} }, field: 'query' },
    { name: 'whatsapp_get_chat_folds', args: { chatId, tier: 4 }, field: 'tier' },
    { name: 'whatsapp_get_context_status', args: { chatId: {} }, field: 'chatId' },
    { name: 'whatsapp_compress_context_now', args: { chatId: {} }, field: 'chatId' },
    { name: 'whatsapp_decompress_fold', args: { chatId, foldId: {} }, field: 'foldId' },
    { name: 'whatsapp_decompress_fold', args: { chatId, foldId: 'missing', aroundMessageId: {} }, field: 'aroundMessageId' },
    { name: 'whatsapp_send_message', args: { chatId, text: {} }, field: 'text' },
    { name: 'whatsapp_send_message', args: { chatId, text: 'hello', replyToMessageId: {} }, field: 'replyToMessageId' },
    { name: 'whatsapp_send_message', args: { chatId, text: 'hello', mutationId: {} }, field: 'mutationId' },
    { name: 'whatsapp_send_reaction', args: { chatId, messageId: {}, emoji: '' }, field: 'messageId' },
    { name: 'whatsapp_set_chat_mode', args: { chatId, mode: 'invalid' }, field: 'mode' },
    { name: 'whatsapp_approve_draft', args: { draftId: 'missing', editedText: {} }, field: 'editedText' },
    { name: 'whatsapp_manage_memory', args: { chatId, action: 'invalid' }, field: 'action' },
    { name: 'whatsapp_manage_memory', args: { chatId, action: 'save', content: {} }, field: 'content' },
    { name: 'whatsapp_set_chat_style', args: { chatId, style: 'invalid' }, field: 'style' },
    { name: 'whatsapp_get_current_time', args: { timezone: {} }, field: 'timezone' },
    { name: 'whatsapp_check_temporal_freshness', args: { prompt: {} }, field: 'prompt' },
    { name: 'whatsapp_check_temporal_freshness', args: { prompt: 'hello', timezone: {} }, field: 'timezone' },
    { name: 'whatsapp_funnel_scatter_gather', args: { method: 'GET', payload: [] }, field: 'payload' },
    { name: 'whatsapp_funnel_scatter_gather', args: { method: 'GET', queryParams: { limit: 1 } }, field: 'queryParams' }
  ];

  it.each(badArguments)('rejects invalid $field for $name over JSON-RPC', async ({ name, args, field }) => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      moderatorAgent: new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memory),
      whatsappClient: new WhatsAppSocketClient(),
      funnelEngine: { dispatch: async () => { throw new Error('Unexpected dispatch'); } }
    });
    const client = await connectClient(server);
    try {
      const failure: unknown = await client.callTool({ name, arguments: args }).then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({ message: expect.stringContaining(field) });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('registers all 7 essential whatsapp agent tools', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-mcp-1' });
    const agent = new ModeratorAgent({ generateContent: async () => ({ text: '{}' }) }, memory);
    const mockClient = new WhatsAppSocketClient();
    mockClient.getState = () => ({ state: 'connected', updatedAt: 1, connectedUser: { id: '201000000000@s.whatsapp.net', phone: '201000000000' } });

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent
    });

    const client = await connectClient(server);
    const { tools } = await client.listTools();
    await client.close();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('whatsapp_list_chats');
    expect(toolNames).toContain('whatsapp_get_messages');
    expect(toolNames).toContain('whatsapp_send_message');
    expect(toolNames).toContain('whatsapp_send_reaction');
    expect(toolNames).toContain('whatsapp_get_status');
    expect(toolNames).toContain('whatsapp_set_chat_mode');
    expect(toolNames).toContain('whatsapp_approve_draft');
    expect(toolNames).toContain('whatsapp_manage_memory');
    expect(toolNames).toContain('whatsapp_set_chat_style');
  });

  it('handles whatsapp_get_status tool call', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-mcp-2' });
    const agent = new ModeratorAgent({ generateContent: async () => ({ text: '{}' }) }, memory);
    const mockClient = new WhatsAppSocketClient();
    mockClient.getState = () => ({
      state: 'connected',
      updatedAt: 1,
      connectedUser: { id: '201012345678@s.whatsapp.net', phone: '201012345678', name: 'Mamdouh' }
    });

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent
    });

    const client = await connectClient(server);
    const parsed: unknown = JSON.parse(await callTool(client, 'whatsapp_get_status', {}));
    await client.close();
    expect(parsed).toMatchObject({ connectionState: 'connected', connectedUser: { phone: '201012345678' } });
  });

  it('handles whatsapp_set_chat_style and whatsapp_manage_memory via MCP', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const agent = new ModeratorAgent({ generateContent: async () => ({ text: '{}' }) }, memory);
    const mockClient = new WhatsAppSocketClient();
    mockClient.getState = () => ({ state: 'connected', updatedAt: 1 });

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent
    });

    const client = await connectClient(server);
    try {
      const styleText = await callTool(client, 'whatsapp_set_chat_style', {
        chatId: 'user123@s.whatsapp.net',
        style: 'playful'
      });
      expect(styleText).toContain('updated to playful');
      expect(memory.getChatStyle('user123@s.whatsapp.net')).toBe('playful');

      const parsedMem: unknown = JSON.parse(await callTool(client, 'whatsapp_manage_memory', {
        chatId: 'user123@s.whatsapp.net',
        action: 'save',
        content: 'Client prefers fast shipping'
      }));
      expect(parsedMem).toMatchObject({ status: 'saved' });
    } finally {
      await client.close();
    }
  });
});
