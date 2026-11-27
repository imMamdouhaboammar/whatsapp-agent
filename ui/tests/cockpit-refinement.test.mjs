import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { LocaleProvider } = await vite.ssrLoadModule('/src/i18n.tsx');
const { PairingModal } = await vite.ssrLoadModule('/src/components/PairingModal.tsx');
const { StickerStudioModal } = await vite.ssrLoadModule('/src/components/StickerStudioModal.tsx');
const { BroadcastPage } = await vite.ssrLoadModule('/src/components/BroadcastPage.tsx');
const { App } = await vite.ssrLoadModule('/src/App.tsx');
const render = (language, C, props) => renderToStaticMarkup(React.createElement(LocaleProvider, { initial: language }, React.createElement(C, props)));
const noop = () => {};
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

await test('install metadata links an app manifest with real purpose-specific icons', () => {
  const html = read('../index.html');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  const manifest = JSON.parse(read('../public/manifest.webmanifest'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const icon = manifest.icons.find(i => i.sizes === size && i.purpose === purpose);
    assert.ok(icon, size + ' ' + purpose);
    const path = new URL('../public' + icon.src, import.meta.url);
    assert.ok(existsSync(path));
    const png = readFileSync(path);
    assert.equal(png.readUInt32BE(16), Number(size.split('x')[0]));
    assert.equal(png.readUInt32BE(20), Number(size.split('x')[1]));
  }
});

await test('pairing and sticker tools have labelled native modal shells in both locales', () => {
  for (const language of ['ar', 'en']) {
    const pairing = render(language, PairingModal, { isOpen: true, status: { state: 'disconnected' }, onClose: noop, onConnect: noop, onDisconnect: noop });
    const sticker = render(language, StickerStudioModal, { isOpen: true, onClose: noop });
    for (const html of [pairing, sticker]) {
      assert.match(html, /<dialog[^>]*aria-modal="true"[^>]*aria-labelledby=/);
      assert.match(html, /class="wa-tool-body"/);
      assert.match(html, /class="wa-tool-footer"/);
    }
    assert.match(sticker, /accept="image\/png,image\/jpeg,image\/webp"/);
  }
});

await test('cockpit no longer offers assistant preview', () => {
  for (const language of ['ar', 'en']) {
    const html = render(language, App);
    assert.doesNotMatch(html, /Test the assistant|اختبار رد المساعد/);
  }
});

await test('broadcast page uses a responsive workspace with named composer and campaign history', () => {
  for (const language of ['ar', 'en']) {
    const html = render(language, BroadcastPage, { onClose: noop });
    assert.match(html, /wa-broadcast-layout/);
    assert.match(html, /aria-labelledby="broadcast-compose-title"/);
    assert.match(html, /aria-labelledby="broadcast-history-title"/);
  }
});

await test('settings no longer call blocking JS confirm dialogs', () => {
  assert.doesNotMatch(read('../src/components/PersonaSettingsPage.tsx'), /window\.(confirm|prompt|alert)\(/);
});
