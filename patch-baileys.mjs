/**
 * Patches @whiskeysockets/baileys connection payload fields for WhatsApp protocol compatibility.
 * 1. passive: true -> false (causes device_removed and "تعذر تسجيل الدخول" on mobile)
 * 2. remove lidDbMigrated (unrecognized field rejected by WhatsApp)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baileys = join(__dirname, 'node_modules', '@whiskeysockets', 'baileys', 'lib');

function normalizeWs(s) {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
}

function patch(file, find, replace, label) {
  const path = join(baileys, file);
  if (!existsSync(path)) {
    console.log(`  skip: ${file} not found`);
    return;
  }
  let src = readFileSync(path, 'utf8');
  if (src.includes(replace)) {
    console.log(`  ok: ${label} (already patched)`);
    return;
  }
  if (!src.includes(find)) {
    const normalizedFind = normalizeWs(find);
    if (!normalizeWs(src).includes(normalizedFind)) {
      console.log(`  warn: ${label} target not found in ${file}`);
      return;
    }
  }
  src = src.replaceAll(find, replace);
  writeFileSync(path, src);
  console.log(`  patched: ${label}`);
}

if (existsSync(baileys)) {
  console.log('[Fable Agent] Patching Baileys connection validator...');
  patch(
    'Utils/validate-connection.js',
    'passive: true,\n        pull: true,',
    'passive: false,\n        pull: true,',
    'passive flag'
  );
  patch(
    'Utils/validate-connection.js',
    'lidDbMigrated: false',
    '/* lidDbMigrated removed */',
    'lidDbMigrated'
  );
  console.log('[Fable Agent] Baileys patch complete.');
}
