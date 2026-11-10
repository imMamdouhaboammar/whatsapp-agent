/**
 * Patches @whiskeysockets/baileys connection payload fields for WhatsApp protocol compatibility.
 * 1. passive: true -> false (causes device_removed and "تعذر تسجيل الدخول" on mobile)
 * 2. remove lidDbMigrated (unrecognized field rejected by WhatsApp)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baileys = join(__dirname, 'node_modules', '@whiskeysockets', 'baileys', 'lib');

function patch(src, find, replace, applied, label) {
  const matches = [...src.matchAll(find)];
  if (matches.length === 0) {
    if (applied.test(src)) return { source: src, status: 'ok: ' + label + ' (already patched)' };
    throw new Error(label + ' target not found');
  }
  if (matches.length !== 1) {
    throw new Error(label + ' matched ' + matches.length + ' locations');
  }

  const updated = src.replace(find, replace);
  if (updated === src || find.test(updated) || !applied.test(updated)) {
    throw new Error(label + ' replacement verification failed');
  }
  return { source: updated, status: 'patched: ' + label };
}

try {
  console.log('[Fable Agent] Patching Baileys connection validator...');
  const path = join(baileys, 'Utils/validate-connection.js');
  const original = readFileSync(path, 'utf8');
  const passive = patch(
    original,
    /passive:\s*true,\s*pull:\s*true,/g,
    'passive: false,\n        pull: true,',
    /passive:\s*false,\s*pull:\s*true,/,
    'passive flag'
  );
  const lid = patch(
    passive.source,
    /lidDbMigrated:\s*false/g,
    '/* lidDbMigrated removed */',
    /\/\*\s*lidDbMigrated removed\s*\*\//,
    'lidDbMigrated'
  );
  if (lid.source !== original) writeFileSync(path, lid.source, 'utf8');
  console.log('  ' + passive.status);
  console.log('  ' + lid.status);
  console.log('[Fable Agent] Baileys patch complete.');
} catch (err) {
  console.error('[Fable Agent] Required Baileys patch failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
