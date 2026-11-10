/**
 * Offline reply evaluation. Every model response is a checked-in recording.
 * Importing this module does not import the WhatsApp send adapter or HTTP client.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ModeratorAgent, DEFAULT_MODERATOR_PERSONA } from '../ai/moderator-agent';
import type { GeminiClient } from '../ai/gemini-client';
import { MemoryStore } from '../domain/memory-store';
import { scrubCredentials } from '../domain/learning-memory';
import { evaluatePermission } from '../domain/permission-engine';
import type { AgentMode, AutonomyAction, ChatMessage, PolicyConfig } from '../domain/types';

export type EvaluationLocale = 'ar-EG' | 'ar-SA' | 'en';
export type EvaluationTurn = { sender: 'contact' | 'owner'; text: string };
export type ForbiddenOutcome = 'send' | 'draft';
export interface EvaluationCase {
  case_id: string;
  locale: EvaluationLocale;
  chat_mode: AgentMode;
  inbound_turns: EvaluationTurn[];
  dossier_facts: string[];
  approved_policy_revision: number;
  expected_action: AutonomyAction;
  expected_send: boolean;
  expected_draft: boolean;
  forbidden_outcomes: ForbiddenOutcome[];
  evidence_ids: string[];
  notes_for_reviewer: string;
  critical: boolean;
}
export interface EvaluationSuite {
  version: number;
  suite_id: string;
  cases: EvaluationCase[];
}
export type RecordedModelResponse =
  | { kind: 'decision'; value: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number } }
  | { kind: 'timeout' }
  | { kind: 'error'; code: string };
export interface EvaluationSnapshot {
  snapshot_id: string;
  model_id: string;
  policy: PolicyConfig;
  responses: Record<string, RecordedModelResponse>;
  approval?: { reviewer: string; reviewed_at: string };
}
export interface HumanReview {
  candidate_id: string;
  reviewer: string;
  reviewed_at: string;
  approved_case_ids: string[];
}
export interface EvaluationResult {
  case_id: string;
  locale: EvaluationLocale;
  outcome: 'pass' | 'violation' | 'inconclusive';
  reason: string;
  expected_action: AutonomyAction;
  observed_action?: AutonomyAction;
  should_send?: boolean;
  draft_created?: boolean;
  matched_rule_id?: string | null;
  policy_reason?: string;
  baseline_action?: AutonomyAction;
  baseline_changed: boolean;
  human_review: 'approved' | 'pending' | 'not_required';
  evidence_ids: string[];
  cited_evidence_ids?: string[];
  model_id: string;
  model_usage?: { input_tokens?: number; output_tokens?: number };
  elapsed_ms: number;
}
export interface EvaluationReport {
  suite_id: string;
  suite_version: number;
  approved_id: string;
  candidate_id: string;
  status: 'blocked' | 'inconclusive' | 'review_required' | 'promotable';
  blocking_case_ids: string[];
  inconclusive_case_ids: string[];
  unreviewed_critical_case_ids: string[];
  results: EvaluationResult[];
  baseline_violations: string[];
  baseline_review_required: boolean;
  evaluated_at: string;
}
export interface EvaluationOptions {
  suite: EvaluationSuite;
  approved: EvaluationSnapshot;
  candidate: EvaluationSnapshot;
  review?: HumanReview;
  timeoutMs?: number;
}
type ReplayObservation = Pick<EvaluationResult, 'observed_action' | 'should_send' |
  'draft_created' | 'matched_rule_id' | 'policy_reason' | 'model_usage' | 'elapsed_ms' |
  'cited_evidence_ids'> & {
    infrastructureError?: string;
  };

const ALLOWED_LOCALES: readonly EvaluationLocale[] = ['ar-EG', 'ar-SA', 'en'];
const ALLOWED_MODES: readonly AgentMode[] = ['autopilot', 'copilot', 'human'];
const ALLOWED_ACTIONS: readonly AutonomyAction[] = ['reply', 'draft', 'human', 'ignore', 'act'];
const MAX_TIMEOUT_MS = 120_000;

/** Fail-closed, bounded credential screening before replay memory and report writes. */
function assertSafeFixtureContent(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  const maxEntries = 10_000;
  let inspected = 0;

  while (pending.length > 0) {
    if (++inspected > maxEntries) throw new Error('Fixture safety scan limit exceeded');
    const item = pending.pop();
    if (typeof item === 'string') {
      if (scrubCredentials(item) !== item) {
        throw new Error('Sensitive fixture content: redact credentials before offline replay');
      }
      continue;
    }
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const children = Object.values(item);
    if (children.length + pending.length > maxEntries) {
      throw new Error('Fixture safety scan limit exceeded');
    }
    for (const child of children) pending.push(child);
  }
}

function assertValidInputs(suite: EvaluationSuite, approved: EvaluationSnapshot, candidate: EvaluationSnapshot, review?: HumanReview) {
  for (const input of [suite, approved, candidate, review]) assertSafeFixtureContent(input);
  if (!suite || !Array.isArray(suite.cases) || suite.cases.length === 0 ||
      !Number.isInteger(suite.version) || typeof suite.suite_id !== 'string' || !suite.suite_id.trim()) {
    throw new Error('Evaluation suite must have a version, identifier and nonempty cases');
  }
  for (const snapshot of [approved, candidate]) {
    if (!snapshot || typeof snapshot.snapshot_id !== 'string' || !snapshot.snapshot_id.trim() ||
        typeof snapshot.model_id !== 'string' || !snapshot.model_id.trim() ||
        !snapshot.policy || !Array.isArray(snapshot.policy.rules) ||
        !snapshot.responses || typeof snapshot.responses !== 'object') {
      throw new Error('Invalid evaluation snapshot');
    }
  }
  if (approved.snapshot_id === candidate.snapshot_id) {
    throw new Error('Candidate must have an independent snapshot identifier');
  }

  const ids = new Set<string>();
  for (const testCase of suite.cases) {
    if (!testCase || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,100}$/.test(testCase.case_id) ||
        ids.has(testCase.case_id) || !ALLOWED_LOCALES.includes(testCase.locale) ||
        !ALLOWED_MODES.includes(testCase.chat_mode) ||
        !ALLOWED_ACTIONS.includes(testCase.expected_action) ||
        !Array.isArray(testCase.inbound_turns) || testCase.inbound_turns.length === 0 ||
        testCase.inbound_turns.some(t => !['contact', 'owner'].includes(t.sender) ||
          typeof t.text !== 'string' || !t.text.trim()) ||
        testCase.inbound_turns.at(-1)?.sender !== 'contact' ||
        !Array.isArray(testCase.dossier_facts) ||
        !Array.isArray(testCase.forbidden_outcomes) ||
        !testCase.forbidden_outcomes.every(x => x === 'send' || x === 'draft') ||
        !Array.isArray(testCase.evidence_ids) ||
        typeof testCase.notes_for_reviewer !== 'string' || !testCase.notes_for_reviewer.trim() ||
        typeof testCase.expected_send !== 'boolean' || typeof testCase.expected_draft !== 'boolean' ||
        typeof testCase.critical !== 'boolean' ||
        testCase.approved_policy_revision !== approved.policy.version) {
      throw new Error(`Invalid or duplicate fixture: ${testCase?.case_id ?? 'unknown'}`);
    }
    ids.add(testCase.case_id);
  }
}

function eligibleReviews(review: HumanReview | undefined, candidateId: string): Set<string> {
  if (!review || review.candidate_id !== candidateId || !review.reviewer?.trim() ||
      !review.reviewed_at || !Number.isFinite(Date.parse(review.reviewed_at)) ||
      !Array.isArray(review.approved_case_ids)) return new Set();
  return new Set(review.approved_case_ids);
}

function validateRecording(recording: RecordedModelResponse | undefined): 'missing_candidate_recording' | 'invalid_recording' | 'invalid_model_decision' | null {
  if (!recording) return 'missing_candidate_recording';
  if (!['decision', 'timeout', 'error'].includes(recording.kind)) return 'invalid_recording';
  if (recording.kind === 'decision') {
    const val = recording.value;
    if (!val || typeof val !== 'object' ||
        !ALLOWED_ACTIONS.includes(val.action as AutonomyAction) ||
        typeof val.intent !== 'string' || !val.intent.trim() ||
        typeof val.confidence !== 'number' ||
        !Number.isFinite(val.confidence) ||
        val.confidence < 0 || val.confidence > 1 ||
        (val.replyText !== undefined && typeof val.replyText !== 'string') ||
        (val.citations !== undefined &&
          (!Array.isArray(val.citations) ||
            !val.citations.every((id: unknown) => typeof id === 'string')))) {
      return 'invalid_model_decision';
    }
  }
  return null;
}

function setupSyntheticHistory(memory: MemoryStore, testCase: EvaluationCase, chatId: string): void {
  memory.setChatMode(chatId, testCase.chat_mode);
  for (const [index, turn] of testCase.inbound_turns.slice(0, -1).entries()) {
    memory.addMessage({
      id: `history-${index}`, chatId, sender: turn.sender, text: turn.text, timestamp: index + 1,
      type: 'text', isFromMe: turn.sender === 'owner'
    });
  }
  if (testCase.dossier_facts.length > 0) {
    memory.saveDossier({
      chatId, name: 'Synthetic contact', stage: 'lead',
      facts: testCase.dossier_facts, commitments: [], updatedAt: 1
    });
  }
}

async function observe(testCase: EvaluationCase, snapshot: EvaluationSnapshot, timeoutMs: number): Promise<ReplayObservation> {
  const recording = snapshot.responses[testCase.case_id];
  const invalidReason = validateRecording(recording);
  if (invalidReason) return { infrastructureError: invalidReason, elapsed_ms: 0 };
  const validRecording = recording!;

  const memory = new MemoryStore({ dataDir: ':memory:' });
  const started = performance.now();
  let modelError: string | undefined;
  const chatId = `case_${testCase.case_id}@simulator.invalid`;
  try {
    setupSyntheticHistory(memory, testCase, chatId);

    // The model is a scripted in-process double: no credentials, transport or network access.
    const model = {
      generateContent: async () => {
        if (validRecording.kind === 'timeout') return new Promise<never>(() => {});
        if (validRecording.kind === 'error') {
          modelError = validRecording.code || 'model_error';
          throw new Error('Recorded model failure');
        }
        return { text: JSON.stringify(validRecording.value) };
      }
    };
    const moderator = new ModeratorAgent(model as unknown as GeminiClient, memory, {
      policy: structuredClone(snapshot.policy),
      persona: { ...DEFAULT_MODERATOR_PERSONA, language: testCase.locale,
        model: snapshot.model_id, simulateTypingDelay: false }
    });
    const inbound = testCase.inbound_turns.at(-1)!;
    const message: ChatMessage = {
      id: 'current', chatId, sender: 'contact', senderName: 'Synthetic contact',
      text: inbound.text, timestamp: testCase.inbound_turns.length + 1,
      isFromMe: false, type: 'text'
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        moderator.processInboundMessage(message, { dryRun: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Replay timeout')), timeoutMs);
        })
      ]);
      if (modelError) return { infrastructureError: 'recorded_model_error', elapsed_ms: Math.round(performance.now() - started) };

      // Record the actual production evaluator's matched rule; the actual action
      // and send disposition come from the real ModeratorAgent dry run.
      const modelDecision = validRecording.kind === 'decision' ? validRecording.value : {};
      const permission = evaluatePermission(snapshot.policy, {
        intent: String(modelDecision.intent ?? 'general_faq'),
        confidence: Number(modelDecision.confidence ?? 0.85),
        requestedAction: modelDecision.action as AutonomyAction | undefined
      });
      return {
        observed_action: result.decision.action,
        should_send: result.shouldSendImmediately,
        draft_created: Boolean(result.draftCreated),
        matched_rule_id: permission.matchedRuleId,
        policy_reason: permission.reason,
        model_usage: validRecording.kind === 'decision' ? validRecording.usage : undefined,
        cited_evidence_ids: validRecording.kind === 'decision' && Array.isArray(validRecording.value.citations)
          ? [...validRecording.value.citations as string[]] : undefined,
        elapsed_ms: Math.round(performance.now() - started)
      };
    } catch (error) {
      return {
        infrastructureError: error instanceof Error && error.message === 'Replay timeout'
          ? 'model_timeout' : 'replay_failure',
        elapsed_ms: Math.round(performance.now() - started)
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    memory.close();
  }
}

function verdict(testCase: EvaluationCase, observed: ReplayObservation): { outcome: EvaluationResult['outcome']; reason: string } {
  if (observed.infrastructureError) return { outcome: 'inconclusive', reason: observed.infrastructureError };
  const forbiddenSend = testCase.forbidden_outcomes.includes('send') && observed.should_send;
  const forbiddenDraft = testCase.forbidden_outcomes.includes('draft') && observed.draft_created;
  const unknownCitation = observed.cited_evidence_ids?.some(id => !testCase.evidence_ids.includes(id));
  if (unknownCitation) return { outcome: 'violation', reason: 'unverified_citation' };
  if (observed.observed_action !== testCase.expected_action ||
      observed.should_send !== testCase.expected_send ||
      observed.draft_created !== testCase.expected_draft ||
      forbiddenSend || forbiddenDraft) {
    return { outcome: 'violation', reason: forbiddenSend || forbiddenDraft
      ? 'forbidden_outcome' : 'contract_mismatch' };
  }
  return { outcome: 'pass', reason: 'contract_matched' };
}

/** Independent goldens remain untouched even when the candidate fails. */
export async function runEvaluationLab(options: EvaluationOptions): Promise<EvaluationReport> {
  const { suite, approved, candidate, review } = options;
  assertValidInputs(suite, approved, candidate, review);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('timeoutMs must be between 1 and 120000');
  }
  const approvedReviews = eligibleReviews(review, candidate.snapshot_id);
  const baselineReviewRequired = !approved.approval?.reviewer?.trim() ||
    !approved.approval.reviewed_at ||
    !Number.isFinite(Date.parse(approved.approval.reviewed_at));
  const results: EvaluationResult[] = [];
  const baselineViolations: string[] = [];
  for (const testCase of suite.cases) {
    const baseline = await observe(testCase, approved, timeoutMs);
    const baselineVerdict = verdict(testCase, baseline);
    if (baselineVerdict.outcome !== 'pass') baselineViolations.push(testCase.case_id);
    const candidateObservation = candidate === approved
      ? baseline : await observe(testCase, candidate, timeoutMs);
    const resultVerdict = verdict(testCase, candidateObservation);
    results.push({
      case_id: testCase.case_id,
      locale: testCase.locale,
      outcome: resultVerdict.outcome,
      reason: resultVerdict.reason,
      expected_action: testCase.expected_action,
      observed_action: candidateObservation.observed_action,
      should_send: candidateObservation.should_send,
      draft_created: candidateObservation.draft_created,
      matched_rule_id: candidateObservation.matched_rule_id,
      policy_reason: candidateObservation.policy_reason,
      baseline_action: baseline.observed_action,
      baseline_changed: baseline.observed_action !== candidateObservation.observed_action ||
        baseline.should_send !== candidateObservation.should_send ||
        baseline.draft_created !== candidateObservation.draft_created,
      human_review: testCase.critical
        ? (approvedReviews.has(testCase.case_id) ? 'approved' : 'pending') : 'not_required',
      evidence_ids: [...testCase.evidence_ids],
      cited_evidence_ids: candidateObservation.cited_evidence_ids,
      model_id: candidate.model_id,
      model_usage: candidateObservation.model_usage,
      elapsed_ms: candidateObservation.elapsed_ms
    });
  }
  const blocking = results.filter(r => r.outcome === 'violation').map(r => r.case_id);
  const inconclusive = results.filter(r => r.outcome === 'inconclusive').map(r => r.case_id);
  const unreviewed = results.filter(r => r.human_review === 'pending').map(r => r.case_id);
  const status: EvaluationReport['status'] = baselineViolations.length || blocking.length
    ? 'blocked' : inconclusive.length
      ? 'inconclusive' : baselineReviewRequired || unreviewed.length ? 'review_required' : 'promotable';
  return {
    suite_id: suite.suite_id,
    suite_version: suite.version,
    approved_id: approved.snapshot_id,
    candidate_id: candidate.snapshot_id,
    status,
    blocking_case_ids: [...new Set([...baselineViolations, ...blocking])],
    inconclusive_case_ids: inconclusive,
    unreviewed_critical_case_ids: unreviewed,
    baseline_violations: baselineViolations,
    baseline_review_required: baselineReviewRequired,
    results,
    evaluated_at: new Date().toISOString()
  };
}

/** Exclusive creation prevents concurrent runs from replacing another report. */
export async function writeReportExclusive(path: string, report: EvaluationReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
