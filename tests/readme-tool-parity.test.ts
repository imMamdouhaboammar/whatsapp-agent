import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { FableFunnelEngine, FunnelRegistry } from '../src/funnel';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

async function runtimeTools(): Promise<Array<{ name: string; properties: string[]; required: string[] }>> {
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  const gemini = new GeminiClient({ apiKey: 'test-key' });
  gemini.generateContent = async () => ({ text: '{}' });
  const agent = new ModeratorAgent(gemini, memoryStore);
  const server = createWhatsAppMcpServer({
    memoryStore,
    whatsappClient: new WhatsAppSocketClient(),
    moderatorAgent: agent,
    funnelEngine: new FableFunnelEngine({ registry: new FunnelRegistry() })
  });
  const client = new Client({ name: 'readme-parity-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      properties: Object.keys(tool.inputSchema.properties ?? {}),
      required: tool.inputSchema.required ?? []
    }));
  } finally {
    await client.close();
    await server.close();
    memoryStore.close();
  }
}

describe('README stays in step with the runtime', () => {
  it('documents exactly the MCP tools the server registers, with matching parameters', async () => {
    const readme = read('../README.md');
    const section = readme.split('### Available MCP tools')[1]?.split(/\n#{2,3} /)[0] ?? '';
    const rows = [...section.matchAll(/^\| `(whatsapp_[a-z_]+)` \| (.*?) \| /gm)];
    const documented = new Map(rows.map(r => [r[1] ?? '', r[2]]));
    const runtime = await runtimeTools();
    expect([...documented.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual(
      runtime.map(t => t.name).toSorted((a, b) => a.localeCompare(b))
    );
    for (const tool of runtime) {
      const cell = documented.get(tool.name) ?? '';
      for (const prop of tool.properties) expect(cell).toContain(prop + (tool.required.includes(prop) ? ':' : '?:'));
    }
  });

  it('states the same tool count as the runtime registry', async () => {
    const readme = read('../README.md');
    const claimed = [...readme.matchAll(/exposing (\d+) tools/g)].map(m => Number(m[1]));
    expect(claimed.length).toBeGreaterThan(0);
    for (const n of claimed) expect(n).toBe((await runtimeTools()).length);
  });

  it('does not hardcode test counts or an unmeasured memory figure', () => {
    for (const file of ['../README.md', '../docs/whatsapp-context-fold.md']) {
      const text = read(file);
      expect(text).not.toMatch(/\b\d+ (?:passing|pass|skipped|failing)\b/i);
      expect(text).not.toMatch(/~?\s?\d+\s?MB RAM/i);
    }
  });
});
