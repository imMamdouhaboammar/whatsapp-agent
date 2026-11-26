#!/usr/bin/env bun
/**
 * S05 offline replay. Uses recorded responses only and never instantiates
 * a production model, network transport, WhatsApp socket or application DB.
 *
 * Usage:
 *   bun run src/evaluation-lab/cli.ts --candidate fixtures/reply-evaluation/candidate-v2.json
 *   bun run src/evaluation-lab/cli.ts --candidate fixtures/reply-evaluation/candidate-demo.json --review review.json
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runEvaluationLab, writeReportExclusive } from './runner';

const repoRoot = resolve(import.meta.dir, '../..');
const defaults = {
  suite: join(repoRoot, 'fixtures/reply-evaluation/cases-v1.json'),
  approved: join(repoRoot, 'fixtures/reply-evaluation/synthetic-reference-v1.json')
};

function parseArgs(argv: string[]) {
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !['--suite', '--approved', '--candidate', '--review', '--out', '--timeout-ms'].includes(key) ||
        !value || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${key || '(empty)'}`);
    }
    if (opts.has(key)) throw new Error(`Duplicate argument: ${key}`);
    opts.set(key, value);
  }
  if (!opts.has('--candidate')) throw new Error('Required: --candidate <recorded-snapshot.json>');
  return opts;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}
function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidatePath = options.get('--candidate');
  if (!candidatePath) throw new Error('Required: --candidate <recorded-snapshot.json>');
  const suite = await readJson(options.get('--suite') || defaults.suite);
  const approved = await readJson(options.get('--approved') || defaults.approved);
  const candidate = await readJson(candidatePath);
  const reviewPath = options.get('--review');
  const review = reviewPath ? await readJson(reviewPath) : undefined;
  const timeoutMs = options.has('--timeout-ms')
    ? Number(options.get('--timeout-ms')) : undefined;

  const report = await runEvaluationLab({ suite, approved, candidate, review, timeoutMs });
  const defaultOutput = join(repoRoot, 'reports/reply-evaluation',
    `${safeName(report.candidate_id)}-${randomUUID()}.json`);
  const output = resolve(options.get('--out') || defaultOutput);
  await writeReportExclusive(output, report);
  console.log(JSON.stringify({
    status: report.status,
    candidate: report.candidate_id,
    baseline: report.approved_id,
    case_count: report.results.length,
    passed: report.results.filter(x => x.outcome === 'pass').length,
    blocked: report.blocking_case_ids.length,
    inconclusive: report.inconclusive_case_ids.length,
    pending_human_review: report.unreviewed_critical_case_ids.length,
    pending_baseline_review: report.baseline_review_required,
    report: output
  }));
  process.exitCode = report.status === 'promotable' ? 0 : 2;
}

try {
  await main();
} catch (error) {
  console.error(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
