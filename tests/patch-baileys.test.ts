import { afterEach, describe, expect, it } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const originalScript = join(import.meta.dir, '..', 'patch-baileys.mjs');
const fixtures: string[] = [];

function runInstallerPatch(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'wa-baileys-patch-'));
  fixtures.push(root);
  const target = join(root, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils', 'validate-connection.js');
  mkdirSync(join(root, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Utils'), { recursive: true });
  writeFileSync(target, source);
  copyFileSync(originalScript, join(root, 'patch-baileys.mjs'));
  const result = Bun.spawnSync({
    cmd: [process.execPath, join(root, 'patch-baileys.mjs')],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  return { result, source: readFileSync(target, 'utf8'), stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Baileys postinstall patch correctness', () => {
  const baseline = 'passive: true,\n        pull: true,\nlidDbMigrated: false\n';
  it('replaces both exact protocol fields and succeeds', () => {
    const { result, source } = runInstallerPatch(baseline);
    expect(result.exitCode).toBe(0);
    expect(source).toContain('passive: false,');
    expect(source).toContain('/* lidDbMigrated removed */');
  });

  it('never claims patch success if whitespace prevents the replacement', () => {
    const { result, source, stdout } = runInstallerPatch('passive: true,\n\tpull: true,\nlidDbMigrated: false\n');
    expect(source).toContain('passive: false,');
    expect(source).not.toContain('passive: true,');
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('patched: passive flag');
  });

  it('fails loudly when a required patch target is missing', () => {
    const { result, stdout } = runInstallerPatch('unrelated source\n');
    expect(result.exitCode).not.toBe(0);
    expect(stdout).not.toContain('patch complete');
  });

  it('does not leave a partial first patch when the second required target is absent', () => {
    const source = 'passive: true,\n        pull: true,\n';
    const result = runInstallerPatch(source);
    expect(result.result.exitCode).not.toBe(0);
    expect(result.source).toBe(source);
    expect(result.stdout).not.toContain('patch complete');
  });

  it('is idempotent for an already patched dependency', () => {
    const { result, source } = runInstallerPatch('passive: false,\n        pull: true,\n/* lidDbMigrated removed */\n');
    expect(result.exitCode).toBe(0);
    expect(source).toContain('passive: false,');
    expect(source).toContain('/* lidDbMigrated removed */');
  });
});
