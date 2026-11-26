/**
 * Patches @whiskeysockets/baileys connection payload fields for WhatsApp protocol compatibility.
 * 1. passive: true -> false (causes device_removed and "تعذر تسجيل الدخول" on mobile)
 * 2. remove lidDbMigrated (unrecognized field rejected by WhatsApp)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
// WA-013/WA-014: BAILEYS_ROOT lets tests point the patcher at an isolated fixture tree;
// production postinstall behavior (repo-local node_modules) is unchanged.
const installRoot = process.env.BAILEYS_ROOT || currentDir;
const baileysPkgDir = join(installRoot, 'node_modules', '@whiskeysockets', 'baileys');
const baileys = join(baileysPkgDir, 'lib');

// The patch payload targets a specific Baileys protocol surface (package.json pins
// ^7.0.0-rc14). A silent patch against a different major version can produce a
// half-patched client, so fail loudly and force a deliberate re-pin instead.
const PINNED_FAMILY = /^7\./;
let baileysVersion = null;
try {
  baileysVersion = JSON.parse(readFileSync(join(baileysPkgDir, 'package.json'), 'utf8')).version;
} catch {
  // Synthetic fixtures may omit package.json; production installs always have it.
  console.warn('[Fable Agent] Baileys package.json not found; skipping version family check.');
}
if (baileysVersion && !PINNED_FAMILY.test(baileysVersion)) {
  console.error(
    `[Fable Agent] Unsupported @whiskeysockets/baileys version ${baileysVersion}: ` +
    'this patch is pinned to the 7.x family (see package.json). Review the protocol ' +
    'changes and re-pin before upgrading.'
  );
  process.exit(1);
}

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
