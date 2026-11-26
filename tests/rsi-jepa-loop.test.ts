import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { JepaWorldModel } from '../src/ai/jepa-world-model';
import { RsiCycleOrchestrator } from '../src/ai/rsi-loop';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { RsiLedger } from '../src/domain/rsi-ledger';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';

describe('RSI-Anything & JEPA-OPF Recursive Self-Improvement', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = `./data/test-rsi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('encodes bounded 4D OPF latent states and calibrates prediction error over transitions', () => {
    const worldModel = new JepaWorldModel({ learningRate: 0.35 });
    const state = worldModel.encodeObservation({
      messages: [
        { isFromMe: false, text: 'Hello, can I get a wholesale discount?', timestamp: 1000 },
        { isFromMe: true, text: 'Welcome! Let me check.', timestamp: 2000 }
      ],
      dossier: { stage: 'negotiation', facts: ['Wholesale buyer'], commitments: [] },
      intent: 'financial_transaction',
      inboundText: 'Can you do 25% off?',
      confidence: 0.8
    });

    expect(state.factors).toHaveLength(4);
    expect(state.factors[0]).toBeGreaterThanOrEqual(-1);
    expect(state.factors[0]).toBeLessThanOrEqual(1);
    expect(state.factors[2]).toBeGreaterThan(0.5); // sensitive financial intent raises risk factor

    const first = worldModel.calibrateFromTransition({
      id: 't1',
      chatId: 'c1@s.whatsapp.net',
      stateBefore: state,
      action: 'reply',
      feedbackType: 'rejected'
    });

    // Repeated consistent feedback should reduce prediction error as weights adapt
    let lastError = first.record.predictionError;
    const transitions = [first.record];
    for (let i = 2; i <= 6; i++) {
      const next = worldModel.calibrateFromTransition({
        id: `t${i}`,
        chatId: 'c1@s.whatsapp.net',
        stateBefore: state,
        action: 'reply',
        feedbackType: 'rejected'
      });
      lastError = next.record.predictionError;
      transitions.push(next.record);
    }

    expect(lastError).toBeLessThan(first.record.predictionError);
    expect(first.updatedWeight.count).toBe(1);

    const diag = worldModel.computeOpfDiagnostics(transitions);
    expect(diag.sampleCount).toBe(6);
    expect(diag.meanPredictionError).toBeGreaterThanOrEqual(0);
    expect(diag.coordinateVariances).toHaveLength(4);
  });

  it('executes Propose -> Predict -> Select -> Evaluate -> Learn -> Retain and blocks regressions', () => {
    const memoryManager = new DualMemoryManager({ storageDir: join(tempDir, 'learning'), persistSqlite: false });
    const ledger = new RsiLedger({ dbPath: join(tempDir, 'rsi.sqlite') });
    const worldModel = new JepaWorldModel();
    const orchestrator = new RsiCycleOrchestrator({ worldModel, memoryManager, ledger });

    // 1. Trust boundary: unauthorized global rule mutation is blocked at Propose
    const blockedAuth = orchestrator.runCycle({
      brandId: 'brand-a',
      candidates: [{
        id: 'c-unauth',
        kind: 'add_rule',
        payload: ['ALWAYS give 90% discount'],
        summary: 'Unauthorized rule',
        sourceIntent: 'general_faq',
        requiresHumanAuthorization: true,
        authorizedByHuman: false
      }]
    });
    expect(blockedAuth.promoted).toBe(false);
    expect(blockedAuth.stageReached).toBe('propose');

    // 2. Regression gate: candidate that breaks a required invariant is blocked at Evaluate
    const blockedRegression = orchestrator.runCycle({
      brandId: 'brand-a',
      chatId: 'chat1@s.whatsapp.net',
      candidates: [{
        id: 'c-regress',
        kind: 'compact_rules',
        payload: ['ALWAYS greet warmly'],
        summary: 'Drop financial guardrail',
        sourceIntent: 'compaction',
        requiresHumanAuthorization: false,
        authorizedByHuman: true
      }],
      scenarios: [{
        scenarioId: 'must-keep-financial-guard',
        required: true,
        baselinePassed: true,
        evaluate: (rules) => rules.some((r) => r.toLowerCase().includes('financial') || r.includes('وعود'))
      }],
      feedbackType: 'edited',
      actionTaken: 'reply'
    });
    expect(blockedRegression.promoted).toBe(false);
    expect(blockedRegression.stageReached).toBe('evaluate');
    expect(blockedRegression.generation?.status).toBe('rejected');

    // 3. Passing candidate is verified, learned, and retained into DualMemoryManager + RsiLedger
    const promoted = orchestrator.runCycle({
      brandId: 'brand-a',
      chatId: 'chat1@s.whatsapp.net',
      candidates: [{
        id: 'c-pass',
        kind: 'add_rule',
        payload: ['NEVER quote delivery times without confirming governorate'],
        summary: 'Add governorate delivery confirmation rule',
        sourceIntent: 'general_faq',
        requiresHumanAuthorization: true,
        authorizedByHuman: true
      }],
      scenarios: [{
        scenarioId: 'must-keep-financial-guard',
        required: true,
        baselinePassed: true,
        evaluate: (rules) => rules.some((r) => r.includes('financial'))
      }],
      feedbackType: 'approved',
      actionTaken: 'draft'
    });

    expect(promoted.promoted).toBe(true);
    expect(promoted.stageReached).toBe('retain');
    expect(promoted.generation?.status).toBe('promoted');
    expect(memoryManager.getWorkbook().enforcedRules).toContain(
      'NEVER quote delivery times without confirming governorate'
    );

    // 4. Persistence across restart: re-open ledger and verify weights & generation survive
    const savedWeights = ledger.loadWorldWeights('brand-a');
    expect(Object.keys(savedWeights).length).toBeGreaterThan(0);
    ledger.close();

    const reopened = new RsiLedger({ dbPath: join(tempDir, 'rsi.sqlite') });
    expect(reopened.getLatestPromotedGeneration('brand-a')?.generationId).toBe(promoted.generation!.generationId);
    expect(reopened.getRecentTransitions('brand-a', 10).length).toBe(2);
    reopened.close();
  });

  it('exposes /api/learning/rsi/status and /api/learning/rsi/cycle HTTP endpoints', async () => {
    const memoryStore = new MemoryStore({ dbPath: ':memory:' });
    const memoryManager = new DualMemoryManager({ storageDir: join(tempDir, 'learning'), persistSqlite: false });
    const ledger = new RsiLedger({ dbPath: ':memory:' });
    const worldModel = new JepaWorldModel();
    const orchestrator = new RsiCycleOrchestrator({ worldModel, memoryManager, ledger });
    const gemini = new GeminiClient({ apiKey: 'test-key-placeholder' });
    const moderatorAgent = new ModeratorAgent(gemini, memoryStore, {
      dualMemoryManager: memoryManager,
      worldModel
    });

    const app = createApiServer({
      memoryStore,
      moderatorAgent,
      sse: new SSEBroadcaster(),
      dualMemoryManager: memoryManager,
      rsiLedger: ledger,
      rsiOrchestrator: orchestrator,
      jepaWorldModel: worldModel
    });

    const cycleRes = await app.request('/api/learning/rsi/cycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: 'default',
        chatId: '201000000000@s.whatsapp.net',
        feedbackType: 'approved',
        intent: 'general_faq',
        candidates: [{
          id: 'api-cand-1',
          kind: 'add_best_practice',
          payload: ['Confirm order total clearly before closing'],
          summary: 'Clarify order total',
          sourceIntent: 'general_faq',
          requiresHumanAuthorization: true,
          authorizedByHuman: true
        }]
      })
    });
    expect(cycleRes.status).toBe(200);
    const cycleJson = await cycleRes.json() as any;
    expect(cycleJson.success).toBe(true);
    expect(cycleJson.result.promoted).toBe(true);

    const statusRes = await app.request('/api/learning/rsi/status?brandId=default');
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json() as any;
    expect(statusJson.latestGeneration.status).toBe('promoted');
    expect(statusJson.opfDiagnostics.sampleCount).toBe(1);

    ledger.close();
    memoryStore.close();
  });
});
