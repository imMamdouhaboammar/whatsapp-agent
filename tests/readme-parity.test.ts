import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { FableFunnelEngine, FunnelRegistry } from '../src/funnel';

async function toolNames(withFunnel: boolean): Promise<string[]> {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  const gemini = new GeminiClient({ apiKey: 'test-key' });
  gemini.generateContent = async () => ({ text: '{}' });
  const whatsappClient = new WhatsAppSocketClient();
  whatsappClient.getState = () => ({ state: 'disconnected', updatedAt: Date.now() });
  const server = createWhatsAppMcpServer({
    memoryStore,
    moderatorAgent: new ModeratorAgent(gemini, memoryStore),
    whatsappClient,
    ...(withFunnel ? { funnelEngine: new FableFunnelEngine({ registry: new FunnelRegistry() }) } : {})
  });
  const client = new Client({ name: 'readme-parity-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name).toSorted((a, b) => a.localeCompare(b));
  } finally {
    await client.close();
    await server.close();
    memoryStore.close();
  }
}

describe('README MCP inventory', () => {
  it('documents exactly the tools the server registers', async () => {
    const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');
    const section = readme.slice(readme.indexOf('### Available MCP tools'));
    const documented = [...section.matchAll(/^\| `(whatsapp_[a-z_]+)`/gm)].map((m) => m[1] ?? '').toSorted((a, b) => a.localeCompare(b));
    expect(documented).toEqual(await toolNames(true));
    const standalone = await toolNames(false);
    expect(standalone).toHaveLength(16);
    expect(standalone).not.toContain('whatsapp_funnel_scatter_gather');
  });

  it('does not claim an HTTP MCP transport the code does not have', () => {
    const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');
    expect(readme).not.toMatch(/stdio and HTTP MCP/);
  });
});
