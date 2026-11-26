import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpClientManager } from '../src/mcp/client-manager';
import { executeGeminiToolLoop } from '../src/mcp/gemini-tool-adapter';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';

async function createRealMcpServerPair(handlers: {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  }>;
  onCall: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}) {
  const server = new Server(
    { name: 'test-external-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: handlers.tools.map((t) => ({
      ...t,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} }
    }))
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return handlers.onCall(req.params.name, req.params.arguments ?? {});
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { server, clientTransport };
}

describe('Adversarial & Behavioral MCP Client Tests', () => {
  test('test_real_mcp_protocol_roundtrip_and_destructive_hint_fail_closed', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const { server, clientTransport } = await createRealMcpServerPair({
      tools: [
        {
          name: 'search_docs',
          description: 'Search knowledge docs',
          annotations: { readOnlyHint: true },
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
        },
        {
          name: 'wipe_records',
          description: 'Conflicting annotations: readOnlyHint + destructiveHint',
          annotations: { readOnlyHint: true, destructiveHint: true },
          inputSchema: { type: 'object', properties: { scope: { type: 'string' } } }
        }
      ],
      onCall: async (name, args) => {
        calls.push({ name, args });
        if (name === 'search_docs') {
          return { content: [{ type: 'text', text: `doc_hit:${String(args.q)}` }] };
        }
        return { content: [{ type: 'text', text: 'tool_error' }], isError: true };
      }
    });

    const manager = new McpClientManager({
      config: {
        servers: [{ name: 'real_srv', transport: 'stdio', command: 'unused' }]
      },
      transportFactory: () => clientTransport
    });

    await manager.initialize();
    const tools = manager.listAvailableTools();
    expect(tools).toHaveLength(2);
    expect(manager.getTool('real_srv__search_docs')?.risk).toBe('readOnly');
    // Fail-closed: destructiveHint=true MUST override readOnlyHint=true
    expect(manager.getTool('real_srv__wipe_records')?.risk).toBe('mutating');

    const okRes = await manager.callTool('real_srv__search_docs', { q: 'pricing' });
    expect(okRes.ok).toBe(true);
    expect(calls[0]).toEqual({ name: 'search_docs', args: { q: 'pricing' } });

    const errRes = await manager.callTool('real_srv__wipe_records', { scope: 'all' });
    expect(errRes.ok).toBe(false);
    expect(errRes.isError).toBe(true);

    await manager.shutdown();
    await server.close();
  });

  test('test_malformed_config_degrades_gracefully_without_crashing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-bad-cfg-'));
    const cfgPath = join(dir, 'mcp-clients.json');
    writeFileSync(cfgPath, '{not valid json!!!', 'utf8');
    try {
      const manager = new McpClientManager({ configPath: cfgPath, log: () => {} });
      await manager.initialize();
      expect(manager.listAvailableTools()).toEqual([]);
      expect(manager.getHealthReport()).toEqual([]);
      await manager.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores malformed server entries without losing valid siblings or logging credentials', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-invalid-entry-'));
    const configPath = join(dir, 'mcp-clients.json');
    const sensitive = ['private', 'fixture', 'value'].join('-');
    writeFileSync(configPath, JSON.stringify({ servers: [
      { name: 'invalid', transport: 'typo', url: 'https://example.invalid', headers: { Authorization: sensitive } },
      { name: 'valid', transport: 'stdio', enabled: false }
    ] }));
    const logs: string[] = [];
    const manager = new McpClientManager({
      configPath,
      transportFactory: () => { throw new Error('Invalid server must not connect'); },
      log: (_level, message) => logs.push(message)
    });
    try {
      await manager.initialize();
      expect(manager.getHealthReport().map(({ name }) => name)).toEqual(['valid']);
      expect(logs.join(' ')).not.toContain(sensitive);
    } finally {
      await manager.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('test_cross_tenant_brand_isolation_blocks_tool_discovery_and_execution', async () => {
    const { server, clientTransport } = await createRealMcpServerPair({
      tools: [{ name: 'secret_lookup', annotations: { readOnlyHint: true } }],
      onCall: async () => ({ content: [{ type: 'text', text: 'leaked_secret' }] })
    });

    const manager = new McpClientManager({
      brandId: 'tenant-alpha',
      config: {
        servers: [
          { name: 'beta_crm', transport: 'stdio', command: 'unused', brandId: 'tenant-beta' }
        ]
      },
      transportFactory: () => clientTransport
    });

    await manager.initialize();
    expect(manager.listAvailableTools()).toEqual([]);
    expect(manager.listAvailableTools('tenant-alpha')).toEqual([]);
    const callRes = await manager.callTool('beta_crm__secret_lookup', {}, { brandId: 'tenant-alpha' });
    expect(callRes.ok).toBe(false);
    expect(callRes.error).toContain('not available');

    await manager.shutdown();
    await server.close();
  });

  test('test_circuit_breaker_opens_after_repeated_failures_and_fast_fails', async () => {
    let transportAttempts = 0;
    const { server, clientTransport } = await createRealMcpServerPair({
      tools: [{ name: 'flaky_op', annotations: { readOnlyHint: true } }],
      onCall: async () => {
        transportAttempts++;
        throw new Error('upstream_503');
      }
    });

    const manager = new McpClientManager({
      config: { servers: [{ name: 'flaky', transport: 'stdio', command: 'unused' }] },
      transportFactory: () => clientTransport
    });
    await manager.initialize();

    for (let i = 0; i < 3; i++) {
      const res = await manager.callTool('flaky__flaky_op', {});
      expect(res.ok).toBe(false);
    }
    expect(transportAttempts).toBe(3);
    expect(manager.getHealthReport()[0]?.circuitState).toBe('OPEN');

    // 4th call must fast-fail without hitting the MCP transport
    const fourth = await manager.callTool('flaky__flaky_op', {});
    expect(fourth.ok).toBe(false);
    expect(fourth.error).toContain('Circuit breaker OPEN');
    expect(transportAttempts).toBe(3);

    await manager.shutdown();
    await server.close();
  });

  test('test_tool_loop_caps_infinite_hops_and_recovers_from_hallucinated_tools', async () => {
    let executed = 0;
    const { server, clientTransport } = await createRealMcpServerPair({
      tools: [{ name: 'ping', annotations: { readOnlyHint: true } }],
      onCall: async () => {
        executed++;
        return { content: [{ type: 'text', text: 'pong' }] };
      }
    });

    const manager = new McpClientManager({
      config: { servers: [{ name: 'sys', transport: 'stdio', command: 'unused' }] },
      transportFactory: () => clientTransport
    });
    await manager.initialize();

    // Case 1: Hallucinated tool name fails closed and feeds error back to Gemini
    let hallucinationTurn = 0;
    const hallucinated = await executeGeminiToolLoop({
      gemini: {
        generateContent: async (contents) => {
          hallucinationTurn++;
          if (hallucinationTurn === 1) {
            return { text: '', functionCalls: [{ name: 'evil__drop_database', args: {} }] };
          }
          const lastUser = contents[contents.length - 1];
          const errPayload = JSON.stringify(lastUser?.parts[0]?.functionResponse?.response);
          expect(errPayload).toContain('Unknown tool');
          return { text: 'Cannot run unknown tool.' };
        }
      },
      mcpManager: manager,
      tools: manager.listAvailableTools(),
      contents: [{ role: 'user', parts: [{ text: 'Drop db' }] }],
      agentMode: 'autopilot'
    });
    expect(hallucinated.status).toBe('completed');
    expect(hallucinated.toolTrace[0]?.decision).toBe('deny');
    expect(executed).toBe(0);

    // Case 2: Infinite functionCall loop stops at maxIterations=3 and synthesizes final reply
    let loopCalls = 0;
    const capped = await executeGeminiToolLoop({
      gemini: {
        generateContent: async (_contents, opts) => {
          loopCalls++;
          if (opts?.functionDeclarations?.length) {
            return { text: '', functionCalls: [{ name: 'sys__ping', args: {} }] };
          }
          return { text: 'Synthesized after max hops.' };
        }
      },
      mcpManager: manager,
      tools: manager.listAvailableTools(),
      contents: [{ role: 'user', parts: [{ text: 'Ping forever' }] }],
      agentMode: 'autopilot',
      maxIterations: 3
    });
    expect(capped.status).toBe('completed');
    expect(capped.iterations).toBe(3);
    expect(executed).toBe(3);
    expect(loopCalls).toBe(4); // 3 tool hops + 1 final synthesis without tools
    expect(capped.text).toBe('Synthesized after max hops.');

    await manager.shutdown();
    await server.close();
  });

  test('test_tool_loop_respects_model_fallback_and_fails_closed_on_auth_error', async () => {
    const manager = new McpClientManager({ config: { servers: [] } });
    await manager.initialize();

    // 429 triggers fallback to second model
    const attemptedModels: string[] = [];
    const fallbackRes = await executeGeminiToolLoop({
      gemini: {
        generateContent: async (_contents, opts) => {
          attemptedModels.push(opts?.model ?? '');
          if (opts?.model === 'model-primary') {
            const err: Error & { status?: number } = new Error('Quota exceeded');
            err.status = 429;
            throw err;
          }
          return { text: 'Recovered on backup model' };
        }
      },
      mcpManager: manager,
      tools: [],
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      agentMode: 'autopilot',
      preferredModel: 'model-primary',
      fallbackModels: ['model-primary', 'model-backup']
    });
    expect(fallbackRes.activeModel).toBe('model-backup');
    expect(attemptedModels).toEqual(['model-primary', 'model-backup']);

    // 401 fails closed immediately without trying backup
    const authModels: string[] = [];
    const authFailure: unknown = await executeGeminiToolLoop({
      gemini: {
        generateContent: async (_contents, opts) => {
          authModels.push(opts?.model ?? '');
          const err: Error & { status?: number } = new Error('UNAUTHENTICATED');
          err.status = 401;
          throw err;
        }
      },
      mcpManager: manager,
      tools: [],
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      agentMode: 'autopilot',
      preferredModel: 'model-primary',
      fallbackModels: ['model-primary', 'model-backup']
    }).then(() => undefined, (error: unknown) => error);
    expect(authFailure).toBeInstanceOf(Error);
    expect(authFailure).toMatchObject({ message: expect.stringContaining('UNAUTHENTICATED') });
    expect(authModels).toEqual(['model-primary']);

    await manager.shutdown();
  });

  test('test_human_mode_blocks_even_readonly_tools', async () => {
    let called = 0;
    const { server, clientTransport } = await createRealMcpServerPair({
      tools: [{ name: 'read_calendar', annotations: { readOnlyHint: true } }],
      onCall: async () => {
        called++;
        return { content: [{ type: 'text', text: 'free' }] };
      }
    });

    const manager = new McpClientManager({
      config: { servers: [{ name: 'cal', transport: 'stdio', command: 'unused' }] },
      transportFactory: () => clientTransport
    });
    await manager.initialize();

    const res = await executeGeminiToolLoop({
      gemini: {
        generateContent: async () => ({
          text: '',
          functionCalls: [{ name: 'cal__read_calendar', args: {} }]
        })
      },
      mcpManager: manager,
      tools: manager.listAvailableTools(),
      contents: [{ role: 'user', parts: [{ text: 'Am I free?' }] }],
      agentMode: 'human'
    });

    expect(res.status).toBe('blocked_human');
    expect(called).toBe(0);

    await manager.shutdown();
    await server.close();
  });

  test('test_pending_tool_draft_persists_across_restart_and_fails_safely_on_tool_error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-draft-persist-'));
    let shouldFailTool = true;
    let toolCalls = 0;

    const { server, clientTransport } = await createRealMcpServerPair({
      tools: [{ name: 'send_invoice', description: 'Send invoice' }],
      onCall: async (_name, args) => {
        toolCalls++;
        if (shouldFailTool) {
          return { content: [{ type: 'text', text: 'gateway down' }], isError: true };
        }
        return { content: [{ type: 'text', text: `sent:${String(args.invoiceId)}` }] };
      }
    });

    const manager = new McpClientManager({
      config: { servers: [{ name: 'billing', transport: 'stdio', command: 'unused' }] },
      transportFactory: () => clientTransport
    });
    await manager.initialize();

    try {
      // Phase 1: Create draft in SQLite store
      const store1 = new MemoryStore({ dataDir: dir });
      store1.setChatMode('201000000009@s.whatsapp.net', 'copilot');
      const modGemini = new GeminiClient({ apiKey: 'test-key' });
      modGemini.generateContent = async () => ({
        text: 'Ready to send invoice #77.',
        functionCalls: [{ name: 'billing__send_invoice', args: { invoiceId: 'INV-77' } }]
      });
      const moderator1 = new ModeratorAgent(
        modGemini,
        store1,
        {
          mcpClientManager: manager,
          router: async () => ({
            selectedModel: 'gemini-3.8-flash',
            tier: 'standard',
            confidence: 0.9,
            routerLatencyMs: 1,
            reason: 'test'
          })
        }
      );

      const turn = await moderator1.processInboundMessage({
        id: 'm-100',
        chatId: '201000000009@s.whatsapp.net',
        sender: '201000000009@s.whatsapp.net',
        text: 'Send invoice 77',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      });
      const draftCreated = turn.draftCreated;
      if (!draftCreated) throw new Error('Expected draftCreated');
      const draftId = draftCreated.id;
      store1.close();

      // Phase 2: Re-open MemoryStore from disk and verify toolCall survived restart
      const store2 = new MemoryStore({ dataDir: dir });
      const reloaded = store2.getDraft(draftId);
      expect(reloaded?.status).toBe('pending');
      expect(reloaded?.toolCall?.namespacedName).toBe('billing__send_invoice');
      expect(reloaded?.toolCall?.args).toEqual({ invoiceId: 'INV-77' });

      const sentMessages: string[] = [];
      const sseEvents: Array<{ event: string; data: unknown }> = [];
      const sse = new SSEBroadcaster();
      sse.subscribe((msg) => sseEvents.push(msg));

      const whatsappClient = new WhatsAppSocketClient();
      whatsappClient.sendMessage = async (_chatId: string, text: string) => {
        sentMessages.push(text);
        return { messageId: 'wa-1' };
      };
      whatsappClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });

      const app = createApiServer({
        memoryStore: store2,
        moderatorAgent: moderator1,
        sse,
        mcpClientManager: manager,
        whatsappClient
      });

      // Tool failure on approval returns 502, does NOT send WhatsApp message, keeps draft pending
      const failApprove = await app.request(`/api/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(failApprove.status).toBe(502);
      expect(sentMessages).toEqual([]);
      expect(store2.getDraft(draftId)?.status).toBe('pending');

      // Now tool succeeds -> approval executes tool, sends WhatsApp reply, marks draft sent, emits SSE
      shouldFailTool = false;
      const okApprove = await app.request(`/api/drafts/${draftId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(okApprove.status).toBe(200);
      expect(toolCalls).toBe(2);
      expect(sentMessages).toEqual(['Ready to send invoice #77.']);
      expect(store2.getDraft(draftId)?.status).toBe('sent');
      expect(sseEvents.some((e) => e.event === 'draft_updated')).toBe(true);

      // Verify /api/mcp/external reports connected server & tools
      const extRes = await app.request('/api/mcp/external');
      expect(extRes.status).toBe(200);
      const extJson: unknown = await extRes.json();
      expect(extJson).toMatchObject({
        servers: [{ name: 'billing' }],
        tools: [{ namespacedName: 'billing__send_invoice' }]
      });

      // Rejecting a second draft never executes the tool
      store2.saveDraft({
        id: 'draft-reject-1',
        chatId: '201000000009@s.whatsapp.net',
        incomingMessageId: 'm-101',
        incomingText: 'Send again',
        proposedReply: 'Sending again',
        reasoning: 'test',
        confidence: 0.9,
        status: 'pending',
        createdAt: Date.now(),
        toolCall: {
          namespacedName: 'billing__send_invoice',
          serverName: 'billing',
          toolName: 'send_invoice',
          args: { invoiceId: 'INV-78' },
          risk: 'mutating'
        }
      });
      const rejectRes = await app.request('/api/drafts/draft-reject-1/reject', { method: 'POST' });
      expect(rejectRes.status).toBe(200);
      expect(toolCalls).toBe(2);
      expect(store2.getDraft('draft-reject-1')?.status).toBe('rejected');

      // Verify whatsapp_approve_draft MCP server tool also executes pending external toolCall
      store2.saveDraft({
        id: 'draft-mcp-approve',
        chatId: '201000000009@s.whatsapp.net',
        incomingMessageId: 'm-102',
        incomingText: 'Send via MCP',
        proposedReply: 'Invoice #79 sent!',
        reasoning: 'test',
        confidence: 0.9,
        status: 'pending',
        createdAt: Date.now(),
        toolCall: {
          namespacedName: 'billing__send_invoice',
          serverName: 'billing',
          toolName: 'send_invoice',
          args: { invoiceId: 'INV-79' },
          risk: 'mutating'
        }
      });
      const mcpWhatsappClient = new WhatsAppSocketClient();
      mcpWhatsappClient.sendMessage = async (_chatId: string, text: string) => {
        sentMessages.push(text);
        return { messageId: 'wa-2' };
      };
      mcpWhatsappClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });

      const mcpServer = createWhatsAppMcpServer({
        memoryStore: store2,
        moderatorAgent: moderator1,
        mcpClientManager: manager,
        whatsappClient: mcpWhatsappClient
      });
      const [mcpClientT, mcpServerT] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(mcpServerT);
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const waClient = new Client({ name: 'test-wa-mcp-client', version: '1.0.0' }, { capabilities: {} });
      await waClient.connect(mcpClientT);

      const approveToolRes = await waClient.callTool({
        name: 'whatsapp_approve_draft',
        arguments: { draftId: 'draft-mcp-approve' }
      });
      expect(approveToolRes.isError).toBeFalsy();
      expect(toolCalls).toBe(3);
      expect(sentMessages).toEqual(['Ready to send invoice #77.', 'Invoice #79 sent!']);

      await waClient.close();
      await mcpServer.close();
      store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await manager.shutdown();
      await server.close();
    }
  });
});
