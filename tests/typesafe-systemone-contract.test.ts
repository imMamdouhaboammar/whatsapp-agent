import { describe, expect, it } from 'bun:test';
import { parseJevResponse, routeTurnModel } from '../src/ai/model-router';

const officialChoice = (choice: string, confidence: unknown = 0.96) => ({
  model: 'jev-latest',
  answers: {
    route: {
      type: 'choice',
      choice,
      confidence,
      probabilities: { trivial: 0.01, standard: 0.03, complex: 0.96 }
    },
    action_risk: {
      type: 'choice',
      choice: 'routine',
      confidence: 0.96,
      probabilities: { routine: 0.96, consequential: 0.04 }
    }
  },
  usage: { input_tokens: 12, output_tokens: 5 }
});

describe('TypeSafe System One OpenAPI contract', () => {
  it('routes documented complex choice with 0.96 confidence without inventing standard 1.0', () => {
    const decision = parseJevResponse(officialChoice('complex', 0.96), 17, 0.75);
    expect(decision.tier).toBe('complex');
    expect(decision.selectedModel).toBe('gemini-4-argon');
    expect(decision.confidence).toBe(0.96);
  });

  it.each(['trivial', 'standard', 'complex'] as const)('accepts documented %s choice', tier => {
    expect(parseJevResponse(officialChoice(tier, 0.96), 4, 0.75).tier).toBe(tier);
  });

  it.each([
    ['no answers', { model: 'jev-latest' }],
    ['wrong type', { model: 'jev-latest', answers: { route: { type: 'noul', noul: 0.9 } } }],
    ['unknown choice', officialChoice('unknown')],
    ['missing confidence', { model: 'jev-latest', answers: { route: { type: 'choice', choice: 'complex', probabilities: { complex: 1 } } } }],
    ['null confidence', officialChoice('complex', null)],
    ['string confidence', officialChoice('complex', '0.96')],
    ['negative confidence', officialChoice('complex', -0.1)],
    ['high confidence', officialChoice('complex', 1.1)],
    ['missing probabilities', { model: 'jev-latest', answers: { route: { type: 'choice', choice: 'complex', confidence: 0.96 } } }]
  ])('rejects %s rather than manufacturing confidence', (_name, response) => {
    expect(() => parseJevResponse(response, 3, 0.75)).toThrow();
  });

  it('posts official state/questions schema to /v1/systemone with no conversation history', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    const decision = await routeTurnModel({
      message: 'ما سعر الاشتراك؟',
      threadContext: ['بيانات عميل سابقة 01011112222'],
      apiKey: 'synthetic-test-key',
      externalRoutingAllowed: true,
      fetchFn: (async (target: string | URL | Request, init?: RequestInit) => {
        url = String(target);
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(officialChoice('complex')), { status: 200 });
      }) as typeof fetch
    });
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(body.model).toBe('jev-latest');
    expect(body.state).toBe('ما سعر الاشتراك؟');
    expect((body.questions as Record<string, { type: string }>).route.type).toBe('choice');
    expect(JSON.stringify(body)).not.toContain('01011112222');
    expect(body).not.toHaveProperty('input');
    expect(body).not.toHaveProperty('candidates');
    expect(decision.tier).toBe('complex');
  });

  it('routes a short, consequential refund instruction to stronger reasoning', () => {
    const response = officialChoice('standard', 0.97);
    response.answers.action_risk = {
      type: 'choice',
      choice: 'consequential',
      confidence: 0.95,
      probabilities: { routine: 0.05, consequential: 0.95 }
    };
    const decision = parseJevResponse(response, 2, 0.75);
    expect(decision.tier).toBe('complex');
    expect(decision.selectedModel).toBe('gemini-4-argon');
    expect(decision.confidence).toBe(0.95);
  });

  it('fails open when the API response is incomplete or configuration is invalid', async () => {
    const malformed = await routeTurnModel({
      message: 'مرحبا', apiKey: 'synthetic-test-key', externalRoutingAllowed: true,
      fetchFn: (async () => new Response(JSON.stringify({ label: 'complex', confidence: 1 }))) as typeof fetch
    });
    expect(malformed.bypassed).toBe(true);
    expect(malformed.confidence).toBe(0);

    let called = false;
    const invalid = await routeTurnModel({
      message: 'مرحبا', apiKey: 'synthetic-test-key', externalRoutingAllowed: true,
      confidenceThreshold: Number.NaN,
      fetchFn: (async () => { called = true; throw Error('unexpected'); }) as typeof fetch
    });
    expect(called).toBe(false);
    expect(invalid.bypassed).toBe(true);
  });

  it.each([401, 403, 429, 503])('fails open on optional router HTTP %s without exposing content', async status => {
    const decision = await routeTurnModel({
      message: 'رقم طلب خاص', apiKey: 'synthetic-test-key', externalRoutingAllowed: true,
      fetchFn: (async () => new Response('untrusted gateway error', { status })) as typeof fetch
    });
    expect(decision.bypassed).toBe(true);
    expect(decision.selectedModel).toBe('gemini-3.8-flash');
    expect(decision.confidence).toBe(0);
  });


  it('does not transmit email, phone, URL, history, or sender identity in state', async () => {
    let outgoing: Record<string, unknown> = {};
    await routeTurnModel({
      message: 'اتصل على 01012345678 أو test@example.com وشوف https://example.com/client/24',
      threadContext: ['Previous private thread'],
      senderName: 'Private Customer',
      apiKey: 'synthetic-test-key',
      externalRoutingAllowed: true,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        outgoing = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(officialChoice('standard')), { status: 200 });
      }) as typeof fetch
    });
    expect(outgoing.state).toContain('[REDACTED_PHONE]');
    expect(outgoing.state).toContain('[REDACTED_EMAIL]');
    expect(outgoing.state).toContain('[REDACTED_URL]');
    expect(JSON.stringify(outgoing)).not.toContain('Previous private thread');
    expect(JSON.stringify(outgoing)).not.toContain('Private Customer');
  });

  it('rejects incomplete or malformed consequential-action answers', () => {
    const missing = officialChoice('standard');
    delete (missing.answers as Record<string, unknown>).action_risk;
    expect(() => parseJevResponse(missing, 1, 0.75)).toThrow();
    const bad = officialChoice('standard');
    bad.answers.action_risk.confidence = 1.2;
    expect(() => parseJevResponse(bad, 1, 0.75)).toThrow();
  });

  it('rejects invalid timeout configuration without contacting TypeSafe', async () => {
    let called = false;
    const decision = await routeTurnModel({
      message: 'hello', apiKey: 'synthetic-test-key', externalRoutingAllowed: true,
      timeoutMs: -1,
      fetchFn: (async () => { called = true; throw Error('unexpected'); }) as typeof fetch
    });
    expect(called).toBe(false);
    expect(decision.bypassed).toBe(true);
  });

  it('refuses plaintext HTTP endpoints before sending credentials or message content', async () => {
    let requested = false;
    const decision = await routeTurnModel({
      message: 'Synthetic customer question',
      apiKey: 'synthetic-test-key',
      externalRoutingAllowed: true,
      baseUrl: 'http://api.typesafe.ai/v1',
      fetchFn: (async () => { requested = true; throw Error('must not fetch'); }) as typeof fetch
    });
    expect(requested).toBe(false);
    expect(decision.bypassed).toBe(true);
  });

  it('does not send conversation content without explicit external sharing permission', async () => {
    let called = false;
    const decision = await routeTurnModel({
      message: 'my private customer data',
      apiKey: 'synthetic-test-key',
      externalRoutingAllowed: false,
      fetchFn: (async () => { called = true; throw Error('must not call'); }) as typeof fetch
    });
    expect(called).toBe(false);
    expect(decision.bypassed).toBe(true);
  });
});
