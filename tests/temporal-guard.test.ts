import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'bun:test';
import {
  auditTemporalAnswer,
  buildTemporalEnvelope,
  classifyFreshness,
  clockTruth,
  createEvidenceReceipt,
  createGeminiTemporalGuard,
  formatEnvelopeForAgent,
  formatRelativeAge,
  isEvidenceExpired,
  mergeEvidenceReceipts
} from '../src/ai/temporal-guard';
import { routeTurnModel } from '../src/ai/model-router';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import type { GeminiClient } from '../src/ai/gemini-client';
import { MemoryStore } from '../src/domain/memory-store';
import type { ChatMessage } from '../src/domain/types';
import { WebScout } from '../src/agent/web-scout';
import { BoundedPlanner } from '../src/agent/bounded-planner';
import { ActionJournal, ToolRegistry } from '../src/agent/tools';
import { createWhatsAppMcpServer } from '../src/mcp/server';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

function readText(result: unknown): unknown {
  const content = typeof result === 'object' && result !== null && 'content' in result ? result.content : undefined;
  const first: unknown = Array.isArray(content) ? content[0] : undefined;
  if (typeof first !== 'object' || first === null || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('Expected MCP text content');
  }
  return JSON.parse(first.text);
}

const FIXED_NOW = Date.parse('2026-11-26T09:17:32.000Z');

describe('NowGuard Temporal Freshness & Real-Time Awareness', () => {
  it('rejects evidence whose supported claims are not strings', () => {
    const receipt = createEvidenceReceipt({ source: 'status', supports: ['available'] });
    const merged = mergeEvidenceReceipts([{ ...receipt, supports: [42] }]);
    expect(merged.invalidReceipts).toHaveLength(1);
    expect(merged.validReceipts).toHaveLength(0);
  });

  it('produces authoritative clock observation and compact relative ages', () => {
    const clock = clockTruth({ now: FIXED_NOW, timezone: 'Africa/Cairo' });
    expect(clock.observedAt).toBe('2026-11-26T09:17:32.000Z');
    expect(clock.timezone).toBe('Africa/Cairo');
    expect(clock.isoDate).toBe('2026-11-26');
    expect(clock.dayOfWeek).toBe('Thursday');

    expect(formatRelativeAge(FIXED_NOW - 15_000, FIXED_NOW)).toBe('just now');
    expect(formatRelativeAge(FIXED_NOW - 5 * 60_000, FIXED_NOW)).toBe('5m ago');
    expect(formatRelativeAge(FIXED_NOW - 3 * 3600_000, FIXED_NOW)).toBe('3h ago');
    expect(formatRelativeAge(FIXED_NOW - 4 * 86400_000, FIXED_NOW)).toBe('4d ago');
  });

  it('classifies freshness with ordered precedence and defuses STATIC traps', () => {
    // Provided-content trap defusal
    expect(classifyFreshness('Summarize the latest chapter I pasted below').freshnessClass).toBe('STATIC');
    expect(classifyFreshness('لخص النص المرفق عن آخر الأخبار').freshnessClass).toBe('STATIC');

    // Historical retrospective defusal
    expect(classifyFreshness('Who won the World Cup in 2018?').freshnessClass).toBe('STATIC');

    // Hard live signals (English + Arabic WhatsApp business)
    const liveEn = classifyFreshness('What is the Bitcoin price right now?');
    expect(liveEn.freshnessClass).toBe('LIVE');
    expect(liveEn.detectedDomains).toContain('financial');

    expect(classifyFreshness('هل انتم فاتحين دلوقتي؟').freshnessClass).toBe('LIVE');
    expect(classifyFreshness('الساعة كام دلوقتي؟').freshnessClass).toBe('LIVE');

    // Explicit version target
    expect(classifyFreshness('How does Next.js 14 middleware work?').freshnessClass).toBe('VERSIONED');

    // Volatile drift
    expect(classifyFreshness('What are the recommended best practices for React auth?').freshnessClass).toBe('VOLATILE');

    // Conceptual static
    expect(classifyFreshness('Explain how binary search works').freshnessClass).toBe('STATIC');
  });

  it('audits temporal answers against stale years, spoofed citations, and ungrounded LIVE claims', () => {
    const envelope = buildTemporalEnvelope('What is the stock price right now?', { now: FIXED_NOW, timezone: 'UTC' });
    expect(envelope.evidenceRequired).toBe(true);
    expect(formatEnvelopeForAgent(envelope)).toContain('[NOWGUARD TEMPORAL ENVELOPE]');

    // Stale year block
    const stale = auditTemporalAnswer('In the current year 2024, the price is $100.', envelope);
    expect(stale.pass).toBe(false);
    expect(stale.severity).toBe('block');
    expect(stale.staleYearDetected).toBe(true);

    // Spoofed citation block
    const spoofed = auditTemporalAnswer('The current price is $100 [1].', envelope);
    expect(spoofed.pass).toBe(false);
    expect(spoofed.severity).toBe('block');
    expect(spoofed.spoofedEvidence).toBe(true);

    // Ungrounded current claim block
    const ungrounded = auditTemporalAnswer('The stock is trading at $100 right now.', envelope);
    expect(ungrounded.pass).toBe(false);
    expect(ungrounded.severity).toBe('block');

    // Real URL passes
    const grounded = auditTemporalAnswer('The stock is trading at $100 per https://finance.yahoo.com/quote/AAPL', envelope);
    expect(grounded.pass).toBe(true);
    expect(grounded.severity).toBe('pass');

    // An authority containing credentials is not a source URL.
    const forged = auditTemporalAnswer('The current price is $100 https://example.com@localhost/', envelope);
    expect(forged.pass).toBe(false);
    expect(forged.evidenceMarker).toBe(false);
    const malformed = auditTemporalAnswer('The current price is $100 https://example.com.' + 'x'.repeat(64), envelope);
    expect(malformed.pass).toBe(false);
    const punctuated = auditTemporalAnswer('The current price is $100 (https://docs.example.com).', envelope);
    expect(punctuated.pass).toBe(true);

    // Uncertainty disclosure passes
    const disclosed = auditTemporalAnswer('Live verification was not possible; please check the official exchange.', envelope);
    expect(disclosed.pass).toBe(true);
  });

  it('creates, validates, expires, and merges EvidenceReceipts by source authority', () => {
    const toolReceipt = createEvidenceReceipt({
      kind: 'native-live-tool',
      source: 'inventory.lookup',
      supports: ['SKU-1 in stock'],
      observedAt: FIXED_NOW,
      expiresAt: FIXED_NOW + 60_000
    });
    const secondaryReceipt = createEvidenceReceipt({
      kind: 'secondary-source',
      source: 'https://blog.example.com/post',
      supports: ['General info'],
      observedAt: FIXED_NOW - 120_000,
      expiresAt: FIXED_NOW - 1_000
    });

    expect(isEvidenceExpired(toolReceipt, FIXED_NOW)).toBe(false);
    expect(isEvidenceExpired(secondaryReceipt, FIXED_NOW)).toBe(true);

    const merged = mergeEvidenceReceipts([secondaryReceipt, toolReceipt, { invalid: true }], { now: FIXED_NOW });
    expect(merged.validReceipts).toHaveLength(1);
    expect(merged.validReceipts[0]?.source).toBe('inventory.lookup');
    expect(merged.expiredReceipts).toHaveLength(1);
    expect(merged.invalidReceipts).toHaveLength(1);
  });

  it('provides Gemini middleware adapter beforeGenerateContent and afterGenerateContent', () => {
    const guard = createGeminiTemporalGuard({ now: () => FIXED_NOW, timezone: 'UTC' });
    const req = guard.beforeGenerateContent({
      prompt: 'Is the service down right now?',
      systemInstruction: 'Base persona'
    });
    expect(req.envelope.freshnessClass).toBe('LIVE');
    expect(req.systemInstruction).toContain('Base persona');
    expect(req.systemInstruction).toContain('2026-11-26T09:17:32.000Z');

    const audit = guard.afterGenerateContent({
      text: 'The service is currently down [cite].',
      envelope: req.envelope
    });
    expect(audit.severity).toBe('block');
    expect(audit.spoofedEvidence).toBe(true);
  });

  it('ModeratorAgent injects clock truth, relative history ages, and fails closed to draft on unverified LIVE claims', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    // Seed a prior message 2 hours before FIXED_NOW
    memory.addMessage({
      id: 'prev_1',
      chatId: 'cust1@s.whatsapp.net',
      sender: 'cust1@s.whatsapp.net',
      senderName: 'سارة',
      text: 'أهلاً، عايزة أسأل عن السيرفر',
      timestamp: FIXED_NOW - 2 * 3600_000,
      isFromMe: false,
      type: 'text'
    });

    let capturedPrompt = '';
    let callCount = 0;
    const mockGemini: Pick<GeminiClient, 'generateContent'> = {
      generateContent: async (contents) => {
        callCount += 1;
        capturedPrompt = JSON.stringify(contents);
        return {
          text: JSON.stringify({
            action: 'reply',
            intent: 'general_faq',
            replyText: 'السيرفر شغال حالياً بدون أي مشاكل.',
            reasoning: 'Assumed status',
            confidence: 0.95
          })
        };
      }
    };

    const agent = new ModeratorAgent(mockGemini, memory, {
      now: () => FIXED_NOW,
      timezone: 'Africa/Cairo',
      router: (request) => routeTurnModel({ ...request, apiKey: '', fetchFn: async () => { throw new Error('Unexpected router fetch'); } })
    });

    const incoming: ChatMessage = {
      id: 'msg_live_1',
      chatId: 'cust1@s.whatsapp.net',
      sender: 'cust1@s.whatsapp.net',
      senderName: 'سارة',
      text: 'هل السيرفر واقع دلوقتي؟',
      timestamp: FIXED_NOW,
      isFromMe: false,
      type: 'text'
    };

    const result = await agent.processInboundMessage(incoming);

    // Clock & relative age injected into per-turn prompt (keeping systemInstruction cache-stable)
    expect(capturedPrompt).toContain('[NOWGUARD TEMPORAL ENVELOPE]');
    expect(capturedPrompt).toContain('2026-11-26T09:17:32.000Z');
    expect(capturedPrompt).toContain('2h ago');
    expect(capturedPrompt).toContain('Thursday');

    // Bounded 1 retry occurred and then failed safe to draft because claim remained ungrounded
    expect(callCount).toBe(2);
    expect(result.decision.temporalEnvelope?.freshnessClass).toBe('LIVE');
    expect(result.decision.temporalAudit?.severity).toBe('block');
    expect(result.decision.action).toBe('draft');
    expect(result.shouldSendImmediately).toBe(false);
    expect(result.draftCreated).toBeDefined();
  });

  it('WebScout and BoundedPlanner inject authoritative clock truth', async () => {
    const scoutCalls: string[] = [];
    const scoutModel: ConstructorParameters<typeof WebScout>[0] = {
      generateContent: async (contents) => {
        scoutCalls.push(JSON.stringify(contents));
        return {
          text: 'Confirmed',
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://status.example.com/live', title: 'Status' } }]
          }
        };
      }
    };
    const scout = new WebScout(scoutModel, () => FIXED_NOW);
    const scoutRes = await scout.search({ question: 'Is example.com down right now?', freshnessNeed: 'current' });
    expect(scoutCalls[0]).toContain('2026-11-26T09:17:32.000Z');
    expect(scoutRes.freshnessClass).toBe('LIVE');
    expect(scoutRes.receipts).toHaveLength(1);

    const plannerCalls: Array<string | undefined> = [];
    const journal = new ActionJournal({ dbPath: ':memory:' });
    const registry = new ToolRegistry(journal);
    registry.register('b1', {
      name: 'order.read',
      kind: 'read',
      scope: 'orders:read',
      description: 'Read order',
      parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] },
      validate: (v): v is { id: string } => typeof v === 'object' && v !== null && 'id' in v,
      execute: async ({ id }) => ({ id, status: 'shipped' })
    });
    const plannerModel: ConstructorParameters<typeof BoundedPlanner>[0]['model'] = {
      generateContent: async (_c, opts) => {
        plannerCalls.push(opts?.systemInstruction);
        return { text: 'ممكن رقم الطلب؟' };
      }
    };
    const planner = new BoundedPlanner({
      model: plannerModel,
      registry,
      journal
    });
    await planner.run({
      brandId: 'b1',
      contactId: 'c1',
      goal: 'عايز أعرف حالة طلبي النهارده',
      allowedScopes: ['orders:read']
    });
    expect(plannerCalls[0]).toContain('Authoritative current time:');
  });

  it('MCP server exposes read-only whatsapp_get_current_time and whatsapp_check_temporal_freshness tools', async () => {
    const memoryStore = new MemoryStore({ dataDir: ':memory:' });
    const server = createWhatsAppMcpServer({
      memoryStore,
      whatsappClient: new WhatsAppSocketClient(),
      moderatorAgent: new ModeratorAgent({
        generateContent: async () => { throw new Error('Unexpected Gemini call'); }
      }, memoryStore),
      readOnly: true
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'temporal-guard-test', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain('whatsapp_get_current_time');
      expect(names).toContain('whatsapp_check_temporal_freshness');

      const timeRes = await client.callTool({
        name: 'whatsapp_get_current_time', arguments: { timezone: 'UTC' }
      });
      const freshRes = await client.callTool({
        name: 'whatsapp_check_temporal_freshness', arguments: { prompt: 'هل انتم فاتحين دلوقتي؟' }
      });
      const time = readText(timeRes);
      expect(time).toMatchObject({ timezone: 'UTC', observedAt: expect.any(String) });
      if (typeof time !== 'object' || time === null || !('observedAt' in time)) throw new Error('Missing observedAt');
      expect(time.observedAt).toBeTruthy();
      expect(readText(freshRes)).toMatchObject({ freshnessClass: 'LIVE', evidenceRequired: true });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
