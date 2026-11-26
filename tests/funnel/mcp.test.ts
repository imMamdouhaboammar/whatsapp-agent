import { describe, expect, it } from 'bun:test';
import { createWhatsAppMcpServer } from '../../src/mcp/server';
import { MemoryStore } from '../../src/domain/memory-store';
import { ModeratorAgent } from '../../src/ai/moderator-agent';
import { GeminiClient } from '../../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../../src/transport/whatsapp-socket';
import { FableFunnelEngine, FunnelRegistry } from '../../src/funnel';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

const mockFetcher: typeof fetch = async () => new Response(JSON.stringify({ synced: true }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
});

describe('Funnel MCP Tool Integration', () => {
  it('registers and invokes whatsapp_funnel_scatter_gather tool', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-mcp-funnel' });
    const mockGemini = new GeminiClient({ apiKey: 'test-key' });
    mockGemini.generateContent = async () => ({ text: '{}' });
    const agent = new ModeratorAgent(mockGemini, memory);
    const mockClient = new WhatsAppSocketClient();
    mockClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });
    mockClient.sendMessage = async () => ({ messageId: 'm123' });

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

    const funnelEngine = new FableFunnelEngine({ registry, fetcher: mockFetcher });

    const server = createWhatsAppMcpServer({
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: agent,
      funnelEngine
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'funnel-test-client', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listResult = await client.listTools();
      expect(listResult.tools.map((tool) => tool.name)).toContain('whatsapp_funnel_scatter_gather');

      const callResult = await client.request({
        method: 'tools/call',
        params: {
          name: 'whatsapp_funnel_scatter_gather',
          arguments: {
            method: 'CRM_FANOUT',
            payload: { customer: 'Mamdouh', phone: '201012345678' }
          }
        }
      }, CallToolResultSchema);

      const firstContent = callResult.content[0];
      if (firstContent?.type !== 'text') throw new TypeError('Expected a text receipt');
      const receipt: unknown = JSON.parse(firstContent.text);
      expect(receipt).toMatchObject({ method: 'CRM_FANOUT', success: true, successfulCount: 2 });
      if (typeof receipt !== 'object' || receipt === null ||
          !('results' in receipt) || !Array.isArray(receipt.results)) {
        throw new TypeError('Expected an array of dispatch results');
      }
      expect(receipt.results).toHaveLength(2);
    } finally {
      await Promise.all([client.close(), server.close()]);
      memory.close();
    }
  });
});
