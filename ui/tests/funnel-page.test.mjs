import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { LocaleProvider } = await vite.ssrLoadModule('/src/i18n.tsx');
const { FunnelPage } = await vite.ssrLoadModule('/src/components/FunnelPage.tsx');
const { api } = await vite.ssrLoadModule('/src/api/client.ts');
const { parseFunnelRequest } = await vite.ssrLoadModule('/src/components/funnel-request.ts');

await test('dispatch workspace has labelled request, response and protected credentials', () => {
  for (const language of ['ar', 'en']) {
    const html = renderToStaticMarkup(React.createElement(LocaleProvider, { initial: language }, React.createElement(FunnelPage, { onClose() {} })));
    assert.match(html, /aria-labelledby="funnel-request-title"/);
    assert.match(html, /aria-labelledby="funnel-receipt-title"/);
    assert.match(html, /type="password"/);
    assert.match(html, /aria-labelledby="funnel-health-title"/);
    assert.match(html, /dir="ltr"[^>]*id="funnel-payload"|id="funnel-payload"[^>]*dir="ltr"/);
  }
});

await test('client sends the explicit key only in the header of authorized funnel mutations', async () => {
  const original = globalThis.fetch;
  const requests = [];
  const receipt = { traceId: 'test-trace', method: 'LOOKUP', mode: 'ALL_SETTLED', startedAt: '2026-01-01T00:00:00Z', totalDurationMs: 2, success: true, successfulCount: 1, failedCount: 0, results: [{ targetId: 'a', targetName: 'A', url: 'https://example.test', statusCode: 200, durationMs: 2, success: true }] };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return Response.json(url.endsWith('/reset') ? { success: true, targetId: 'a' } : receipt);
  };
  try {
    const key = ['fixture', 'key'].join('-');
    await api.dispatchFunnel({ method: 'LOOKUP', payload: { sku: 'A' } }, key);
    await api.resetCircuitBreaker('a', key);
    for (const { init } of requests) {
      assert.equal(new Headers(init.headers).get('x-api-key'), key);
      assert.ok(!init.body.includes(key));
    }
  } finally { globalThis.fetch = original; }
});

await test('JSON request rejects invalid values and never rewrites malformed input as a raw body', () => {
  for (const invalid of ['{', 'null', '[]', '"hello"', '42']) {
    assert.throws(() => parseFunnelRequest(invalid, ''));
  }
  assert.throws(() => parseFunnelRequest('{}', '{"limit":2}'));
  assert.deepEqual(parseFunnelRequest(' ', ''), { payload: undefined, queryParams: undefined });
  assert.deepEqual(parseFunnelRequest('{"sku":"A"}', '{"limit":"2"}'), { payload: { sku: 'A' }, queryParams: { limit: '2' } });
});
