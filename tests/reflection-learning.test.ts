import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DualMemoryManager } from '../src/domain/learning-memory';
import { ReflectionEngine } from '../src/ai/reflection-engine';
import { ReflectionWorker } from '../src/agent/reflection-worker';
import { MemoryStore } from '../src/domain/memory-store';
import { ModeratorAgent, DEFAULT_MODERATOR_PERSONA } from '../src/ai/moderator-agent';
import { GeminiClient } from '../src/ai/gemini-client';
import { createApiServer } from '../src/server/api';
import { SSEBroadcaster } from '../src/server/sse';
import type { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import type { ChatMessage } from '../src/domain/types';

const TEST_DIR = './data/test-learning-' + Date.now();

describe('Continuous Learning & Self-Correction Engine', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Task 1: The Dual Memory State Schema (notebook.md & workbook.md)', () => {
    it('initializes default markdown files with required structured blocks', () => {
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      const workbookPath = join(TEST_DIR, 'workbook.md');
      const notebookPath = join(TEST_DIR, 'notebook.md');

      expect(existsSync(workbookPath)).toBe(true);
      expect(existsSync(notebookPath)).toBe(true);

      const workbookContent = readFileSync(workbookPath, 'utf-8');
      const notebookContent = readFileSync(notebookPath, 'utf-8');

      // Required explicit blocks for workbook
      expect(workbookContent).toContain('## [Best Practices Developed]');
      expect(workbookContent).toContain('## [Failure Logs & Corrective Actions]');
      expect(workbookContent).toContain('## [Enforced Execution Rules]');

      // Required blocks for notebook
      expect(notebookContent).toContain('## [Active Thread Semantics & Context]');
      expect(notebookContent).toContain('## [Customer Profiles & Ephemeral Facts]');
      expect(notebookContent).toContain('## [Business & Market Insights Discovered]');
    });

    it('parses, adds atomic changes, and serializes markdown blocks accurately', () => {
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      // Add a failure log and a new counter-rule to workbook
      memoryManager.recordFailureLog({
        timestamp: '2026-11-07 10:00:00',
        incident: 'Agent quoted old discount rate (30%) not approved by owner',
        rootCause: 'Outdated promotional context hallucination',
        correctiveAction: 'Never offer discounts >10% without explicit human approval'
      });

      memoryManager.addEnforcedRule('NEVER offer discounts higher than 10% without operator approval');
      memoryManager.addBestPractice('Always open morning conversations with a warm Egyptian Arabic greeting');

      // Add customer fact and thread semantics to notebook
      memoryManager.recordCustomerProfile('201018880000@s.whatsapp.net', {
        traits: ['Prefers Egyptian dialect', 'Buys wholesale for boutique in Giza'],
        stage: 'qualified'
      });
      memoryManager.recordThreadSemantic('201018880000@s.whatsapp.net', 'Negotiating wholesale pricing on SKU-100');

      // Verify in-memory parse and on-disk file
      const workbook = memoryManager.getWorkbook();
      expect(workbook.enforcedRules.length).toBeGreaterThan(0);
      expect(workbook.enforcedRules[workbook.enforcedRules.length - 1]).toContain('10%');
      expect(workbook.failureLogs.length).toBeGreaterThan(0);
      expect(workbook.bestPractices.length).toBeGreaterThan(0);

      const notebook = memoryManager.getNotebook();
      expect(notebook.threadSemantics.length).toBeGreaterThan(0);
      expect(notebook.customerProfiles['201018880000@s.whatsapp.net'].traits).toContain('Prefers Egyptian dialect');

      // Verify files persisted on disk
      const wbDisk = readFileSync(join(TEST_DIR, 'workbook.md'), 'utf-8');
      expect(wbDisk).toContain('## [Enforced Execution Rules]');
      expect(wbDisk).toContain('NEVER offer discounts higher than 10%');
    });

    it('enforces Unicode-aware fail-closed credential sanitization before writing memory', () => {
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      // Attempt to save text with API keys, passwords, and tokens
      const fakeToken = ['sk', 'live', 'abcdef1234567890abcdef123456'].join('-');
      memoryManager.addEnforcedRule(`Admin API key is ${fakeToken} for authentication`);
      memoryManager.recordCustomerProfile('user@test.net', {
        traits: ['Password: SecretPassword123! and otp 987654 passed in chat']
      });

      const wbDisk = readFileSync(join(TEST_DIR, 'workbook.md'), 'utf-8');
      const nbDisk = readFileSync(join(TEST_DIR, 'notebook.md'), 'utf-8');

      expect(wbDisk).not.toContain(fakeToken);
      expect(wbDisk).toContain('[REDACTED_CREDENTIAL]');
      expect(nbDisk).not.toContain('SecretPassword123!');
      expect(nbDisk).toContain('[REDACTED_CREDENTIAL]');
    });

    it('flags context compaction when rules exceed safety threshold', () => {
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false,
        maxRulesThreshold: 3
      });

      expect(memoryManager.needsCompaction()).toBe(false);

      memoryManager.addEnforcedRule('Rule 1: Always check inventory');
      memoryManager.addEnforcedRule('Rule 2: Never give free delivery outside Cairo');
      memoryManager.addEnforcedRule('Rule 3: Always verify phone number');
      memoryManager.addEnforcedRule('Rule 4: Confirm payment method before order');

      expect(memoryManager.needsCompaction()).toBe(true);

      // Perform compaction
      memoryManager.compactWorkbook([
        'Consolidated: Verify inventory, phone, and payment before confirming any order; restrict free delivery to Cairo.'
      ]);

      expect(memoryManager.getWorkbook().enforcedRules.length).toBe(1);
      expect(memoryManager.needsCompaction()).toBe(false);
    });

    it('mirrors state transitions to SQLite WAL with version tracking', () => {
      const memoryStore = new MemoryStore({ dataDir: ':memory:' });
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        sqliteStore: memoryStore.getSqliteStore(),
        persistSqlite: true,
        brandId: 'brand_test_42'
      });

      memoryManager.addEnforcedRule('ALWAYS require IBAN receipt');
      memoryManager.recordBusinessInsight('High spike in Mansoura orders');

      const wbSqlite = memoryStore.getLearningState('brand_test_42', 'workbook');
      const nbSqlite = memoryStore.getLearningState('brand_test_42', 'notebook');

      expect(wbSqlite).toBeDefined();
      expect(wbSqlite?.content).toContain('ALWAYS require IBAN receipt');
      expect(wbSqlite?.version).toBeGreaterThan(0);

      expect(nbSqlite).toBeDefined();
      expect(nbSqlite?.content).toContain('Mansoura orders');
    });
  });

  describe('Task 2: The Asynchronous Reflection Loop (gemini-4-argon & Background Worker)', () => {
    it('executes high-reasoning reflection with thinking_config HIGH to detect self-correction and continuous learning', async () => {
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      let capturedOptions: any = null;
      const mockGeminiClient = {
        generateContent: async (_contents: any[], options: any) => {
          capturedOptions = options;
          return {
            text: JSON.stringify({
              selfCorrections: [
                {
                  incident: 'Agent offered 20% discount when policy only allows 5%',
                  rootCause: 'Lack of hard margin policy constraint',
                  correctiveAction: 'NEVER exceed 5% discount on WhatsApp chats without human operator approval'
                }
              ],
              newEnforcedRules: [
                'NEVER exceed 5% discount on WhatsApp chats without human operator approval'
              ],
              newBestPractices: [
                'When customer asks for price, answer within 2 lines and ask for delivery city'
              ],
              customerInsights: [
                {
                  chatId: '201018880000@s.whatsapp.net',
                  traits: ['High-value merchant from Mansoura', 'Prefers invoice via PDF'],
                  stage: 'negotiation'
                }
              ],
              threadSemanticSummary: 'Negotiated discounts; customer agreed to 5% with PDF invoice',
              businessSignals: [
                'Repeated customer interest in Mansoura regional delivery'
              ]
            })
          };
        }
      } as unknown as GeminiClient;

      const engine = new ReflectionEngine(mockGeminiClient, memoryManager, {
        model: 'gemini-4-argon'
      });

      const sampleChatLogs = [
        {
          id: 'm1',
          chatId: '201018880000@s.whatsapp.net',
          sender: '201018880000@s.whatsapp.net',
          text: 'ممكن تخفيض 20% على الطلبية دي لأني تاجر في المنصورة؟',
          timestamp: Date.now() - 60000,
          isFromMe: false,
          type: 'text'
        },
        {
          id: 'm2',
          chatId: '201018880000@s.whatsapp.net',
          sender: 'me',
          text: 'تمام هعملك خصم 20% حالاً',
          timestamp: Date.now() - 30000,
          isFromMe: true,
          type: 'text'
        }
      ] as ChatMessage[];

      const moderationFeedback = [
        {
          chatId: '201018880000@s.whatsapp.net',
          draftId: 'd1',
          feedbackType: 'rejected' as const,
          originalReply: 'تمام هعملك خصم 20% حالاً',
          humanNote: 'Rejected by owner: maximum allowable discount is 5%!'
        }
      ];

      const result = await engine.evaluateThread({
        chatId: '201018880000@s.whatsapp.net',
        messages: sampleChatLogs,
        moderationFeedback
      });

      expect(capturedOptions?.thinkingConfig?.thinkingLevel).toBe('HIGH');
      expect(capturedOptions?.model).toBe('gemini-4-argon');

      expect(result.selfCorrectionsDetected).toBe(1);
      expect(result.rulesAdded).toBe(1);

      const updatedWb = memoryManager.getWorkbook();
      expect(updatedWb.enforcedRules.some((r) => r.includes('5% discount'))).toBe(true);

      const updatedNb = memoryManager.getNotebook();
      expect(updatedNb.customerProfiles['201018880000@s.whatsapp.net']?.traits).toContain('High-value merchant from Mansoura');
    });

    it('background worker detects cold thread (15m idle) and triggers reflection offline without blocking', async () => {
      const memoryStore = new MemoryStore({ dataDir: ':memory:' });
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      let reflectionTriggered = false;
      const mockEngine = {
        evaluateThread: async (_params: any) => {
          reflectionTriggered = true;
          return {
            selfCorrectionsDetected: 0,
            rulesAdded: 1,
            factsAdded: 1,
            summary: 'Evaluated cold thread successfully'
          };
        }
      } as unknown as ReflectionEngine;

      const worker = new ReflectionWorker({
        memoryStore,
        memoryManager,
        reflectionEngine: mockEngine,
        idleThresholdMs: 50
      });

      const chatId = '201099999999@s.whatsapp.net';
      const pastTime = Date.now() - 100;

      memoryStore.addMessage({
        id: 'msg-cold-1',
        chatId,
        sender: chatId,
        text: 'السلام عليكم محتاج تفاصيل',
        timestamp: pastTime,
        isFromMe: false,
        type: 'text'
      });

      worker.recordActivity(chatId, pastTime);

      const sweepResult = await worker.sweepColdThreads();

      expect(sweepResult.evaluatedCount).toBe(1);
      expect(reflectionTriggered).toBe(true);
    });
  });

  describe('Task 3: Dynamic Injection Runtime & REST Management API', () => {
    it('dynamically injects latest workbook rules and notebook context into active system prompt', async () => {
      const memoryStore = new MemoryStore({ dataDir: ':memory:' });
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      memoryManager.addEnforcedRule('NEVER confirm payment without IBAN receipt');
      memoryManager.addBestPractice('Reply in friendly Egyptian dialect using short sentences');
      memoryManager.recordCustomerProfile('201055555555@s.whatsapp.net', {
        traits: ['Demands swift order dispatch to Alexandria'],
        stage: 'customer'
      });

      let capturedPrompt = '';
      let capturedSystemInstruction = '';

      const mockGemini = {
        generateContent: async (contents: any[], options: any) => {
          capturedPrompt = contents[0]?.parts[0]?.text || '';
          capturedSystemInstruction = options?.systemInstruction || '';
          return {
            text: JSON.stringify({
              action: 'reply',
              intent: 'general_faq',
              replyText: 'أهلاً بك، تم استلام طلبك للإسكندرية',
              confidence: 0.95
            })
          };
        }
      } as unknown as GeminiClient;

      const moderator = new ModeratorAgent(mockGemini, memoryStore, {
        dualMemoryManager: memoryManager
      });

      const inboundMsg: ChatMessage = {
        id: 'inbound-123',
        chatId: '201055555555@s.whatsapp.net',
        sender: '201055555555@s.whatsapp.net',
        text: 'عاوز اعرف هتبعتوا الأوردر إمتى لإسكندرية؟',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      };

      const result = await moderator.processInboundMessage(inboundMsg);

      expect(result.decision.action).toBe('reply');
      expect(capturedSystemInstruction).toContain('NEVER confirm payment without IBAN receipt');
      expect(capturedSystemInstruction).toContain('Reply in friendly Egyptian dialect using short sentences');
      expect(capturedPrompt).toContain('Demands swift order dispatch to Alexandria');
    });

    it('exposes /api/learning REST endpoints for state inspect, rule update, and on-demand reflection', async () => {
      const memoryStore = new MemoryStore({ dataDir: ':memory:' });
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      const mockGemini = {
        generateContent: async () => ({ text: JSON.stringify({ action: 'reply' }) })
      } as unknown as GeminiClient;

      const moderatorAgent = new ModeratorAgent(mockGemini, memoryStore, {
        dualMemoryManager: memoryManager
      });

      const mockEngine = {
        evaluateThread: async () => ({
          selfCorrectionsDetected: 0,
          rulesAdded: 0,
          bestPracticesAdded: 0,
          factsAdded: 0,
          summary: 'OK'
        }),
        performCompaction: async () => true
      } as unknown as ReflectionEngine;

      const reflectionWorker = new ReflectionWorker({
        memoryStore,
        memoryManager,
        reflectionEngine: mockEngine
      });

      const mockSocket = {
        getState: () => ({ status: 'connected' }),
        sendMessage: async () => ({ messageId: 'm-out' }),
        sendVoiceNote: async () => ({ messageId: 'm-voice' })
      } as unknown as WhatsAppSocketClient;

      const sse = new SSEBroadcaster();

      const app = createApiServer({
        memoryStore,
        whatsappClient: mockSocket,
        moderatorAgent,
        sse,
        dualMemoryManager: memoryManager,
        reflectionWorker,
        reflectionEngine: mockEngine
      });

      const stateRes = await app.request('/api/learning/state');
      expect(stateRes.status).toBe(200);
      const stateData: any = await stateRes.json();
      expect(stateData.workbook).toBeDefined();
      expect(stateData.notebook).toBeDefined();
      expect(stateData.needsCompaction).toBe(false);

      const putRes = await app.request('/api/learning/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: 'ALWAYS verify customer payment slip' })
      });
      expect(putRes.status).toBe(200);
      const putData: any = await putRes.json();
      expect(putData.success).toBe(true);
      expect(putData.workbook.enforcedRules).toContain('ALWAYS verify customer payment slip');

      const compactRes = await app.request('/api/learning/compact', { method: 'POST' });
      expect(compactRes.status).toBe(200);
      const compactData: any = await compactRes.json();
      expect(compactData.success).toBe(true);
      expect(compactData.compacted).toBe(true);
    });

    it('captures operator draft rejection & edits and queues feedback for reflection worker', async () => {
      const memoryStore = new MemoryStore({ dataDir: ':memory:' });
      const memoryManager = new DualMemoryManager({
        storageDir: TEST_DIR,
        persistSqlite: false
      });

      let recordedFeedback: any = null;
      const reflectionWorker = {
        recordModerationFeedback: (fb: any) => {
          recordedFeedback = fb;
        },
        recordActivity: () => {},
        reflectOnThread: async () => null,
        sweepColdThreads: async () => ({ evaluatedCount: 0, results: [] })
      } as unknown as ReflectionWorker;

      const mockGemini = {
        generateContent: async () => ({ text: '{}' })
      } as unknown as GeminiClient;

      const moderatorAgent = new ModeratorAgent(mockGemini, memoryStore);

      const mockSocket = {
        getState: () => ({ status: 'connected' }),
        sendMessage: async () => ({ messageId: 'm-out' })
      } as unknown as WhatsAppSocketClient;

      const sse = new SSEBroadcaster();

      const app = createApiServer({
        memoryStore,
        whatsappClient: mockSocket,
        moderatorAgent,
        sse,
        dualMemoryManager: memoryManager,
        reflectionWorker
      });

      memoryStore.saveDraft({
        id: 'draft-999',
        chatId: '201011112222@s.whatsapp.net',
        incomingMessageId: 'in-999',
        incomingText: 'ممكن تخفيض 30%؟',
        proposedReply: 'تمام أقدر أعملك تخفيض 30%',
        reasoning: 'Customer asked for discount',
        confidence: 0.85,
        status: 'pending',
        createdAt: Date.now()
      });

      const approveRes = await app.request('/api/drafts/draft-999/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyText: 'للأسف الحد الأقصى للتخفيض 5% فقط' })
      });

      expect(approveRes.status).toBe(200);
      expect(recordedFeedback).toBeDefined();
      expect(recordedFeedback.feedbackType).toBe('edited');
      expect(recordedFeedback.originalReply).toBe('تمام أقدر أعملك تخفيض 30%');
      expect(recordedFeedback.revisedReply).toBe('للأسف الحد الأقصى للتخفيض 5% فقط');
    });
  });
});
