import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';

async function toolNames(withFunnel: boolean): Promise<string[]> {
  const memoryStore = new MemoryStore({ dataDir: './data/test-readme-parity' });
  const gemini: any = { generateContent: async () => ({ text: '{}' }) };
  const server = createWhatsAppMcpServer({
    memoryStore,
    moderatorAgent: new ModeratorAgent(gemini, memoryStore),
    whatsappClient: { getState: () => ({ state: 'disconnected' }) } as any,
    ...(withFunnel ? { funnelEngine: {} as any } : {})
  });
  const handler = (server as any)._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
  return (await handler({ method: 'tools/list' }, {})).tools.map((t: any) => t.name).sort();
}

describe('README MCP inventory', () => {
  it('documents exactly the tools the server registers', async () => {
    const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');
    const section = readme.slice(readme.indexOf('### Available MCP tools'));
    const documented = [...section.matchAll(/^\| `(whatsapp_[a-z_]+)`/gm)].map((m) => m[1]).sort();
    expect(documented).toEqual(await toolNames(true));
    const standalone = await toolNames(false);
    expect(standalone).toHaveLength(14);
    expect(standalone).not.toContain('whatsapp_funnel_scatter_gather');
  });

  it('does not claim an HTTP MCP transport the code does not have', () => {
    const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');
    expect(readme).not.toMatch(/stdio and HTTP MCP/);
  });
});
