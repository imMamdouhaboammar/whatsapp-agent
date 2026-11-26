import { describe, expect, it } from 'bun:test';
import { normalizeDigits, routeTurnModel } from '../src/ai/model-router';

const ok = { model: 'jev-latest', answers: {
  route: { type: 'choice', choice: 'standard', confidence: 0.96, probabilities: { trivial: 0.01, standard: 0.96, complex: 0.03 } },
  action_risk: { type: 'choice', choice: 'routine', confidence: 0.96, probabilities: { routine: 0.96, consequential: 0.04 } } } };

async function outgoingState(message: string): Promise<string> {
  let state: unknown;
  await routeTurnModel({
    message, apiKey: ['synthetic', 'test', 'key'].join('-'), enabled: true, externalRoutingAllowed: true,
    baseUrl: 'https://router.example.test',
    fetchFn: Object.assign(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON routing body');
        const body: unknown = JSON.parse(init.body);
        if (typeof body !== 'object' || body === null || !('state' in body)) {
          throw new Error('Expected state in the routing body');
        }
        state = body.state;
        return Response.json(ok);
      },
      { preconnect: () => { throw new Error('Unexpected router preconnect'); } }
    )
  });
  if (typeof state !== 'string') throw new Error('Expected the router to send a string state');
  return state;
}

describe('router phone scrub with Arabic digits', () => {
  it('normalizes Arabic-Indic and Extended Arabic-Indic digits', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normalizeDigits('abc 12')).toBe('abc 12');
  });

  it('redacts an Arabic-Indic phone number', async () => {
    const state = await outgoingState('كلمني على ٠١٠١٢٣٤٥٦٧٨ ضروري');
    expect(state).toContain('[REDACTED_PHONE]');
    expect(state).not.toMatch(/[٠-٩]{6}/);
  });

  it('redacts an Extended Arabic-Indic phone number with a country code', async () => {
    const state = await outgoingState('call +۲۰ ۱۰۱ ۲۳۴ ۵۶۷۸');
    expect(state).toContain('[REDACTED_PHONE]');
  });

  it('redacts mixed-script digits and leaves short numbers alone', async () => {
    const state = await outgoingState('رقمي 01٠12٣4567٨ والكمية ٥');
    expect(state).toContain('[REDACTED_PHONE]');
    expect(state).toContain('5');
    expect(state).not.toContain('[REDACTED_PHONE] [REDACTED_PHONE]');
  });

  it('redacts a labeled OTP written in Arabic-Indic digits', async () => {
    const state = await outgoingState('كود التحقق OTP: ١٢٣٤٥٦ لا تشاركه');
    expect(state).not.toMatch(/[١٢٣٤٥٦]{4}/);
    expect(state).not.toContain('123456');
  });
});
