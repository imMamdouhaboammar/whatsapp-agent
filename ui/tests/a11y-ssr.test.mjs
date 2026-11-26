import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Regressions for findings from an axe-core run (WCAG 2.1 A/AA) against the built cockpit in Chrome.
const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root: uiRoot, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
after(async () => { await vite.close(); });

const { LocaleProvider } = await vite.ssrLoadModule('/src/i18n.tsx');
const { App } = await vite.ssrLoadModule('/src/App.tsx');
const { OwnerAccessLogin } = await vite.ssrLoadModule('/src/components/OwnerAccessGate.tsx');
const { PairingModal } = await vite.ssrLoadModule('/src/components/PairingModal.tsx');
const { SimulatorModal } = await vite.ssrLoadModule('/src/components/SimulatorModal.tsx');
const { StickerStudioModal } = await vite.ssrLoadModule('/src/components/StickerStudioModal.tsx');
const { ModeratorDrawer } = await vite.ssrLoadModule('/src/components/ModeratorDrawer.tsx');
const { PersonaSettingsPage } = await vite.ssrLoadModule('/src/components/PersonaSettingsPage.tsx');

const render = (language, component) =>
  renderToStaticMarkup(React.createElement(LocaleProvider, { initial: language }, component));
// Test-only text extraction from our own SSR markup. Strip tags until stable so no
// partial tag such as "<scr<b>ipt" can survive a single pass.
const text = (html) => {
  let out = html.replace(/<svg[\s\S]*?<\/svg>/g, '');
  let previous;
  do {
    previous = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== previous);
  return out.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
};

function buttonByClass(html, cls) {
  const match = html.match(new RegExp(`<button[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</button>`));
  assert.ok(match, `button .${cls} not rendered`);
  return { open: match[0].slice(0, match[0].indexOf('>') + 1), visible: text(match[1]) };
}

await test('buttons with visible text keep that text in their accessible name (WCAG 2.5.3)', () => {
  for (const language of ['ar', 'en']) {
    const login = render(language, React.createElement(OwnerAccessLogin, { onLogin: async () => {}, onRetry: () => {} }));
    const lang = buttonByClass(login, 'wa-owner-language');
    const langLabel = lang.open.match(/aria-label="([^"]*)"/)?.[1] ?? lang.visible;
    assert.ok(langLabel.includes(lang.visible), `${language}: "${langLabel}" must contain "${lang.visible}"`);

    const app = render(language, React.createElement(App));
    const trigger = buttonByClass(app, 'wa-header-agent-trigger');
    const triggerLabel = trigger.open.match(/aria-label="([^"]*)"/)?.[1] ?? trigger.visible;
    const visibleWords = trigger.visible.replace(/\d+/g, '').trim();
    assert.ok(triggerLabel.includes(visibleWords), `${language}: "${triggerLabel}" must contain "${visibleWords}"`);
  }
});

await test('decorative model icons are hidden from assistive technology', () => {
  const moderator = render('en', React.createElement(ModeratorDrawer, {
    view: 'assistant',
    drafts: [],
    persona: {
      name: 'Mamdouh', language: 'ar-EG', tone: 'Natural', systemPrompt: 'Help',
      rules: [], model: 'gemini-3.8-flash', temperature: 0.5, minConfidence: 0.8
    },
    onSelectChat: () => {},
    onApproveDraft: async () => {},
    onRejectDraft: async () => {}
  }));

  const previousWindow = globalThis.window;
  globalThis.window = { location: { pathname: '/settings/models' } };
  let settings;
  try {
    settings = render('en', React.createElement(PersonaSettingsPage, {
      initialPersona: {
        name: 'Mamdouh', language: 'ar-EG', tone: 'Natural', systemPrompt: 'Help',
        rules: [], model: 'gemini-3.8-flash', minConfidence: 0.8,
        simulateTypingDelay: false, minTypingDelayMs: 200, maxTypingDelayMs: 600
      },
      onClose: () => {},
      onSave: async () => {}
    }));
  } finally {
    globalThis.window = previousWindow;
  }

  for (const [name, html] of [['ModeratorDrawer', moderator], ['PersonaSettingsPage', settings]]) {
    assert.match(
      html,
      /<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?(?:role="img"|<svg|<img)[\s\S]*?<\/span>/,
      `${name}: decorative model icon must be enclosed in aria-hidden="true"`
    );
  }

  const unhidden = (moderator + settings).replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/gi, '');
  const unlabelled = (unhidden.match(/<[^>]+role="img"[^>]*>/g) || []).filter(
    (tag) => !/aria-label=/i.test(tag) && !/aria-labelledby=/i.test(tag) && !/title=/i.test(tag)
  );
  assert.equal(unlabelled.length, 0, `unlabelled role="img" found outside aria-hidden: ${unlabelled.join(', ')}`);
});

await test('dialog headings are not page-level banner landmarks', () => {
  const pairing = render('en', React.createElement(PairingModal, {
    status: { state: 'disconnected', pendingDraftsCount: 0, updatedAt: 0 }, isOpen: true, onClose() {}, onConnect: async () => {}, onDisconnect: async () => {}
  }));
  const sim = render('en', React.createElement(SimulatorModal, { isOpen: true, onClose() {}, onSimulate: async () => ({}) }));
  const sticker = render('en', React.createElement(StickerStudioModal, { isOpen: true, onClose() {}, onSendSticker: async () => {} }));
  assert.doesNotMatch(pairing, /<header/);
  assert.doesNotMatch(sim, /<header/);
  assert.doesNotMatch(sticker, /<header/);
});

function parseCSS(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map();
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match;
  while ((match = ruleRegex.exec(clean)) !== null) {
    const rawSelector = match[1];
    const lastSemi = rawSelector.lastIndexOf(';');
    const selector = (lastSemi !== -1 ? rawSelector.slice(lastSemi + 1) : rawSelector).trim();
    const body = match[2];
    const decls = new Map();
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop && val) decls.set(prop, val);
    }
    rules.set(selector, decls);
  }
  return {
    getPropertyValue(selector, prop) {
      return rules.get(selector)?.get(prop);
    }
  };
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

await test('message timestamps meet AA contrast on the outgoing bubble', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const stylesheet = parseCSS(css);
  const outgoing = stylesheet.getPropertyValue(':root', '--wa-outgoing');
  const meta = stylesheet.getPropertyValue('.wa-message-meta', 'color');
  assert.ok(outgoing, 'missing --wa-outgoing declaration in :root');
  assert.ok(meta, 'missing color declaration in .wa-message-meta');
  assert.ok(contrast(meta, outgoing) >= 4.5, `${meta} on ${outgoing} is ${contrast(meta, outgoing).toFixed(2)}:1`);
});
