import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  root: uiRoot,
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});

after(async () => {
  await vite.close();
});

const { LocaleProvider } = await vite.ssrLoadModule('/src/i18n.tsx');
const { App } = await vite.ssrLoadModule('/src/App.tsx');
const { LandingPage } = await vite.ssrLoadModule('/src/marketing/landing/LandingPage.tsx');
const { CLINICS_VERTICAL } = await vite.ssrLoadModule('/src/marketing/landing/data/verticals/clinics.ts');
const { InteractiveLeadFunnel } = await vite.ssrLoadModule('/src/marketing/lead-funnel/InteractiveLeadFunnel.tsx');
const { OwnerAccessGate } = await vite.ssrLoadModule('/src/components/OwnerAccessGate.tsx');

const renderWithLocale = (language, component) =>
  renderToStaticMarkup(React.createElement(LocaleProvider, { initial: language }, component));

await test('LandingPage renders without crashing during SSR across eg, gcc, and en locales with matching dir', () => {
  // 1. Egyptian Arabic (eg)
  const egHtml = renderToStaticMarkup(
    React.createElement(LandingPage, {
      vertical: CLINICS_VERTICAL,
      initialLocale: 'eg',
      salesWhatsappNumber: '201012345678',
    }),
  );
  assert.ok(egHtml.includes('dir="rtl"'), 'eg locale must have dir="rtl"');
  assert.ok(egHtml.includes('lang="ar-EG"'), 'eg locale must have lang="ar-EG"');
  assert.ok(egHtml.includes('وكيل واتساب ذكي لعيادتك'), 'eg locale must render Egyptian headline');
  assert.ok(/<progress\b[^>]*aria-label="Funnel progress"/.test(egHtml), 'must include embedded assessment progressbar');

  // 2. GCC Arabic (gcc)
  const gccHtml = renderToStaticMarkup(
    React.createElement(LandingPage, {
      vertical: CLINICS_VERTICAL,
      initialLocale: 'gcc',
      salesWhatsappNumber: '966501234567',
    }),
  );
  assert.ok(gccHtml.includes('dir="rtl"'), 'gcc locale must have dir="rtl"');
  assert.ok(gccHtml.includes('lang="ar-SA"'), 'gcc locale must have lang="ar-SA"');
  assert.ok(gccHtml.includes('المراجعين'), 'gcc locale must render GCC headline mentioning patients/visitors');

  // 3. English (en)
  const enHtml = renderToStaticMarkup(
    React.createElement(LandingPage, {
      vertical: CLINICS_VERTICAL,
      initialLocale: 'en',
      salesWhatsappNumber: '201012345678',
    }),
  );
  assert.ok(enHtml.includes('dir="ltr"'), 'en locale must have dir="ltr"');
  assert.ok(enHtml.includes('lang="en"'), 'en locale must have lang="en"');
  assert.ok(enHtml.includes('Put Your Clinic’s WhatsApp on Instant Response'), 'en locale must render English headline');
});

await test('InteractiveLeadFunnel renders cleanly in SSR with progressbar accessibility attributes', () => {
  // Default cold traffic (starts at q01_industry)
  const coldHtml = renderToStaticMarkup(
    React.createElement(InteractiveLeadFunnel, {
      salesWhatsappNumber: '201012345678',
      freeDownloadUrl: 'https://github.com/imMamdouhaboammar/whatsapp-agent',
    }),
  );
  assert.ok(/<progress\b[^>]*aria-label="Funnel progress"/.test(coldHtml), 'must expose a native, labelled progressbar');
  const progress = coldHtml.match(/<progress\b[^>]*>/)?.[0];
  assert.ok(progress, 'must render native progress element');
  const value = progress.match(/\bvalue="(\d+(?:\.\d+)?)"/)?.[1];
  assert.ok(value !== undefined && Number(value) >= 0 && Number(value) <= 100, 'must expose a bounded progress value');
  assert.match(progress, /\bmax="100"/, 'native progress max is 100 and minimum is implicitly 0');
  assert.ok(coldHtml.includes('ميديكال وعيادات ومراكز طبية'), 'cold funnel must render industry options');

  // Pre-seeded vertical assessment (initialIndustry="medical", starts at q02_ops_mode)
  const preseededHtml = renderToStaticMarkup(
    React.createElement(InteractiveLeadFunnel, {
      initialIndustry: 'medical',
      salesWhatsappNumber: '201012345678',
      freeDownloadUrl: 'https://github.com/imMamdouhaboammar/whatsapp-agent',
    }),
  );
  assert.ok(/<progress\b[^>]*aria-label="Funnel progress"/.test(preseededHtml));
  assert.ok(preseededHtml.includes('عندي فريق موديريشن أو سيلز بيرد'), 'must start at ops_mode question');
  // canGoBack is false when pre-seeded
  assert.ok(!preseededHtml.includes('الرجوع للسؤال السابق'), 'canGoBack button must not be visible on step 1');
});

await test('public routes (/start and /lp/clinics) render without requiring OwnerAccessGate authentication', () => {
  // Test /start route
  const startHtml = renderWithLocale('ar', React.createElement(App, { initialPath: '/start' }));
  assert.ok(startHtml.includes('تقييم تفاعلي فوري'), 'must render standalone funnel header');
  assert.ok(/<progress\b[^>]*aria-label="Funnel progress"/.test(startHtml), 'must render funnel progressbar');
  assert.ok(!startHtml.includes('wa-owner-access-screen'), 'must NOT render owner access screen on /start');
  assert.ok(!startHtml.includes('wa-owner-token'), 'must NOT render password input on /start');

  // Test /lp/clinics route
  const lpHtml = renderWithLocale('ar', React.createElement(App, { initialPath: '/lp/clinics' }));
  assert.ok(lpHtml.includes('وكيل واتساب ذكي لعيادتك'), 'must render clinics landing page headline');
  assert.ok(lpHtml.includes('assessment-funnel'), 'must include assessment section');
  assert.ok(!lpHtml.includes('wa-owner-access-screen'), 'must NOT render owner access screen on /lp/clinics');
  assert.ok(!lpHtml.includes('wa-owner-token'), 'must NOT render password input on /lp/clinics');

  // Test OwnerAccessGate wrapping public route
  const gateWrappedStart = renderToStaticMarkup(
    React.createElement(
      LocaleProvider,
      { initial: 'ar' },
      React.createElement(OwnerAccessGate, null, React.createElement(App, { initialPath: '/start' })),
    ),
  );
  assert.ok(/<progress\b[^>]*aria-label="Funnel progress"/.test(gateWrappedStart), 'must render public funnel through gate');
  assert.ok(!gateWrappedStart.includes('wa-owner-access-screen'), 'gate must bypass on public route');
});
