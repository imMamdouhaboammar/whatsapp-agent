import { describe, expect, test } from 'bun:test';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  McpClientManager,
  scrubSensitiveRecord,
  type McpClientLike,
  type McpClientsConfig,
  type McpServerConfig
} from '../src/mcp/client-manager';
import {
  executeGeminiToolLoop,
  sanitizeSchemaForGemini,
  toGeminiFunctionDeclarations
} from '../src/mcp/gemini-tool-adapter';
import { evaluateMcpToolPermission } from '../src/domain/permission-engine';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import { runDoctor } from '../src/doctor';

const dummyTransport = (): Transport => ({
  start: async () => {},
  send: async () => {},
  close: async () => {}
});

describe('McpClientManager & Gemini Tool Adapter', () => {
  test('defaults gracefully to empty when config file does not exist', async () => {
    const manager = new McpClientManager({
      configPath: '/tmp/non-existent-mcp-clients-12345.json'
    });
    await manager.initialize();
    expect(manager.listAvailableTools()).toEqual([]);
    expect(manager.getHealthReport()).toEqual([]);
    await manager.shutdown();
  });

  test('scrubs sensitive keys from headers and env records', () => {
    const scrubbed = scrubSensitiveRecord({
      'x-api-key': ['sk', 'test', 'secret'].join('-'),
      Authorization: 'Bearer abc',
      'X-Custom-Header': 'public-value'
    });
    expect(scrubbed).toEqual({
      'x-api-key': '[REDACTED]',
      Authorization: '[REDACTED]',
      'X-Custom-Header': 'public-value'
    });
  });

  test('discovers tools with namespacing, risk classification, and brand isolation', async () => {
    const config: McpClientsConfig = {
      servers: [
        {
          name: 'composio',
          transport: 'streamable-http',
          url: 'https://example.com/mcp',
          brandId: 'brand-a',
          tools: {
            send_email: { risk: 'mutating', requiresHumanApproval: true }
          }
        },
        {
          name: 'other-tenant',
          transport: 'streamable-http',
          url: 'https://other.example.com/mcp',
          brandId: 'brand-b'
        }
      ]
    };

    const manager = new McpClientManager({
      config,
      brandId: 'brand-a',
      transportFactory: () => dummyTransport(),
      clientFactory: (server: McpServerConfig): McpClientLike => ({
        connect: async () => {},
        listTools: async () => ({
          tools: [
            {
              name: 'find_event',
              description: 'Find calendar events',
              annotations: { readOnlyHint: true },
              inputSchema: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                type: 'object',
                additionalProperties: false,
                properties: {
                  query: { type: ['string', 'null'], description: 'Search query' },
                  nested: {
                    anyOf: [{ type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false }, { type: 'null' }]
                  }
                },
                required: ['query']
              }
            },
            {
              name: 'send_email',
              description: 'Send an email',
              inputSchema: { type: 'object', properties: { to: { type: 'string' } } }
            },
            {
              name: 'unclassified_action',
              description: 'Unknown risk tool'
            }
          ]
        }),
        callTool: async ({ name, arguments: args }) => ({
          content: [{ type: 'text', text: `ran:${server.name}:${name}:${JSON.stringify(args)}` }]
        }),
        close: async () => {}
      })
    });

    await manager.initialize();
    const tools = manager.listAvailableTools();
    expect(tools.map((t) => t.namespacedName)).toEqual([
      'composio__find_event',
      'composio__send_email',
      'composio__unclassified_action'
    ]);

    const findTool = manager.getTool('composio__find_event');
    const sendTool = manager.getTool('composio__send_email');
    const unknownTool = manager.getTool('composio__unclassified_action');
    if (!findTool || !sendTool || !unknownTool) throw new Error('Expected discovered tools');
    expect(findTool.risk).toBe('readOnly');
    expect(sendTool.risk).toBe('mutating');
    expect(sendTool.requiresHumanApproval).toBe(true);
    // Fail-closed: unknown external tools default to mutating
    expect(unknownTool.risk).toBe('mutating');

    // Sanitization strips unsupported JSON Schema keywords
    const decls = toGeminiFunctionDeclarations([findTool]);
    expect(decls).toHaveLength(1);
    const params = decls[0]?.parameters;
    expect(params?.$schema).toBeUndefined();
    expect(params?.additionalProperties).toBeUndefined();
    expect(params?.properties).toMatchObject({ query: { type: 'string', nullable: true } });
    const properties = params?.properties;
    if (typeof properties !== 'object' || properties === null) throw new Error('Expected schema properties');
    const nestedSchema = 'nested' in properties ? properties.nested : undefined;
    expect(typeof nestedSchema === 'object' && nestedSchema !== null && 'additionalProperties' in nestedSchema
      ? nestedSchema.additionalProperties
      : undefined).toBeUndefined();

    // Verify sanitizeSchemaForGemini directly on edge inputs
    expect(sanitizeSchemaForGemini(null)).toEqual({ type: 'object', properties: {} });

    expect(sanitizeSchemaForGemini({ anyOf: {}, oneOf: [{ type: 'null' }, { type: 'number' }] })).toEqual({ type: 'number' });

    await manager.shutdown();
  });

  test('degrades gracefully on unreachable servers and handles tool execution timeouts', async () => {
    const config: McpClientsConfig = {
      servers: [
        {
          name: 'broken',
          transport: 'stdio',
          command: 'nonexistent-bin'
        },
        {
          name: 'slow',
          transport: 'sse',
          url: 'https://slow.example.com/sse',
          timeoutMs: 40
        }
      ]
    };

    const manager = new McpClientManager({
      config,
      log: () => {},
      transportFactory: () => dummyTransport(),
      clientFactory: (server): McpClientLike => ({
        connect: async () => {
          if (server.name === 'broken') throw new Error('ECONNREFUSED');
        },
        listTools: async () => ({
          tools: [{ name: 'hang', description: 'Hangs forever', annotations: { readOnlyHint: true } }]
        }),
        callTool: async () => new Promise(() => {}),
        close: async () => {}
      })
    });

    await manager.initialize();
    const health = manager.getHealthReport();
    expect(health.find((h) => h.name === 'broken')?.status).toBe('error');
    expect(health.find((h) => h.name === 'slow')?.status).toBe('connected');

    const res = await manager.callTool('slow__hang', {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain('timed out');

    await manager.shutdown();
  });
});

describe('Permission Engine & Copilot Draft Approval Flow', () => {
  test('evaluateMcpToolPermission enforces human, copilot, and autopilot rules', () => {
    expect(evaluateMcpToolPermission({ agentMode: 'human', risk: 'readOnly' }).decision).toBe('deny');
    expect(evaluateMcpToolPermission({ agentMode: 'copilot', risk: 'readOnly' }).decision).toBe('execute');
    expect(evaluateMcpToolPermission({ agentMode: 'copilot', risk: 'mutating' }).decision).toBe('require_approval');
    expect(evaluateMcpToolPermission({ agentMode: 'autopilot', risk: 'mutating', requiresHumanApproval: true }).decision).toBe('require_approval');
    expect(evaluateMcpToolPermission({ agentMode: 'autopilot', risk: 'mutating', requiresHumanApproval: false }).decision).toBe('execute');
  });

  test('auto-executes readOnly tools and pauses mutating tools into pending Copilot drafts', async () => {
    let executedMutating = 0;
    const manager = new McpClientManager({
      config: {
        servers: [
          {
            name: 'crm',
            transport: 'streamable-http',
            url: 'https://crm.example.com/mcp',
            tools: {
              lookup_contact: { risk: 'readOnly' },
              update_deal: { risk: 'mutating', requiresHumanApproval: true }
            }
          }
        ]
      },
      transportFactory: () => dummyTransport(),
      clientFactory: (): McpClientLike => ({
        connect: async () => {},
        listTools: async () => ({
          tools: [
            { name: 'lookup_contact', description: 'Lookup CRM contact', annotations: { readOnlyHint: true } },
            { name: 'update_deal', description: 'Update CRM deal stage' }
          ]
        }),
        callTool: async ({ name, arguments: args }) => {
          if (name === 'update_deal') executedMutating++;
          return { content: [{ ok: true, name, args }] };
        },
        close: async () => {}
      })
    });
    await manager.initialize();

    // 1. Read-only multi-step loop in copilot mode executes automatically and synthesizes reply
    let callIdx = 0;
    const readLoop = await executeGeminiToolLoop({
      gemini: {
        generateContent: async () => {
          callIdx++;
          if (callIdx === 1) {
            return { text: '', functionCalls: [{ name: 'crm__lookup_contact', args: { email: 'a@b.com' } }] };
          }
          return { text: 'Found contact a@b.com in CRM.' };
        }
      },
      mcpManager: manager,
      tools: manager.listAvailableTools(),
      contents: [{ role: 'user', parts: [{ text: 'Check CRM for a@b.com' }] }],
      agentMode: 'copilot'
    });

    expect(readLoop.status).toBe('completed');
    expect(readLoop.text).toBe('Found contact a@b.com in CRM.');
    expect(readLoop.toolTrace).toHaveLength(1);
    expect(readLoop.toolTrace[0]?.decision).toBe('execute');

    // 2. Mutating tool in ModeratorAgent pauses BEFORE execution and creates pending draft
    const memoryStore = new MemoryStore({ dataDir: ':memory:' });
    memoryStore.setChatMode('201000000001@s.whatsapp.net', 'copilot');
    const sse = new SSEBroadcaster();
    const modGemini = new GeminiClient({ apiKey: 'test-key' });
    modGemini.generateContent = async () => ({
      text: 'I can update the deal stage to Closed Won once you approve.',
      functionCalls: [{ name: 'crm__update_deal', args: { dealId: 'd-42', stage: 'won' } }]
    });
    const moderator = new ModeratorAgent(
      modGemini,
      memoryStore,
      {
        mcpClientManager: manager,
        router: async () => ({
          selectedModel: 'gemini-3.8-flash',
          tier: 'standard',
          confidence: 0.95,
          routerLatencyMs: 1,
          reason: 'test'
        })
      }
    );

    const turnResult = await moderator.processInboundMessage({
      id: 'msg-1',
      chatId: '201000000001@s.whatsapp.net',
      sender: '201000000001@s.whatsapp.net',
      text: 'Mark deal d-42 as won',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    });

    expect(turnResult.shouldSendImmediately).toBe(false);
    expect(turnResult.draftCreated).toBeDefined();
    expect(turnResult.draftCreated?.toolCall?.namespacedName).toBe('crm__update_deal');
    expect(executedMutating).toBe(0);

    // 3. Approving draft via REST API executes the MCP tool and dispatches reply
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    const whatsappClient = new WhatsAppSocketClient();
    whatsappClient.sendMessage = async (chatId: string, text: string) => {
      sentMessages.push({ chatId, text });
      return { messageId: 'wa-msg-99' };
    };
    whatsappClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });
    const app = createApiServer({
      memoryStore,
      moderatorAgent: moderator,
      sse,
      mcpClientManager: manager,
      whatsappClient
    });

    const draft = turnResult.draftCreated;
    if (!draft) throw new Error('Expected draftCreated');
    const approveRes = await app.request(`/api/drafts/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedText: 'Deal d-42 is now marked as Closed Won!' })
    });

    expect(approveRes.status).toBe(200);
    expect(executedMutating).toBe(1);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toBe('Deal d-42 is now marked as Closed Won!');

    memoryStore.close();
    await manager.shutdown();
  });

  test('doctor reports external MCP health without failing when unconfigured', async () => {
    const report = await runDoctor({
      bunVersion: '1.3.0',
      env: { GEMINI_API_KEY: ['test', 'key', '123'].join('-') },
      openStorage: () => 0,
      uiBuilt: () => true,
      gcloudAuthenticated: async () => true,
      sessionPaired: () => true,
      verifyModelKey: async () => true,
      checkExternalMcp: async () => [
        { name: 'composio', status: 'connected', toolCount: 4 }
      ]
    });

    const mcpCheck = report.checks.find((c) => c.id === 'mcp-composio');
    expect(mcpCheck?.level).toBe('pass');
    expect(mcpCheck?.label).toContain('4 tools');
    expect(report.exitCode).toBe(0);
  });
});
