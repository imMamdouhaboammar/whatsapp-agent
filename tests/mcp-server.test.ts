import { describe, expect, it } from 'bun:test';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('WhatsApp MCP Server', () => {
  it('registers all 7 essential whatsapp agent tools', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-mcp-1' });
    const mockGemini: any = { generateContent: async () => ({ text: '{}' }) };
    const agent = new ModeratorAgent(mockGemini, memory);
    const mockClient: any = {
      getState: () => ({ state: 'connected', connectedUser: { phone: '201000000000' } }),
      sendMessage: async () => ({ messageId: 'm123' }),
      sendReaction: async () => {}
    };

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent
    });

    const handler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    expect(handler).toBeDefined();

    const result = await handler({ method: 'tools/list' }, {});
    const toolNames = result.tools.map((t: any) => t.name);

    expect(toolNames).toContain('whatsapp_list_chats');
    expect(toolNames).toContain('whatsapp_get_messages');
    expect(toolNames).toContain('whatsapp_send_message');
    expect(toolNames).toContain('whatsapp_send_reaction');
    expect(toolNames).toContain('whatsapp_get_status');
    expect(toolNames).toContain('whatsapp_set_chat_mode');
    expect(toolNames).toContain('whatsapp_approve_draft');
  });

  it('handles whatsapp_get_status tool call', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-mcp-2' });
    const mockGemini: any = { generateContent: async () => ({ text: '{}' }) };
    const agent = new ModeratorAgent(mockGemini, memory);
    const mockClient: any = {
      getState: () => ({
        state: 'connected',
        connectedUser: { phone: '201012345678', name: 'Mamdouh' }
      }),
      sendMessage: async () => ({ messageId: 'm123' })
    };

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent
    });

    const callHandler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const response = await callHandler(
      {
        method: 'tools/call',
        params: {
          name: 'whatsapp_get_status',
          arguments: {}
        }
      },
      {}
    );

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.connectionState).toBe('connected');
    expect(parsed.connectedUser.phone).toBe('201012345678');
  });
});
