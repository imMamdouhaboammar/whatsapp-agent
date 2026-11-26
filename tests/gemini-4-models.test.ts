import { describe, expect, it } from 'bun:test';
import {
  GEMINI_4_MODELS,
  SUPPORTED_GEMINI_MODELS,
  isGemini4Model
} from '../src/ai/model-router';
import {
  resolveModelChain,
  executeWithModelFallback
} from '../src/ai/model-fallback';
import { GeminiClient } from '../src/ai/gemini-client';
import { ModeratorAgent, DEFAULT_MODERATOR_PERSONA } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';

describe('Gemini 4 Models Family Support', () => {
  it('defines all major Gemini 4 model identifiers and descriptors', () => {
    expect(GEMINI_4_MODELS).toContain('gemini-4-carbon');
    expect(GEMINI_4_MODELS).toContain('gemini-4-argon');
    expect(GEMINI_4_MODELS).toContain('gemini-4-hydrogen');
    expect(GEMINI_4_MODELS).toContain('gemini-4-neon');
    expect(GEMINI_4_MODELS).toContain('gemini-4-flash');
    expect(GEMINI_4_MODELS).toContain('gemini-4-pro');

    for (const model of GEMINI_4_MODELS) {
      expect(isGemini4Model(model)).toBe(true);
    }

    expect(isGemini4Model('gemini-3.8-flash')).toBe(false);
    expect(isGemini4Model('gemini-3.1-pro')).toBe(false);

    // Verify rich model metadata
    const carbon = SUPPORTED_GEMINI_MODELS.find((m) => m.id === 'gemini-4-carbon');
    expect(carbon).toBeDefined();
    expect(carbon?.generation).toBe(4);
    expect(carbon?.tier).toBe('flagship');
    expect(carbon?.defaultThinkingLevel).toBe('HIGH');

    const argon = SUPPORTED_GEMINI_MODELS.find((m) => m.id === 'gemini-4-argon');
    expect(argon).toBeDefined();
    expect(argon?.generation).toBe(4);
    expect(argon?.tier).toBe('frontier');

    const hydrogen = SUPPORTED_GEMINI_MODELS.find((m) => m.id === 'gemini-4-hydrogen');
    expect(hydrogen).toBeDefined();
    expect(hydrogen?.generation).toBe(4);
    expect(hydrogen?.tier).toBe('workhorse');
  });

  it('builds an intelligent fallback chain for Gemini 4 models', () => {
    // When using Gemini 4 Carbon (flagship), falls back through Gemini 4 family before legacy
    const carbonChain = resolveModelChain('gemini-4-carbon');
    expect(carbonChain[0]).toBe('gemini-4-carbon');
    expect(carbonChain).toContain('gemini-4-argon');
    expect(carbonChain).toContain('gemini-4-hydrogen');
    expect(carbonChain).toContain('gemini-3.8-flash');

    // When using Gemini 4 Hydrogen (fast execution), puts Hydrogen first
    const hydrogenChain = resolveModelChain('gemini-4-hydrogen');
    expect(hydrogenChain[0]).toBe('gemini-4-hydrogen');
    expect(hydrogenChain).toContain('gemini-4-carbon');
    expect(hydrogenChain).toContain('gemini-3.8-flash');

    // Preserves exact backward-compatibility for Gemini 3.8 and Argon
    const flashChain = resolveModelChain('gemini-3.8-flash');
    expect(flashChain).toEqual(['gemini-3.8-flash', 'gemini-3.1-pro', 'gemini-4-argon']);

    const argonChain = resolveModelChain('gemini-4-argon');
    expect(argonChain).toEqual(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro']);
  });

  it('executes fallback across Gemini 4 models successfully', async () => {
    const attemptedModels: string[] = [];
    const models = ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen'];

    const outcome = await executeWithModelFallback(
      models,
      async (model) => {
        attemptedModels.push(model);
        if (model === 'gemini-4-carbon') {
          const err: Error & { status?: number } = new Error('429 Resource Exhausted');
          err.status = 429;
          throw err;
        }
        return `Healthy response from ${model}`;
      },
      { preferredModel: 'gemini-4-carbon' }
    );

    expect(attemptedModels).toEqual(['gemini-4-carbon', 'gemini-4-argon']);
    expect(outcome.activeModel).toBe('gemini-4-argon');
    expect(outcome.attempts).toBe(2);
    expect(outcome.result).toBe('Healthy response from gemini-4-argon');
  });

  it('gracefully handles 404 endpoint fallbacks for Gemini 4 models in GeminiClient', async () => {
    const calledModels: string[] = [];

    // Subclass or mock GeminiClient to inspect model fallback without network calls
    const mockClient = new GeminiClient({ apiKey: 'test-key' });
    // Patch internal fetcher / auth
    Reflect.set(mockClient, 'ensureAuth', async () => ({ type: 'vertex', tokenOrKey: 'fake-token', project: 'proj' }));

    // Mock fetch globally for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const urlStr = url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      const match = urlStr.match(/models\/([^:]+):generateContent/);
      const model = match?.[1] ?? '';
      calledModels.push(model);

      if (model === 'gemini-4-carbon') {
        return new Response(JSON.stringify({ error: { message: 'Model not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: `Response from ${model}` }] } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const res = await mockClient.generateContent([{ role: 'user', parts: [{ text: 'Hello' }] }], {
        model: 'gemini-4-carbon'
      });

      expect(calledModels).toContain('gemini-4-carbon');
      expect(calledModels).toContain('gemini-4-argon');
      expect(res.text).toBe('Response from gemini-4-argon');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('supports Gemini 4 model in ModeratorPersona configuration', () => {
    expect(DEFAULT_MODERATOR_PERSONA.model).toBe('gemini-4-argon');

    // Create a moderator persona with Gemini 4 Carbon
    const mockGemini = new GeminiClient({ apiKey: 'dummy-key' });
    const memory = new MemoryStore({ dataDir: ':memory:' });
    try {
      const agent = new ModeratorAgent(mockGemini, memory, {
        persona: {
          model: 'gemini-4-carbon'
        }
      });

      const persona = agent.getPersona();
      expect(persona.model).toBe('gemini-4-carbon');

      // Update to Gemini 4 Hydrogen
      agent.updatePersona({ model: 'gemini-4-hydrogen' });
      expect(agent.getPersona().model).toBe('gemini-4-hydrogen');
    } finally {
      memory.close();
    }
  });
});
