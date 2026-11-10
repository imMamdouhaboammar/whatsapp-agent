import { describe, expect, it } from 'bun:test';
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

import type { GeminiClient } from '../src/ai/gemini-client';

describe('Jev Model Router Layer', () => {
  it('routes high-confidence trivial Arabic greetings to gemini-3.8-flash', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          label: 'trivial',
          confidence: 0.96,
          reason: 'Simple Arabic greeting without complex inquiries'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const decision = await routeTurnModel({
      message: 'السلام عليكم ورحمة الله وبركاته، صباح الخير',
      apiKey: 'test-typesafe-key',
      fetchFn: mockFetch
    });

    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.tier).toBe('trivial');
    expect(decision.confidence).toBe(0.96);
    expect(decision.bypassed).toBe(false);
    expect(capturedBody.input).toBe('السلام عليكم ورحمة الله وبركاته، صباح الخير');
  });

  it('routes high-confidence standard product/pricing queries to gemini-3.8-flash', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          tier: 'standard',
          confidence: 0.89,
          reasoning: 'Standard course pricing inquiry'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const decision = await routeTurnModel({
      message: 'بكام كورس الذكاء الاصطناعي ومواعيده إمتى؟',
      apiKey: 'test-typesafe-key',
      fetchFn: mockFetch
    });

    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.tier).toBe('standard');
    expect(decision.confidence).toBe(0.89);
    expect(decision.bypassed).toBe(false);
  });

  it('routes high-confidence complex/angry complaints to gemini-4-argon', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          label: 'complex',
          confidence: 0.94,
          reason: 'Escalated customer refund dispute requiring nuanced reasoning'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const decision = await routeTurnModel({
      message: 'الخدمة سيئة جداً ومحدش بيرد عليا وعايز أسترجع فلوسي فوراً وإلا هشتكي في حماية المستهلك!',
      threadContext: ['تم الدفع أمس برقم إيصال 4882'],
      apiKey: 'test-typesafe-key',
      fetchFn: mockFetch
    });

    expect(decision.selectedModel).toBe('gemini-4-argon');
    expect(decision.tier).toBe('complex');
    expect(decision.confidence).toBe(0.94);
    expect(decision.bypassed).toBe(false);
    expect(capturedBody.context).toEqual(['تم الدفع أمس برقم إيصال 4882']);
  });

  it('overrides decision to gemini-3.8-flash when confidence is below threshold (< 0.75)', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          label: 'complex',
          confidence: 0.62,
          reason: 'Ambiguous request with weak signal'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const decision = await routeTurnModel({
      message: 'مش عارف أقرر، محتاج مساعدة عامة',
      apiKey: 'test-typesafe-key',
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
    const mockFetch = (async () => {
      fetchCalled = true;
      return new Response('{}');
    }) as unknown as typeof fetch;

    const decision = await routeTurnModel({
      message: 'صباح الخير',
      apiKey: '',
      enabled: false,
      fetchFn: mockFetch
    });

    expect(fetchCalled).toBe(false);
    expect(decision.selectedModel).toBe(DEFAULT_BYPASS_MODEL);
    expect(decision.tier).toBe('standard');
    expect(decision.confidence).toBe(1.0);
    expect(decision.routerLatencyMs).toBe(0);
    expect(decision.bypassed).toBe(true);
  });

  it('fails open to gemini-3.8-flash when Jev API times out (>800ms) or returns 500 error', async () => {
    // 1. Test timeout fail-open
    const mockTimeoutFetch = (async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof fetch;

    const timeoutDecision = await routeTurnModel({
      message: 'رسالة أثناء انقطاع الشبكة',
      apiKey: 'test-typesafe-key',
      timeoutMs: 50,
      fetchFn: mockTimeoutFetch
    });

    expect(timeoutDecision.selectedModel).toBe('gemini-3.8-flash');
    expect(timeoutDecision.tier).toBe('standard');
    expect(timeoutDecision.bypassed).toBe(true);
    expect(timeoutDecision.reason).toContain('Router exception');

    // 2. Test 500 HTTP server error fail-open
    const mock500Fetch = (async () => {
      return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    }) as unknown as typeof fetch;

    const errorDecision = await routeTurnModel({
      message: 'رسالة أثناء عطل السيرفر',
      apiKey: 'test-typesafe-key',
      fetchFn: mock500Fetch
    });

    expect(errorDecision.selectedModel).toBe('gemini-3.8-flash');
    expect(errorDecision.tier).toBe('standard');
    expect(errorDecision.bypassed).toBe(true);
    expect(errorDecision.reason).toContain('Router HTTP error 500');
  });

  it('scrubs sensitive credentials before dispatching request to Jev', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ label: 'trivial', confidence: 0.99 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    // Dynamically construct dummy secret tokens at runtime
    const dummyKey = ['sk', 'live', 'abcdef1234567890abcdef1234'].join('-');
    const testMessage = `كلمة المرور الخاصة بي هي mySecretPass123 ومفتاحي ${dummyKey}`;

    await routeTurnModel({
      message: testMessage,
      apiKey: 'test-typesafe-key',
      fetchFn: mockFetch
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody.input).not.toContain(dummyKey);
    expect(capturedBody.input).not.toContain('mySecretPass123');
    expect(capturedBody.input).toContain('[REDACTED_CREDENTIAL]');
  });

  it('supports JevModelRouter class instance and default options', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({ label: 'trivial', confidence: 0.92 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const router = new JevModelRouter({
      apiKey: 'test-typesafe-key',
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

describe('ModeratorAgent + Jev Routing Integration', () => {
  it('populates modelRouting and embeds routing trace in reasoning', async () => {
    const memory = new MemoryStore({ dataDir: './data/test-memory-jev' });
    let modelCalledWith: string | null = null;

    const mockGemini = {
      generateContent: async (_contents: unknown, options?: { model?: string }) => {
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
      }
    } as unknown as GeminiClient;

    // Custom router simulating complex tier -> routes to gemini-4-argon
    const mockRouter = async (): Promise<RoutingDecision> => ({
      selectedModel: 'gemini-4-argon',
      tier: 'complex',
      confidence: 0.93,
      routerLatencyMs: 38,
      reason: 'Complex inquiry requiring reasoning',
      bypassed: false
    });

    const agent = new ModeratorAgent(mockGemini, memory, { router: mockRouter });
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
    expect(modelCalledWith).toBe('gemini-4-argon');

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
