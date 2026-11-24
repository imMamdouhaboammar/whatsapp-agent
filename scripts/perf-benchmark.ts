import { createFableWhatsAppAgent } from '../src/index';
import { SqliteStore } from '../src/domain/db';
import { AgentTurnCoordinator } from '../src/agent/turn-coordinator';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import { SendIntentService } from '../src/domain/send-intent-service';
import { DiagnosticsCore } from '../src/observability/diagnostics-core';
import type { ChatMessage, GeminiGenerateOptions, ChatContent } from '../src/domain/types';

interface BenchmarkReport {
  timestamp: string;
  coldStart: {
    importTimeMs: number;
    initTimeMs: number;
    totalStartMs: number;
    idleRssMb: number;
    heapUsedMb: number;
  };
  sqliteQueries: {
    datasetSize: { chats: number; messages: number; drafts: number; sendIntents: number };
    listChats: { p50Ms: number; p95Ms: number; maxMs: number };
    listPendingDrafts: { p50Ms: number; p95Ms: number; maxMs: number };
    getMessages50: { p50Ms: number; p95Ms: number; maxMs: number };
    claimDueSendIntents: { p50Ms: number; p95Ms: number; maxMs: number };
    concurrentLoadP95Ms: number;
  };
  inboundHotPath: {
    iterations: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    peakRssMb: number;
    memoryGrowthMb: number;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return Number(sorted[idx].toFixed(2));
}

// Mock instant LLM client to isolate internal hot-path processing latency
class MockInstantGemini {
  async generateContent(_contents: ChatContent[], _options?: GeminiGenerateOptions) {
    return {
      text: JSON.stringify({
        action: 'reply',
        intent: 'general_faq',
        replyText: 'أهلاً بك! كيف يمكنني مساعدتك اليوم؟',
        reasoning: 'Routine inquiry',
        confidence: 0.95
      })
    };
  }
}

async function runBenchmark(): Promise<BenchmarkReport> {
  console.log('⚡ [Benchmark] Starting Performance Profiling...');

  // 1. Cold Start & Idle RSS
  const t0 = performance.now();
  const agent = await createFableWhatsAppAgent({ dataDir: ':memory:', autoConnect: false });
  const tInit = performance.now();
  const mInit = process.memoryUsage();
  await agent.shutdown();

  const coldStart = {
    importTimeMs: +(tInit - t0).toFixed(2),
    initTimeMs: +(tInit - t0).toFixed(2),
    totalStartMs: +(tInit - t0).toFixed(2),
    idleRssMb: +(mInit.rss / 1024 / 1024).toFixed(2),
    heapUsedMb: +(mInit.heapUsed / 1024 / 1024).toFixed(2)
  };

  // 2. Database Queries & Write Contention
  console.log('⚡ [Benchmark] Profiling SQLite Query Plans & Latency...');
  const store = new SqliteStore({ dbPath: ':memory:' });

  const CHATS_COUNT = 500;
  const MSGS_PER_CHAT = 40;
  const DRAFTS_COUNT = 300;
  const INTENTS_COUNT = 400;

  for (let i = 0; i < CHATS_COUNT; i++) {
    const chatId = `chat_${i}@s.whatsapp.net`;
    store.saveChat({
      id: chatId,
      name: `Customer ${i}`,
      unreadCount: i % 5 === 0 ? 1 : 0,
      lastMessage: `Message ${i}`,
      lastTimestamp: Date.now() - (CHATS_COUNT - i) * 60_000,
      isGroup: false,
      agentMode: 'autopilot'
    });

    for (let m = 0; m < MSGS_PER_CHAT; m++) {
      store.saveMessage({
        id: `msg_${i}_${m}`,
        chatId,
        sender: m % 2 === 0 ? chatId : 'me',
        senderName: `Customer ${i}`,
        text: `Customer message text sample ${m}`,
        timestamp: Date.now() - (MSGS_PER_CHAT - m) * 1000,
        isFromMe: m % 2 !== 0,
        type: 'text',
        status: 'sent'
      });
    }
  }

  for (let d = 0; d < DRAFTS_COUNT; d++) {
    store.saveDraft({
      id: `draft_${d}`,
      chatId: `chat_${d % 50}@s.whatsapp.net`,
      incomingMessageId: `msg_${d % 50}_0`,
      incomingText: 'Need quotation',
      proposedReply: 'Here is our pricing sheet.',
      reasoning: 'Quotation request',
      confidence: 0.9,
      status: d % 3 === 0 ? 'approved' : 'pending',
      createdAt: Date.now() - d * 2000
    });
  }

  const sendLedger = store.getSendLedger();
  for (let s = 0; s < INTENTS_COUNT; s++) {
    sendLedger.createIntent({
      sourceKind: 'autopilot',
      sourceId: `source_${s}`,
      sourceRevision: 1,
      actionKind: 'text',
      chatId: `chat_${s % 100}@s.whatsapp.net`,
      text: `Automated reply text ${s}`,
      policyRevision: 1
    });
  }

  // Profile listChats
  const listChatsTimings: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    store.listChats();
    listChatsTimings.push(performance.now() - start);
  }
  listChatsTimings.sort((a, b) => a - b);

  // Profile getPendingDrafts
  const draftsTimings: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    store.getPendingDrafts();
    draftsTimings.push(performance.now() - start);
  }
  draftsTimings.sort((a, b) => a - b);

  // Profile getMessages (50 rows)
  const getMsgsTimings: number[] = [];
  for (let i = 0; i < 100; i++) {
    const chatId = `chat_${i % CHATS_COUNT}@s.whatsapp.net`;
    const start = performance.now();
    store.getMessages(chatId, 50);
    getMsgsTimings.push(performance.now() - start);
  }
  getMsgsTimings.sort((a, b) => a - b);

  // Profile claimDueSendIntents (fetching due queued intents)
  const claimTimings: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    sendLedger.due(Date.now() + 60_000, 10);
    claimTimings.push(performance.now() - start);
  }
  claimTimings.sort((a, b) => a - b);

  // Concurrent mixed load
  const concurrentTimings: number[] = [];
  for (let round = 0; round < 50; round++) {
    const start = performance.now();
    // simulate concurrent scheduler + inbound write + UI read
    store.listChats();
    store.saveMessage({
      id: `burst_msg_${round}`,
      chatId: `chat_${round % 50}@s.whatsapp.net`,
      sender: `chat_${round % 50}@s.whatsapp.net`,
      text: `Concurrent test message ${round}`,
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    });
    store.getPendingDrafts();
    sendLedger.due(Date.now() + 60_000, 5);
    concurrentTimings.push(performance.now() - start);
  }
  concurrentTimings.sort((a, b) => a - b);

  const sqliteQueries = {
    datasetSize: {
      chats: CHATS_COUNT,
      messages: CHATS_COUNT * MSGS_PER_CHAT,
      drafts: DRAFTS_COUNT,
      sendIntents: INTENTS_COUNT
    },
    listChats: {
      p50Ms: percentile(listChatsTimings, 50),
      p95Ms: percentile(listChatsTimings, 95),
      maxMs: Number(listChatsTimings[listChatsTimings.length - 1].toFixed(2))
    },
    listPendingDrafts: {
      p50Ms: percentile(draftsTimings, 50),
      p95Ms: percentile(draftsTimings, 95),
      maxMs: Number(draftsTimings[draftsTimings.length - 1].toFixed(2))
    },
    getMessages50: {
      p50Ms: percentile(getMsgsTimings, 50),
      p95Ms: percentile(getMsgsTimings, 95),
      maxMs: Number(getMsgsTimings[getMsgsTimings.length - 1].toFixed(2))
    },
    claimDueSendIntents: {
      p50Ms: percentile(claimTimings, 50),
      p95Ms: percentile(claimTimings, 95),
      maxMs: Number(claimTimings[claimTimings.length - 1].toFixed(2))
    },
    concurrentLoadP95Ms: percentile(concurrentTimings, 95)
  };

  // 3. Inbound Hot-Path Processing Latency & Memory Growth Under 100 Burst Turns
  console.log('⚡ [Benchmark] Profiling 100 Simulated Inbound Turns (Hot-Path Latency & Peak RSS)...');
  const memoryStore = new MemoryStore({ dataDir: ':memory:' });
  const mockGemini = new MockInstantGemini();
  const moderator = new ModeratorAgent(mockGemini as any, memoryStore);
  const coordinator = new AgentTurnCoordinator({
    moderator,
    memory: memoryStore,
    operator: { resolve: async () => ({ status: 'success', summary: 'ok' }) },
    enabled: false
  });

  const diagnostics = new DiagnosticsCore();
  const sendIntents = new SendIntentService({
    memoryStore,
    diagnostics,
    sendText: async () => 'test_native_id'
  });

  const memBeforeBurst = process.memoryUsage();
  let peakRss = memBeforeBurst.rss;
  const turnTimings: number[] = [];

  const BURST_TURNS = 100;
  for (let i = 0; i < BURST_TURNS; i++) {
    const chatId = `customer_${i % 20}@s.whatsapp.net`;
    const msg: ChatMessage = {
      id: `inbound_${i}`,
      chatId,
      sender: chatId,
      senderName: `Customer ${i % 20}`,
      text: i % 3 === 0 ? 'السلام عليكم، عايز أعرف الأسعار وطريقة الحجز' : 'تمام شكرا جزيلا',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const startTurn = performance.now();

    // 1. Inbound persistence & deduplication check
    if (!memoryStore.getMessage(msg.chatId, msg.id)) {
      memoryStore.addMessage(msg);
    }

    // 2. Coordinator & Moderator Turn Processing
    const result = await coordinator.processInboundMessage(msg);

    // 3. Outbound Send Intent Dispatch
    if (result.shouldSendImmediately && result.decision.replyText) {
      await sendIntents.sendText({
        sourceKind: 'autopilot',
        sourceId: `${msg.chatId}:${msg.id}:part-1`,
        sourceRevision: 1,
        actionKind: 'text',
        chatId: msg.chatId,
        text: result.decision.replyText,
        policyRevision: 1
      });
    }

    const elapsed = performance.now() - startTurn;
    turnTimings.push(elapsed);

    const currentRss = process.memoryUsage().rss;
    if (currentRss > peakRss) peakRss = currentRss;
  }

  const memAfterBurst = process.memoryUsage();
  turnTimings.sort((a, b) => a - b);

  const inboundHotPath = {
    iterations: BURST_TURNS,
    p50Ms: percentile(turnTimings, 50),
    p95Ms: percentile(turnTimings, 95),
    p99Ms: percentile(turnTimings, 99),
    maxMs: Number(turnTimings[turnTimings.length - 1].toFixed(2)),
    peakRssMb: +(peakRss / 1024 / 1024).toFixed(2),
    memoryGrowthMb: +((memAfterBurst.rss - memBeforeBurst.rss) / 1024 / 1024).toFixed(2)
  };

  return {
    timestamp: new Date().toISOString(),
    coldStart,
    sqliteQueries,
    inboundHotPath
  };
}

const report = await runBenchmark();
console.log('\n================ BENCHMARK RESULT ================');
console.log(JSON.stringify(report, null, 2));
console.log('==================================================\n');
