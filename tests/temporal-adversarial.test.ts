import { describe, expect, it } from 'bun:test';
import {
  auditTemporalAnswer,
  buildTemporalEnvelope,
  classifyFreshness,
  clockTruth,
  createEvidenceReceipt,
  mergeEvidenceReceipts
} from '../src/ai/temporal-guard';
import { GeminiClient } from '../src/ai/gemini-client';
import { McpClientManager } from '../src/mcp/client-manager';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage } from '../src/domain/types';
import { shouldUseWebScout } from '../src/agent/web-scout';

const FIXED_NOW = Date.parse('2026-11-26T09:17:32.000Z');

const BLIND_ADVERSARIAL_CASES: Array<{ id: string; prompt: string; expected: 'STATIC' | 'VERSIONED' | 'VOLATILE' | 'LIVE' }> = [
  { id: 'blind-implicit-now-outage', prompt: 'Is GitHub having problems reaching the API for anyone else?', expected: 'LIVE' },
  { id: 'blind-implicit-now-price', prompt: 'How much does a Claude Pro seat run these days?', expected: 'VOLATILE' },
  { id: 'blind-paraphrase-latest', prompt: 'Which release of Next.js should I reach for on a fresh project?', expected: 'VOLATILE' },
  { id: 'blind-officeholder-implicit', prompt: 'Who is running the Federal Reserve right now?', expected: 'LIVE' },
  { id: 'blind-weather-paraphrase', prompt: 'Should I bring an umbrella to Cairo tomorrow?', expected: 'LIVE' },
  { id: 'blind-deprecation-paraphrase', prompt: 'Has the old callback style of the AWS SDK been phased out yet?', expected: 'VOLATILE' },
  { id: 'blind-cve-implicit', prompt: 'Any known way to break into log4j lately that I should patch against?', expected: 'VOLATILE' },
  { id: 'blind-static-trap-version-history', prompt: 'Explain how semantic versioning assigns 1.2.3 style numbers', expected: 'STATIC' },
  { id: 'blind-static-trap-install-concept', prompt: "In general terms, what does 'npm install' actually do under the hood?", expected: 'STATIC' },
  { id: 'blind-static-trap-pricing-concept', prompt: 'Explain the difference between fixed pricing and dynamic pricing models', expected: 'STATIC' },
  { id: 'blind-static-trap-security-concept', prompt: 'What is a SQL injection and why does it work?', expected: 'STATIC' },
  { id: 'blind-static-trap-law-concept', prompt: 'What is the general principle behind copyright fair use?', expected: 'STATIC' },
  { id: 'blind-live-crypto-implicit', prompt: "What's Bitcoin sitting at?", expected: 'LIVE' },
  { id: 'blind-versioned-pinned', prompt: "I'm locked to Django 3.2, how do I configure ASGI there?", expected: 'VERSIONED' },
  { id: 'blind-volatile-recommended-sdk', prompt: "What's the recommended way to authenticate with the OpenAI API today?", expected: 'VOLATILE' },
  { id: 'blind-live-standings', prompt: "Who's top of the Premier League table?", expected: 'LIVE' },
  { id: 'blind-retro-vs-live', prompt: 'Who won the 2018 World Cup?', expected: 'STATIC' },
  { id: 'blind-retro-edge-recent', prompt: 'Who is the current champion of the Premier League?', expected: 'LIVE' },
  { id: 'blind-ar-implicit-price', prompt: 'بكام اشتراك يوتيوب بريميوم دلوقتي؟', expected: 'LIVE' },
  { id: 'blind-ar-latest-version', prompt: 'أنهي إصدار من بايثون المفروض أستخدمه في مشروع جديد؟', expected: 'VOLATILE' },
  { id: 'blind-ar-outage', prompt: 'هل في مشكلة في السيرفرات عندكم؟', expected: 'LIVE' },
  { id: 'blind-ar-static-concept', prompt: 'اشرح لي الفرق بين HTTP و HTTPS', expected: 'STATIC' },
  { id: 'blind-ar-retro', prompt: 'مين كسب كأس العالم سنة 2010؟', expected: 'STATIC' },
  { id: 'blind-volatile-model-availability', prompt: 'Can I still use gpt-4 through the API or was it retired?', expected: 'VOLATILE' },
  { id: 'blind-live-service-health', prompt: 'Is Cloudflare down?', expected: 'LIVE' },
  { id: 'blind-versioned-implicit-node', prompt: 'On Node 18 does top-level await work in CommonJS?', expected: 'VERSIONED' },
  { id: 'blind-volatile-changed-behavior', prompt: 'Did the Stripe webhook signature format change recently?', expected: 'VOLATILE' },
  { id: 'blind-static-trap-latest-metaphor', prompt: 'Summarize the latest chapter of the book I pasted below', expected: 'STATIC' },
  { id: 'blind-static-algorithm', prompt: 'Walk me through how quicksort partitions an array', expected: 'STATIC' },
  { id: 'blind-live-news', prompt: 'What happened with the OpenAI board this week?', expected: 'LIVE' },
  { id: 'blind-volatile-tax', prompt: "What's the corporate tax rate I should plan for?", expected: 'VOLATILE' },
  { id: 'blind-live-flight', prompt: 'Is my flight MS985 on time?', expected: 'LIVE' },
  { id: 'blind-volatile-eol', prompt: 'When does support end for Python 3.8?', expected: 'VERSIONED' },
  { id: 'blind-static-trap-regex', prompt: 'Write a regex that matches an email address', expected: 'STATIC' },
  { id: 'blind-volatile-best-practice-drift', prompt: "What's the current best practice for storing passwords?", expected: 'VOLATILE' },
  { id: 'blind-live-restaurant', prompt: 'Is that restaurant open right now?', expected: 'LIVE' },
  { id: 'blind-static-history-of-tech', prompt: 'Give me a brief history of the C programming language', expected: 'STATIC' },
  { id: 'blind-volatile-api-limits', prompt: 'What are the rate limits on the Anthropic API?', expected: 'VOLATILE' },
  { id: 'blind-static-trap-current-in-math', prompt: 'In electronics, how is current measured in a circuit?', expected: 'STATIC' },
  { id: 'blind-live-covid', prompt: 'Are there any travel restrictions into Japan at the moment?', expected: 'LIVE' },
  { id: 'blind-versioned-tailwind', prompt: 'How do I configure the theme in Tailwind v4?', expected: 'VERSIONED' },
  { id: 'blind-volatile-deprecation-implicit', prompt: 'Should I still be using moment.js for new code?', expected: 'VOLATILE' },
  { id: 'blind-live-stock-implicit', prompt: "How's Tesla doing on the market today?", expected: 'LIVE' },
  { id: 'blind-static-trap-summarize', prompt: 'Summarize the current state of this document for me', expected: 'STATIC' }
];

const HOLDOUT_CASES: Array<{ id: string; prompt: string; expected: 'STATIC' | 'VERSIONED' | 'VOLATILE' | 'LIVE' }> = [
  { id: 'holdout-static-bubble-sort', prompt: 'Write a pure function in TypeScript for bubble sort algorithm', expected: 'STATIC' },
  { id: 'holdout-static-latin-translate', prompt: "Translate 'Carpe Diem' to English and explain its philosophical meaning", expected: 'STATIC' },
  { id: 'holdout-static-history-rome', prompt: 'What caused the fall of the Western Roman Empire in 476 AD?', expected: 'STATIC' },
  { id: 'holdout-static-arabic-rhetoric', prompt: 'ما هو علم البيان في البلاغة العربية مع أمثلة للتوضيح؟', expected: 'STATIC' },
  { id: 'holdout-static-calculus-integral', prompt: 'Solve this indefinite integral: integral of sin(x) dx', expected: 'STATIC' },
  { id: 'holdout-version-react-native', prompt: 'For React Native 0.74, how does the New Architecture enable TurboModules?', expected: 'VERSIONED' },
  { id: 'holdout-version-bun', prompt: 'Target Bun 1.1.0 and explain its WebSocket server implementation', expected: 'VERSIONED' },
  { id: 'holdout-version-flask', prompt: 'Configure Flask 3.0 blueprints for a microservice application', expected: 'VERSIONED' },
  { id: 'holdout-version-angular', prompt: 'Explain signal inputs introduced in Angular 17.1', expected: 'VERSIONED' },
  { id: 'holdout-version-arabic', prompt: 'كيفية عمل الـ routing في إصدار 14.1 لتطبيق الويب؟', expected: 'VERSIONED' },
  { id: 'holdout-volatile-npm-security', prompt: 'Install the dependencies and run an audit for security vulnerabilities', expected: 'VOLATILE' },
  { id: 'holdout-volatile-tax-compliance', prompt: 'What tax regulation applies to SaaS billing across EU countries?', expected: 'VOLATILE' },
  { id: 'holdout-volatile-oauth-flow', prompt: 'Configure the OAuth authorization server and verify token endpoint policy', expected: 'VOLATILE' },
  { id: 'holdout-volatile-stripe-pricing', prompt: 'What are the transaction costs and fees for international cards on Stripe?', expected: 'VOLATILE' },
  { id: 'holdout-volatile-arabic-deps', prompt: 'قم بإعداد مكتبات المشروع وتثبيت حزم التبعيات المطلوبة', expected: 'VOLATILE' },
  { id: 'holdout-live-nasdaq', prompt: "What is Apple's market capitalization right now?", expected: 'LIVE' },
  { id: 'holdout-live-tokyo-time', prompt: 'What is the exact current time in Tokyo right now?', expected: 'LIVE' },
  { id: 'holdout-live-gold-arabic', prompt: 'ما هو سعر جرام الذهب عيار 21 اليوم في السوق؟', expected: 'LIVE' },
  { id: 'holdout-live-system-status', prompt: 'Is GitHub Actions experiencing any live degradation today?', expected: 'LIVE' },
  { id: 'holdout-live-olympics-score', prompt: 'What is the live medal count standings today?', expected: 'LIVE' }
];

describe('Aggressive & Red-Team Behavioral Temporal Tests', () => {
  it('test_blind_adversarial_suite_achieves_zero_false_static_and_full_accuracy', () => {
    const failures: Array<{ id: string; expected: string; actual: string }> = [];
    for (const c of BLIND_ADVERSARIAL_CASES) {
      const actual = classifyFreshness(c.prompt).freshnessClass;
      if (actual !== c.expected) {
        failures.push({ id: c.id, expected: c.expected, actual });
      }
    }
    expect(failures).toEqual([]);
  });

  it('test_holdout_suite_achieves_full_accuracy', () => {
    const failures: Array<{ id: string; expected: string; actual: string }> = [];
    for (const c of HOLDOUT_CASES) {
      const actual = classifyFreshness(c.prompt).freshnessClass;
      if (actual !== c.expected) {
        failures.push({ id: c.id, expected: c.expected, actual });
      }
    }
    expect(failures).toEqual([]);
  });

  it('test_redos_adversarial_100kb_prompt_completes_under_50ms', () => {
    const evilPrompt = 'is ' + 'a '.repeat(50_000) + 'working right now?';
    const t0 = performance.now();
    const res = classifyFreshness(evilPrompt);
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(50);
    expect(res.freshnessClass).toBe('STATIC'); // capped at 4096 chars before 'working right now?'
  });

  it('test_spoofed_evidence_markers_fail_audit_closed_on_live_claims', () => {
    const env = buildTemporalEnvelope('What is the gold price today?', { now: FIXED_NOW, timezone: 'UTC' });
    const spoofCases = [
      'Gold is trading at $2,650 today [1].',
      'Gold is trading at $2,650 today [cite].',
      'Per the source, gold is trading at $2,650 today.',
      'The year is now 2024 and gold is $2,650.'
    ];
    for (const answer of spoofCases) {
      const audit = auditTemporalAnswer(answer, env);
      expect(audit.pass).toBe(false);
      expect(audit.severity).toBe('block');
    }
  });

  it('test_moderator_remediation_retry_ships_reply_when_model_self_corrects', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    let attempt = 0;
    const promptsSeen: string[] = [];
    const gemini = new GeminiClient();
    gemini.generateContent = async (contents) => {
      attempt += 1;
      promptsSeen.push(JSON.stringify(contents));
      if (attempt === 1) {
        return {
          text: JSON.stringify({
            action: 'reply',
            intent: 'general_faq',
            replyText: 'In the current year 2024, our service is online.',
            reasoning: 'Initial stale year response',
            confidence: 0.95
          })
        };
      }
      return {
        text: JSON.stringify({
          action: 'reply',
          intent: 'general_faq',
          replyText: 'Live verification was not possible right now; please check https://status.example.com.',
          reasoning: 'Corrected with grounded URL and disclosure',
          confidence: 0.92
        })
      };
    };

    const agent = new ModeratorAgent(gemini, memory, { now: () => FIXED_NOW, timezone: 'UTC' });
    const msg: ChatMessage = {
      id: 'retry_1',
      chatId: 'user_retry@s.whatsapp.net',
      sender: 'user_retry@s.whatsapp.net',
      text: 'Is the service down right now?',
      timestamp: FIXED_NOW,
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(msg);
    expect(attempt).toBe(2);
    expect(promptsSeen[1]).toContain('[NOWGUARD AUDIT REMEDIATION]');
    expect(result.decision.action).toBe('reply');
    expect(result.decision.temporalAudit?.pass).toBe(true);
    expect(result.shouldSendImmediately).toBe(true);
  });

  it('test_moderator_mcp_tool_failure_does_not_count_as_verified_evidence_and_downgrades_to_draft', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    const toolCalls: Array<Parameters<McpClientManager['callTool']>> = [];
    const mcpClientManager = new McpClientManager();
    mcpClientManager.listAvailableTools = () => [{
      namespacedName: 'erp__check_stock',
      serverName: 'erp',
      rawToolName: 'check_stock',
      description: 'Check live stock',
      risk: 'readOnly',
      requiresHumanApproval: false,
      inputSchema: { type: 'object', properties: { sku: { type: 'string' } } }
    }];
    mcpClientManager.callTool = async (...args) => {
      toolCalls.push(args);
      return { ok: false, content: null, error: 'ERP timeout', durationMs: 10 };
    };
    const gemini = new GeminiClient();
    gemini.generateContent = async () => {
      if (toolCalls.length === 0) {
        return {
          text: '',
          functionCalls: [{ name: 'erp__check_stock', args: { sku: 'SKU-1' } }]
        };
      }
      return {
        text: JSON.stringify({
          action: 'reply',
          intent: 'general_faq',
          replyText: 'المنتج متوفر حالياً في المخزن.',
          reasoning: 'Guessed availability despite tool failure',
          confidence: 0.95
        })
      };
    };

    const agent = new ModeratorAgent(gemini, memory, {
      mcpClientManager,
      now: () => FIXED_NOW,
      timezone: 'Africa/Cairo'
    });
    const msg: ChatMessage = {
      id: 'mcp_fail_1',
      chatId: 'user_mcp@s.whatsapp.net',
      sender: 'user_mcp@s.whatsapp.net',
      text: 'هل المنتج متاح دلوقتي؟',
      timestamp: FIXED_NOW,
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(msg);
    expect(toolCalls).toHaveLength(1);
    expect(result.decision.action).toBe('draft');
    expect(result.decision.temporalAudit?.severity).toBe('block');
    expect(result.shouldSendImmediately).toBe(false);
    expect(result.draftCreated).toBeDefined();
  });

  it('test_moderator_human_mode_never_sends_or_creates_draft_even_on_live_prompt', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    memory.setChatMode('human_only@s.whatsapp.net', 'human');
    const gemini = new GeminiClient();
    gemini.generateContent = async () => ({
      text: JSON.stringify({
        action: 'reply',
        intent: 'general_faq',
        replyText: 'الخدمة متاحة الآن.',
        confidence: 0.9
      })
    });
    const agent = new ModeratorAgent(gemini, memory, { now: () => FIXED_NOW, timezone: 'UTC' });
    const result = await agent.processInboundMessage({
      id: 'human_1',
      chatId: 'human_only@s.whatsapp.net',
      sender: 'human_only@s.whatsapp.net',
      text: 'هل السيرفر واقع دلوقتي؟',
      timestamp: FIXED_NOW,
      isFromMe: false,
      type: 'text'
    });
    expect(result.shouldSendImmediately).toBe(false);
    expect(result.draftCreated).toBeUndefined();
  });

  it('test_invalid_timezone_falls_back_gracefully_without_throwing', () => {
    const obs = clockTruth({ now: FIXED_NOW, timezone: 'Invalid/Zone_999' });
    expect(obs.observedAt).toBe('2026-11-26T09:17:32.000Z');
    expect(obs.isoDate).toBe('2026-11-26');
    expect(obs.dayOfWeek).toBe('Thursday');
  });

  it('test_web_scout_routing_blocks_internal_brand_queries_even_with_live_keywords', () => {
    expect(shouldUseWebScout('مواعيد الفرع عندكم دلوقتي؟')).toBe(false);
    expect(shouldUseWebScout('What is my order status right now?')).toBe(false);
    expect(shouldUseWebScout('Is Cloudflare down?')).toBe(true);
  });

  it('test_evidence_receipt_merge_ranks_native_tool_first_and_drops_expired', () => {
    const expired = createEvidenceReceipt({
      kind: 'official-documentation',
      source: 'https://docs.example.com/old',
      supports: ['Old policy'],
      observedAt: FIXED_NOW - 100_000,
      expiresAt: FIXED_NOW - 1_000
    });
    const web = createEvidenceReceipt({
      kind: 'primary-source',
      source: 'https://status.example.com',
      supports: ['Status ok'],
      observedAt: FIXED_NOW
    });
    const native = createEvidenceReceipt({
      kind: 'native-live-tool',
      source: 'inventory.lookup',
      supports: ['SKU-1 stock=5'],
      observedAt: FIXED_NOW
    });
    const merged = mergeEvidenceReceipts([web, expired, native], { now: FIXED_NOW });
    expect(merged.expiredReceipts).toHaveLength(1);
    expect(merged.validReceipts.map((r) => r.kind)).toEqual(['native-live-tool', 'primary-source']);
  });
});
