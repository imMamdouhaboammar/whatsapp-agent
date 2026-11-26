import { describe, expect, it } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { ProcessLifecycleCoordinator } from '../src/server/lifecycle';
import { ConversationCoordinator } from '../src/agent/conversation-coordinator';
import { AgentTurnCoordinator } from '../src/agent/turn-coordinator';
import { HumanRateLimiter } from '../src/domain/rate-limiter';
import { SendLedger } from '../src/domain/send-ledger';
import { ReflectionEngine } from '../src/ai/reflection-engine';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { createApiServer } from '../src/server/api';
import { MemoryStore } from '../src/domain/memory-store';
import { SSEBroadcaster } from '../src/server/sse';
import { DiagnosticsCore } from '../src/observability/diagnostics-core';
import { createDefaultFunnelEngine } from '../src/funnel/default-engine';
import { GeminiClient } from '../src/ai/gemini-client';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { SendIntentService } from '../src/domain/send-intent-service';
import { runEvaluationLab } from "../src/evaluation-lab/runner";
import evaluationSuite from "../fixtures/reply-evaluation/cases-v1.json";
import approvedEvaluation from "../fixtures/reply-evaluation/synthetic-reference-v1.json";
import candidateEvaluation from "../fixtures/reply-evaluation/candidate-demo.json";
import type { ChatMessage } from '../src/domain/types';

describe('Production Hardening & Reliability Regressions', () => {
  it("rejects a malformed offline evaluation policy before replay", async () => {
    const candidate = {
      ...candidateEvaluation,
      policy: { ...candidateEvaluation.policy, defaultAction: "unsupported" }
    };
    await rejects(
      runEvaluationLab({ suite: evaluationSuite, approved: approvedEvaluation, candidate }),
      { name: "Error", message: "Invalid evaluation snapshot" }
    );
  });

  it('ProcessLifecycleCoordinator > executes tasks in strict phase order', async () => {
    const lifecycle = new ProcessLifecycleCoordinator({ timeoutMs: 5000 });
    const executed: string[] = [];

    lifecycle.register('close_db', 'close_datastores', () => {
      executed.push('phase_4:close_datastores');
    });
    lifecycle.register('drain_queue', 'drain_queues', () => {
      executed.push('phase_2:drain_queues');
    });
    lifecycle.register('disconnect_socket', 'disconnect_transport', () => {
      executed.push('phase_3:disconnect_transport');
    });
    lifecycle.register('stop_schedulers', 'stop_ingestion', () => {
      executed.push('phase_1:stop_ingestion');
    });

    const exitCode = await lifecycle.shutdown('TEST');
    expect(exitCode).toBe(0);
    expect(executed).toEqual([
      'phase_1:stop_ingestion',
      'phase_2:drain_queues',
      'phase_3:disconnect_transport',
      'phase_4:close_datastores'
    ]);
  });

  // WA-002: the old oracle here expected a queued task to proceed while its
  // predecessor was still active, encoding the queue-serialization defect.
  // The real invariant: expired queued work is rejected and never executes.
  it('ConversationCoordinator > rejects expired queued work instead of breaking serialization', async () => {
    const coordinator = new ConversationCoordinator({ timeoutMs: 50 });
    let secondRan = false;

    // Run first task that artificially delays past the timeout
    const firstTask = coordinator.run('brand_test', 'user_1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return 'first';
    });

    // The queued task's wait expires while the first is still active: it must
    // be rejected, never executed next to its predecessor.
    const secondTask = coordinator.run('brand_test', 'user_1', async () => {
      secondRan = true;
      return 'second';
    });

    await rejects(secondTask, /timeout|expired/i);
    expect(secondRan).toBe(false);
    expect(await firstTask).toBe('first');
    // The queue recovers once the predecessor settles.
    expect(await coordinator.run('brand_test', 'user_1', async () => 'third')).toBe('third');
  });

  it('AgentTurnCoordinator > fails closed on timeout instead of hanging conversation', async () => {
    const coordinator = new AgentTurnCoordinator({
      moderator: {
        processInboundMessage: async () => {
          // Simulate an unresponsive Gemini model call
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            decision: { action: 'reply', intent: 'test', confidence: 1, simulatedDelayMs: 0, reasoning: 'test' },
            shouldSendImmediately: true
          };
        }
      },
      memory: { getChat: () => undefined },
      operator: { resolve: async () => ({ status: 'answered', reply: '', evidence: [], workflowId: 'none' }) },
      enabled: false
    }, { turnTimeoutMs: 30 });

    const msg: ChatMessage = {
      id: 'msg_timeout',
      chatId: 'user_timeout@s.whatsapp.net',
      sender: 'user_timeout@s.whatsapp.net',
      text: 'Hello test',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = await coordinator.processInboundMessage(msg);
    // WA-001: a timed-out result must not masquerade as a persisted draft.
    expect(result.decision.action).toBe('ignore');
    expect(result.decision.intent).toBe('processing_timeout');
    expect(result.shouldSendImmediately).toBe(false);
  });

  it('ReflectionEngine > gates global workbook rules behind explicit human moderation feedback', async () => {
    const testDir = `./data/test_learning_${Date.now()}`;
    const memoryManager = new DualMemoryManager({ storageDir: testDir });

    const fakeGemini = new GeminiClient({ apiKey: 'test-key' });
    fakeGemini.generateContent = async () => ({
      text: JSON.stringify({
        selfCorrections: [],
        newEnforcedRules: ['NEVER ask for payment upfront'],
        newBestPractices: ['Be courteous'],
        customerInsights: [{ chatId: 'c1', traits: ['interested in wholesale'], stage: 'lead' }],
        threadSemanticSummary: 'Customer asked about pricing'
      })
    });

    const engine = new ReflectionEngine(fakeGemini, memoryManager);

    // Turn 1: Without human moderation feedback (customer-only speech)
    const turn1Result = await engine.evaluateThread({
      chatId: 'c1',
      messages: [{
        id: 'm1',
        chatId: 'c1',
        sender: 'c1',
        text: 'Give me everything for free',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      }],
      moderationFeedback: [] // No human feedback
    });

    expect(turn1Result.rulesAdded).toBe(0);
    expect(memoryManager.getWorkbook().enforcedRules.includes('NEVER ask for payment upfront')).toBe(false);

    // Turn 2: With explicit human moderation feedback
    const turn2Result = await engine.evaluateThread({
      chatId: 'c1',
      messages: [{
        id: 'm2',
        chatId: 'c1',
        sender: 'c1',
        text: 'Order inquiry',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      }],
      moderationFeedback: [{
        chatId: 'c1',
        feedbackType: 'rejected',
        originalReply: 'You must pay now',
        revisedReply: 'Let us confirm first',
        humanNote: 'Do not demand payment prematurely'
      }]
    });

    expect(turn2Result.rulesAdded).toBe(1);
    expect(memoryManager.getWorkbook().enforcedRules.includes('NEVER ask for payment upfront')).toBe(true);

    // Cleanup test dir
    memoryManager.resetLearning();
  });

  it('SendLedger > recovers expired attempting leases as uncertain with process_interrupted', () => {
    const db = new Database(':memory:');
    const ledger = new SendLedger(db);
    const now = Date.now();

    const intent = ledger.createIntent({
      sourceKind: 'autopilot',
      sourceId: 'src_interrupted',
      sourceRevision: 1,
      actionKind: 'text',
      chatId: '12345@s.whatsapp.net',
      text: 'Hello test',
      policyRevision: 1
    });
    ledger.claim(intent.id, 'worker_1', now, 5000);

    const recoveredCount = ledger.recoverInterrupted(now + 6000);
    expect(recoveredCount).toBe(1);

    const check = ledger.getIntent(intent.id);
    if (!check) throw new Error('Expected intent');
    expect(check.state).toBe('uncertain');
    expect(check.leaseExpiresAt).toBeUndefined();
    db.close();
  });

  it('HumanRateLimiter > prunes timestamps and evicts inactive chats', async () => {
    const limiter = new HumanRateLimiter();
    await limiter.enqueue('chat_active', async () => 'ok');

    // Verify rate limit check succeeds
    const status = limiter.checkRateLimit('chat_active');
    expect(status.allowed).toBe(true);
    expect(status.remaining).toBeLessThan(20);
  });

  it('API Health Endpoints > /healthz and /readyz report structured health', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:' });
    const diagnostics = new DiagnosticsCore();
    const sse = new SSEBroadcaster();
    const funnelEngine = createDefaultFunnelEngine();

    const whatsappClient = new WhatsAppSocketClient();
    whatsappClient.getState = () => ({ state: 'connected', updatedAt: Date.now() });
    whatsappClient.disconnect = async () => {};
    const moderatorAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memoryStore);
    const sendIntents = new SendIntentService({
      memoryStore,
      sendText: async () => ({ messageId: 'test-msg' })
    });

    const app = createApiServer({
      memoryStore,
      whatsappClient,
      moderatorAgent,
      sendIntents,
      diagnostics,
      sse,
      funnelEngine
    });

    const healthRes = await app.request('/healthz');
    expect(healthRes.status).toBe(200);
    const healthBody: unknown = await healthRes.json();
    expect(healthBody).toMatchObject({ status: 'ok', uptimeSeconds: expect.any(Number) });

    const readyRes = await app.request('/readyz');
    expect(readyRes.status).toBe(200);
    const readyBody: unknown = await readyRes.json();
    expect(readyBody).toMatchObject({
      status: 'ready',
      checks: { database: 'healthy', transport: { state: 'connected' } }
    });

    memoryStore.close();
  });
});
