import { rejects } from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, spyOn } from 'bun:test';
import {
  routeTurnModel,
  JevModelRouter,
  DEFAULT_BYPASS_MODEL,
  type RoutingDecision
} from '../src/ai/model-router';
import { executeWithModelFallback, resolveModelChain } from '../src/ai/model-fallback';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage } from '../src/domain/types';

import { McpClientManager } from '../src/mcp/client-manager';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { ReflectionEngine } from '../src/ai/reflection-engine';
import { GeminiClient } from '../src/ai/gemini-client';
function providerChoice(choice: 'trivial' | 'standard' | 'complex', confidence: number) {
  return {
    model: 'jev-latest',
    answers: {
      route: {
        type: 'choice',
        choice,
        confidence,
        probabilities: {
          trivial: choice === 'trivial' ? 1 : 0,
          standard: choice === 'standard' ? 1 : 0,
          complex: choice === 'complex' ? 1 : 0
        }
      },
      action_risk: {
        type: 'choice',
        choice: 'routine',
        confidence: 0.96,
        probabilities: { routine: 0.96, consequential: 0.04 }
      }
    }
  };
}

function routerResponse(body: ReturnType<typeof providerChoice>): typeof fetch {
  return async () => Response.json(body);
}

const mockTimeoutFetch: typeof fetch = async () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  throw err;
};

const mock500Fetch: typeof fetch = async () => {
  return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
};

describe('Jev Model Router Layer', () => {
  it('routes high-confidence trivial Arabic greetings to gemini-3.8-flash', async () => {
    const requestBodies: unknown[] = [];

    const mockFetch: typeof fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      requestBodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify(providerChoice('trivial', 0.96)),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const decision = await routeTurnModel({
      message: 'السلام عليكم ورحمة الله وبركاته، صباح الخير',
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      fetchFn: mockFetch
    });

    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.tier).toBe('trivial');
    expect(decision.confidence).toBe(0.96);
    expect(decision.bypassed).toBe(false);
    expect(requestBodies[0]).toMatchObject({ state: 'السلام عليكم ورحمة الله وبركاته، صباح الخير' });
  });

  it('routes high-confidence standard product/pricing queries to gemini-3.8-flash', async () => {
    const mockFetch = routerResponse(providerChoice('standard', 0.89));

    const decision = await routeTurnModel({
      message: 'بكام كورس الذكاء الاصطناعي ومواعيده إمتى؟',
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      fetchFn: mockFetch
    });

    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.tier).toBe('standard');
    expect(decision.confidence).toBe(0.89);
    expect(decision.bypassed).toBe(false);
  });

  it('routes high-confidence complex/angry complaints to gemini-4-argon', async () => {
    const requestBodies: unknown[] = [];

    const mockFetch: typeof fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      requestBodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify(providerChoice('complex', 0.94)),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const decision = await routeTurnModel({
      message: 'الخدمة سيئة جداً ومحدش بيرد عليا وعايز أسترجع فلوسي فوراً وإلا هشتكي في حماية المستهلك!',
      threadContext: ['تم الدفع أمس برقم إيصال 4882'],
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      fetchFn: mockFetch
    });

    expect(decision.selectedModel).toBe('gemini-4-argon');
    expect(decision.tier).toBe('complex');
    expect(decision.confidence).toBe(0.94);
    expect(decision.bypassed).toBe(false);
    const body = requestBodies[0];
    if (typeof body !== 'object' || body === null) throw new Error('Expected a captured request object');
    expect(body).not.toHaveProperty('context');
  });

  it('overrides decision to gemini-3.8-flash when confidence is below threshold (< 0.75)', async () => {
    const mockFetch = routerResponse(providerChoice('complex', 0.62));

    const decision = await routeTurnModel({
      message: 'مش عارف أقرر، محتاج مساعدة عامة',
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      confidenceThreshold: 0.75,
      fetchFn: mockFetch
    });

    // Forced fallback to standard gemini-3.8-flash due to low confidence
    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.tier).toBe('standard');
    expect(decision.confidence).toBe(0.62);
    expect(decision.reason).toContain('Low confidence override to standard');
    expect(decision.bypassed).toBe(false);
  });

  it('bypasses immediately to gemini-3.8-flash with 0ms latency when TYPESAFE_API_KEY is missing', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('{}');
    };

    const decision = await routeTurnModel({
      message: 'صباح الخير',
      apiKey: '',
      enabled: false,
      fetchFn: mockFetch
    });

    expect(fetchCalled).toBe(false);
    expect(decision.selectedModel).toBe(DEFAULT_BYPASS_MODEL);
    expect(decision.tier).toBe('standard');
    expect(decision.confidence).toBe(0);
    expect(decision.routerLatencyMs).toBe(0);
    expect(decision.bypassed).toBe(true);
  });

  it('fails open to gemini-3.8-flash when Jev API times out (>800ms) or returns 500 error', async () => {
    // 1. Test timeout fail-open
    const timeoutDecision = await routeTurnModel({
      message: 'رسالة أثناء انقطاع الشبكة',
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      timeoutMs: 50,
      fetchFn: mockTimeoutFetch
    });

    expect(timeoutDecision.selectedModel).toBe('gemini-3.8-flash');
    expect(timeoutDecision.tier).toBe('standard');
    expect(timeoutDecision.bypassed).toBe(true);
    expect(timeoutDecision.reason).toContain('Router exception');

    // 2. Test 500 HTTP server error fail-open
    const errorDecision = await routeTurnModel({
      message: 'رسالة أثناء عطل السيرفر',
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      fetchFn: mock500Fetch
    });

    expect(errorDecision.selectedModel).toBe('gemini-3.8-flash');
    expect(errorDecision.tier).toBe('standard');
    expect(errorDecision.bypassed).toBe(true);
    expect(errorDecision.reason).toContain('Router HTTP error 500');
  });

  it('scrubs sensitive credentials before dispatching request to Jev', async () => {
    const requestBodies: unknown[] = [];

    const mockFetch: typeof fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      requestBodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify(providerChoice('trivial', 0.99)),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    // Dynamically construct dummy secret tokens at runtime
    const dummyKey = ['sk', 'live', 'abcdef1234567890abcdef1234'].join('-');
    const testMessage = `كلمة المرور الخاصة بي هي mySecretPass123 ومفتاحي ${dummyKey}`;

    await routeTurnModel({
      message: testMessage,
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      fetchFn: mockFetch
    });

    const body = requestBodies[0];
    if (typeof body !== 'object' || body === null || !('state' in body) || typeof body.state !== 'string') {
      throw new Error('Expected a captured request with a string state');
    }
    expect(body.state).not.toContain(dummyKey);
    expect(body.state).not.toContain('mySecretPass123');
    expect(body.state).toContain('[REDACTED_CREDENTIAL]');
  });

  it('supports JevModelRouter class instance and default options', async () => {
    const mockFetch = routerResponse(providerChoice('trivial', 0.92));

    const router = new JevModelRouter({
      apiKey: 'test-typesafe-key',
      externalRoutingAllowed: true,
      confidenceThreshold: 0.8,
      fetchFn: mockFetch
    });

    const decision = await router.route('شكراً جزيلاً');
    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.tier).toBe('trivial');
    expect(decision.confidence).toBe(0.92);
  });
});

describe('Model Fallback Dynamic Chain with preferredModel', () => {
  it('resolves model chain prioritizing preferredModel at index 0', () => {
    const chain1 = resolveModelChain('gemini-3.8-flash');
    expect(chain1[0]).toBe('gemini-3.8-flash');
    expect(chain1).toEqual(['gemini-3.8-flash', 'gemini-3.1-pro', 'gemini-4-argon']);

    const chain2 = resolveModelChain('gemini-4-argon');
    expect(chain2[0]).toBe('gemini-4-argon');
    expect(chain2).toEqual(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro']);
  });

  it('executes fallback using preferredModel option without duplicates', async () => {
    const attemptedModels: string[] = [];
    const models = ['gemini-3.8-flash', 'gemini-3.1-pro', 'gemini-4-argon'];

    const outcome = await executeWithModelFallback(
      models,
      async (model) => {
        attemptedModels.push(model);
        if (model === 'gemini-4-argon') {
          const err = new Error('503 Service Unavailable');
          Object.assign(err, { status: 503 });
          throw err;
        }
        return `Success from ${model}`;
      },
      { preferredModel: 'gemini-4-argon' }
    );

    // gemini-4-argon was attempted first because it was preferredModel
    expect(attemptedModels[0]).toBe('gemini-4-argon');
    expect(attemptedModels[1]).toBe('gemini-3.8-flash');
    expect(outcome.activeModel).toBe('gemini-3.8-flash');
    expect(outcome.attempts).toBe(2);
  });
});

async function complexRouter(): Promise<RoutingDecision> {
  return {
    selectedModel: 'gemini-4-argon',
    tier: 'complex',
    confidence: 0.93,
    routerLatencyMs: 38,
    reason: 'Complex inquiry requiring reasoning',
    bypassed: false
  };
}

describe('ModeratorAgent + Jev Routing Integration', () => {
  it('populates modelRouting and embeds routing trace in reasoning', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-memory-jev' });
    let modelCalledWith: string | null = null;

    const mockGemini = new GeminiClient({ apiKey: 'test-key' });
    mockGemini.generateContent = async (_contents, options) => {
      modelCalledWith = options?.model ?? null;
      return {
        text: JSON.stringify({
          action: 'reply',
          intent: 'general_faq',
          replyText: 'أهلاً بك، الكورس متاح حالياً!',
          reasoning: 'Helpful answer about course availability',
          confidence: 0.95
        })
      };
    };

    const agent = new ModeratorAgent(mockGemini, memory, { router: complexRouter });
    const incoming: ChatMessage = {
      id: 'msg_jev_1',
      chatId: 'test_student@s.whatsapp.net',
      sender: 'test_student@s.whatsapp.net',
      text: 'عندي مشكلة في التسجيل وخصم الفلوس مرتين',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(incoming);

    // Gemini was invoked with the preferredModel selected by the router
    expect(String(modelCalledWith)).toBe('gemini-4-argon');

    // Decision contains strongly-typed modelRouting
    expect(result.decision.modelRouting).toBeDefined();
    expect(result.decision.modelRouting?.selectedModel).toBe('gemini-4-argon');
    expect(result.decision.modelRouting?.tier).toBe('complex');
    expect(result.decision.modelRouting?.routerLatencyMs).toBe(38);

    // Decision reasoning includes the formatted trace
    expect(result.decision.reasoning).toContain('[Jev: complex -> gemini-4-argon (93%, 38ms)]');
    expect(result.decision.reasoning).toContain('Helpful answer about course availability');
  });
});

describe('AI response validation', () => {
  it('rejects a malformed Gemini function call before exposing it to callers', async () => {
    const spawn = spyOn(Bun, 'spawn').mockImplementation(() => { throw new Error('Cloud CLI disabled in test'); });
    const fetcher = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [{ functionCall: { name: 42 } }] } }]
    }));
    try {
      const client = new GeminiClient({ apiKey: 'fixture' });
      await rejects(client.generateContent([{ role: 'user', parts: [{ text: 'Test' }] }]), /non-JSON response/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      fetcher.mockRestore();
      spawn.mockRestore();
    }
  });

  it('rejects a non-object reflection without persisting model output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wa-reflection-'));
    try {
      const memory = new DualMemoryManager({ storageDir: dir });
      const workbook = memory.getWorkbook();
      const model = new GeminiClient();
      model.generateContent = async () => ({ text: '[]' });
      const engine = new ReflectionEngine(model, memory);
      await rejects(engine.evaluateThread({ chatId: 'test', messages: [] }), /Reflection response must be a JSON object/);
      expect(memory.getWorkbook()).toEqual(workbook);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hands off a structured tool-loop reply with a non-string replyText', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const manager = new McpClientManager({ config: { servers: [] } });
    manager.listAvailableTools = () => [{
      namespacedName: 'fixture__read',
      serverName: 'fixture',
      rawToolName: 'read',
      description: 'Read fixture',
      inputSchema: { type: 'object' },
      risk: 'readOnly',
      requiresHumanApproval: false
    }];
    const agent = new ModeratorAgent({
      generateContent: async () => ({ text: JSON.stringify({ action: 'reply', replyText: { unexpected: 'value' } }) })
    }, memory, { router: complexRouter, mcpClientManager: manager });
    const result = await agent.processInboundMessage({
      id: 'invalid-tool-reply',
      chatId: 'customer@s.whatsapp.net',
      sender: 'customer@s.whatsapp.net',
      text: 'Can you explain the service?',
      timestamp: 1,
      isFromMe: false,
      type: 'text'
    });
    expect(result.decision.intent).toBe('error_fallback');
    expect(result.decision.replyText).toBeUndefined();
    expect(result.shouldSendImmediately).toBe(false);
  });
});
