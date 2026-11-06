import { describe, expect, it } from 'bun:test';
import { createWhatsAppMcpServer } from '../../src/mcp/server';
import { MemoryStore } from '../../src/domain/memory-store';
import { ModeratorAgent } from '../../src/ai/moderator-agent';
import { FableFunnelEngine, FunnelRegistry } from '../../src/funnel';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('Funnel MCP Tool Integration', () => {
  it('registers and invokes whatsapp_funnel_scatter_gather tool', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-mcp-funnel' });
    const mockGemini: any = { generateContent: async () => ({ text: '{}' }) };
    const agent = new ModeratorAgent(mockGemini, memory);
    const mockClient: any = {
      getState: () => ({ state: 'connected' }),
      sendMessage: async () => ({ messageId: 'm123' })
    };

    const registry = new FunnelRegistry();
    registry.registerMethod({
      method: 'CRM_FANOUT',
      description: 'Broadcast to CRM and Leads sheet',
      mode: 'ALL_SETTLED',
      timeoutMs: 1000,
      targets: [
        { id: 'hubspot', name: 'HubSpot', url: 'http://crm.mock/lead', enabled: true },
        { id: 'zoho', name: 'Zoho', url: 'http://zoho.mock/lead', enabled: true }
      ]
    });

    const mockFetcher = async () => new Response(JSON.stringify({ synced: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    const funnelEngine = new FableFunnelEngine({ registry, fetcher: mockFetcher as any });

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent,
      funnelEngine
    });

    // 1. Verify tool registration
    const listHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    const listResult = await listHandler({ method: 'tools/list' }, {});
    const toolNames = listResult.tools.map((t: any) => t.name);
    expect(toolNames).toContain('whatsapp_funnel_scatter_gather');

    // 2. Verify tool invocation
    const callHandler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    const callResult = await callHandler(
      {
        method: 'tools/call',
        params: {
          name: 'whatsapp_funnel_scatter_gather',
          arguments: {
            method: 'CRM_FANOUT',
            payload: { customer: 'Mamdouh', phone: '201012345678' }
          }
        }
      },
      {}
    );

    expect(callResult.content[0].type).toBe('text');
    const receipt = JSON.parse(callResult.content[0].text);
    expect(receipt.method).toBe('CRM_FANOUT');
    expect(receipt.success).toBe(true);
    expect(receipt.results.length).toBe(2);
    expect(receipt.successfulCount).toBe(2);
  });
});
