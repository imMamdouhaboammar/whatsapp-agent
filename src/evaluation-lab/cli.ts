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
import { runEvaluationLab, writeReportExclusive, type EvaluationSuite,
  type EvaluationSnapshot, type HumanReview } from './runner';

const repoRoot = resolve(import.meta.dir, '../..');
const defaults = {
  suite: join(repoRoot, 'fixtures/reply-evaluation/cases-v1.json'),
  approved: join(repoRoot, 'fixtures/reply-evaluation/synthetic-reference-v1.json')
};

function parseArgs(argv: string[]) {
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !['--suite', '--approved', '--candidate', '--review', '--out', '--timeout-ms'].includes(key) ||
        !argv[i + 1] || argv[i + 1]!.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${key || '(empty)'}`);
    }
    if (opts.has(key)) throw new Error(`Duplicate argument: ${key}`);
    opts.set(key, argv[i + 1]!);
  }
  if (!opts.has('--candidate')) throw new Error('Required: --candidate <recorded-snapshot.json>');
  return opts;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T;
}
function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const suite = await readJson<EvaluationSuite>(options.get('--suite') || defaults.suite);
  const approved = await readJson<EvaluationSnapshot>(options.get('--approved') || defaults.approved);
  const candidate = await readJson<EvaluationSnapshot>(options.get('--candidate')!);
  const review = options.has('--review')
    ? await readJson<HumanReview>(options.get('--review')!) : undefined;
  const timeoutMs = options.has('--timeout-ms')
    ? Number(options.get('--timeout-ms')) : undefined;

  const report = await runEvaluationLab({ suite, approved, candidate, review, timeoutMs });
  const defaultOutput = join(repoRoot, 'reports/reply-evaluation',
    `${safeName(candidate.snapshot_id)}-${randomUUID()}.json`);
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
