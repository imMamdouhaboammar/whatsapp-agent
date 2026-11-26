import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

await test('production JavaScript chunks stay within budget and form an acyclic static import graph', { timeout: 30_000 }, async () => {
  const oversized = [];
  const importsByChunk = new Map();
  await build({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'warn',
    build: { write: false },
    plugins: [{
      name: 'assert-production-chunk-budget',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          importsByChunk.set(chunk.fileName, chunk.imports);
          if (Buffer.byteLength(chunk.code) > 500_000) {
            oversized.push(chunk.fileName);
          }
        }
      },
    }],
  });
  assert.deepEqual(oversized, []);

  // Remove chunks once all of their internal static imports have been removed.
  while (importsByChunk.size > 0) {
    const previousSize = importsByChunk.size;
    for (const [fileName, imports] of importsByChunk) {
      if (imports.every((dependency) => !importsByChunk.has(dependency))) {
        importsByChunk.delete(fileName);
      }
    }
    assert.ok(importsByChunk.size < previousSize,
      `Static chunk import cycle among: ${[...importsByChunk.keys()].join(', ')}`);
  }
});
