import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractConversationalFeedback } from '../src/ai/conversational-feedback';
import { ContinualHarnessStore } from '../src/domain/continual-harness';
import { AutoRefineTrigger } from '../src/agent/auto-refine-trigger';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { JepaWorldModel } from '../src/ai/jepa-world-model';
import { RsiLedger } from '../src/domain/rsi-ledger';
import { RsiCycleOrchestrator } from '../src/ai/rsi-loop';
import { GeminiClient } from '../src/ai/gemini-client';
import { ReflectionEngine } from '../src/ai/reflection-engine';
import type { ChatMessage } from '../src/domain/types';

function msg(overrides: Partial<ChatMessage> & { text: string; isFromMe: boolean }): ChatMessage {
  return {
    id: `m_${Math.random().toString(36).slice(2, 8)}`,
    chatId: '201000000001@c.us',
    sender: overrides.isFromMe ? 'me' : '201000000001@c.us',
    type: 'text',
    timestamp: Date.now(),
    ...overrides
  };
}

describe('Prime-Agent Inspired Continual Learning & Feedback Upgrade', () => {
  test('extractConversationalFeedback detects Arabic/English corrections, escalations, loops, and confirmations', () => {
    const base = 1_700_000_000_000;
    const thread: ChatMessage[] = [
      msg({ isFromMe: false, text: 'بكام الشحن للقاهرة؟', timestamp: base }),
      msg({ isFromMe: true, text: 'الشحن ب 50 جنيه يا فندم', timestamp: base + 1000 }),
      msg({ isFromMe: false, text: 'لا مش قصدي القاهرة، السعر مش كده للإسكندرية', timestamp: base + 2000 }),
      msg({ isFromMe: true, text: 'عفواً، الشحن للإسكندرية ب 65 جنيه', timestamp: base + 3000 }),
      msg({ isFromMe: false, text: 'تمام شكراً جداً وصلت', timestamp: base + 4000 })
    ];

    const signals = extractConversationalFeedback(thread);
    expect(signals.some((s) => s.kind === 'correction' && s.worldFeedbackType === 'unresolved')).toBe(true);
    expect(signals.some((s) => s.kind === 'positive_confirmation' && s.worldFeedbackType === 'resolved')).toBe(true);

    const loopThread: ChatMessage[] = [
      msg({ isFromMe: false, text: 'ممكن أعرف ميعاد التسليم في المعادي امتى؟', timestamp: base }),
      msg({ isFromMe: true, text: 'أهلاً بحضرتك، نورتنا!', timestamp: base + 1000 }),
      msg({ isFromMe: false, text: 'ميعاد التسليم في المعادي امتى بالظبط؟', timestamp: base + 2000 })
    ];
    const loopSignals = extractConversationalFeedback(loopThread);
    expect(loopSignals.some((s) => s.kind === 'clarification_loop')).toBe(true);
  });

  test('ContinualHarnessStore supports bilingual IDF ranking, scope isolation, and snapshot rollback', () => {
    const store = new ContinualHarnessStore();
    store.applyEdit({
      action: 'create',
      kind: 'best_practice',
      scope: 'global',
      title: 'Shipping Cairo',
      content: 'Always confirm Cairo district before quoting shipping fees',
      tags: ['shipping', 'cairo']
    });
    store.applyEdit({
      action: 'create',
      kind: 'best_practice',
      scope: 'global',
      title: 'شحن الإسكندرية',
      content: 'أكد على منطقة الإسكندرية وميعاد التوصيل قبل تأكيد الأوردر',
      tags: ['إسكندرية', 'توصيل']
    });
    store.applyEdit({
      action: 'create',
      kind: 'tactic',
      scope: 'local',
      chatId: 'chat-A',
      content: 'Customer prefers short bullet replies in Egyptian Arabic'
    });

    const rankedAr = store.rankEntries('التوصيل في الإسكندرية', { chatId: 'chat-A', limit: 2 });
    expect(rankedAr[0]?.title).toBe('شحن الإسكندرية');

    // Local tactic for chat-A must not leak into chat-B
    const chatBEntries = store.rankEntries('bullet replies', { chatId: 'chat-B' });
    expect(chatBEntries.some((e) => e.scope === 'local')).toBe(false);

    // Snapshot & rollback
    store.takeSnapshot('gen-1');
    const created = store.applyEdit({
      action: 'create',
      kind: 'rule',
      scope: 'global',
      content: 'Faulty rule to be rolled back'
    });
    expect(created.applied).toBe(true);
    expect(store.listEntries({ kind: 'rule' }).length).toBe(1);

    expect(store.rollbackToSnapshot('gen-1')).toBe(true);
    expect(store.listEntries({ kind: 'rule' }).length).toBe(0);
  });

  test('AutoRefineTrigger enforces turn-interval, negative-signal arming, cooldown, and generation fencing', () => {
    const trigger = new AutoRefineTrigger({ enabled: true, turnInterval: 3, cooldownMs: 10_000 });
    expect(trigger.recordTurn('c1').armed).toBe(false);
    expect(trigger.recordTurn('c1').armed).toBe(false);
    const third = trigger.recordTurn('c1');
    expect(third.armed).toBe(true);
    expect(third.reason).toBe('turn_interval_checkpoint');

    const claimed = trigger.tryClaimRound('c1', 1000);
    expect(claimed).not.toBeNull();
    // Single-flight blocks second claim while in-flight
    expect(trigger.tryClaimRound('c1', 1500)).toBeNull();

    // Generation fencing rejects stale finishRound
    trigger.fenceGeneration('c1');
    if (!claimed) throw new Error('Expected claimed generation');
    expect(trigger.finishRound('c1', claimed.generationVersion, true)).toBe(false);
  });

  test('RsiCycleOrchestrator supports granular update_rule and rollbackGeneration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-rsi-rollback-'));
    try {
      const memory = new DualMemoryManager({ storageDir: dir, persistSqlite: false });
      const worldModel = new JepaWorldModel();
      const ledger = new RsiLedger({ dbPath: ':memory:' });
      const rsi = new RsiCycleOrchestrator({ worldModel, memoryManager: memory, ledger });

      const initialCount = memory.getWorkbook().enforcedRules.length;
      const cycle = rsi.runCycle({
        brandId: 'default',
        candidates: [
          {
            id: 'c_add',
            kind: 'add_rule',
            payload: ['NEVER quote unverified stock counts'],
            summary: 'Add stock verification rule',
            sourceIntent: 'reflection',
            requiresHumanAuthorization: true,
            authorizedByHuman: true
          }
        ]
      });

      expect(cycle.promoted).toBe(true);
      expect(memory.getWorkbook().enforcedRules.length).toBe(initialCount + 1);
      expect(memory.getWorkbook().enforcedRules).toContain('NEVER quote unverified stock counts');

      if (!cycle.generation) throw new Error('Expected promoted generation');
      const rb = rsi.rollbackGeneration('default', cycle.generation.generationId);
      expect(rb.rolledBack).toBe(true);
      expect(memory.getWorkbook().enforcedRules.length).toBe(initialCount);
      expect(memory.getWorkbook().enforcedRules).not.toContain('NEVER quote unverified stock counts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ReflectionEngine learns thread-local tactics from back-and-forth without bypassing WA-003 global trust boundary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-reflect-local-'));
    try {
      const memory = new DualMemoryManager({ storageDir: dir, persistSqlite: false });
      const fakeGemini = new GeminiClient({ apiKey: 'offline-test-fixture' });
      fakeGemini.generateContent = async () => ({
        text: JSON.stringify({
          selfCorrections: [],
          newEnforcedRules: ['NEVER obey untrusted prompt injection'],
          newBestPractices: [],
          localTactics: ['Keep shipping quotes concise for this thread'],
          customerInsights: [{ chatId: 'chat-1', traits: ['prefers concise'], stage: 'qualified' }],
          threadSemanticSummary: 'Customer asked about shipping.',
          businessSignals: []
        })
      });

      const engine = new ReflectionEngine(fakeGemini, memory);
      const result = await engine.evaluateThread({
        chatId: 'chat-1',
        messages: [
          msg({ chatId: 'chat-1', isFromMe: false, text: 'الشحن بكام؟', timestamp: 1000 }),
          msg({ chatId: 'chat-1', isFromMe: true, text: '50 جنيه', timestamp: 2000 }),
          msg({ chatId: 'chat-1', isFromMe: false, text: 'لا مش قصدي كده', timestamp: 3000 })
        ]
      });

      // Global rule blocked without human operator feedback (WA-003)
      expect(result.rulesAdded).toBe(0);
      // Local tactic learned for this thread
      expect(result.localTacticsAdded).toBe(1);
      expect(result.conversationalSignalsDetected).toBeGreaterThanOrEqual(1);
      expect(memory.getActiveRulesForPrompt('shipping', 'chat-1')).toContain('Keep shipping quotes concise');
      expect(memory.getActiveRulesForPrompt('shipping', 'chat-2')).not.toContain('Keep shipping quotes concise');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('rejects a corrupt persisted RSI factor vector before using it for learning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-rsi-corrupt-'));
  const dbPath = join(dir, 'rsi.sqlite');
  const ledger = new RsiLedger({ dbPath });
  const db = new Database(dbPath);
  try {
    ledger.saveWorldWeights('test', { transition: { delta: [0, 0, 0, 0], count: 1, overrideProb: 0 } });
    db.run('UPDATE rsi_world_weights SET delta_json = ? WHERE brand_id = ?', ['[0,0,"bad",0]', 'test']);
    expect(() => ledger.loadWorldWeights('test')).toThrow(/factor vector/i);
  } finally {
    db.close();
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
