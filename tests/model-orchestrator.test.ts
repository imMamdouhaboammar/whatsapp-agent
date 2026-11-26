import { afterEach, describe, expect, it } from 'bun:test';
import { orchestrateModel, toRoutingTrace } from '../src/ai/model-orchestrator';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { MemoryStore } from '../src/domain/memory-store';
import type { GeminiClient } from '../src/ai/gemini-client';
import type { ChatMessage } from '../src/domain/types';

const stores: MemoryStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ModelOrchestrator', () => {
  it('routes trivial Arabic and English greetings to gemini-4-hydrogen (fast_responder)', () => {
    const ar = orchestrateModel({
      message: { text: 'السلام عليكم', type: 'text' },
      personaModel: 'gemini-4-argon'
    });
    expect(ar.selectedModel).toBe('gemini-4-hydrogen');
    expect(ar.tier).toBe('trivial');
    expect(ar.role).toBe('fast_responder');
    expect(ar.thinkingLevel).toBe('LOW');
    expect(ar.source).toBe('orchestrator');

    const en = orchestrateModel({
      message: { text: 'Thanks!', type: 'text' },
      personaModel: 'gemini-4-argon'
    });
    expect(en.selectedModel).toBe('gemini-4-hydrogen');
    expect(en.tier).toBe('trivial');
    expect(en.role).toBe('fast_responder');
  });

  it('routes multimodal messages (image, video, untranscribed audio) to gemini-4-neon', () => {
    const img = orchestrateModel({
      message: { text: 'شوف الصورة دي', type: 'image' },
      personaModel: 'gemini-4-argon'
    });
    expect(img.selectedModel).toBe('gemini-4-neon');
    expect(img.role).toBe('multimodal_specialist');
    expect(img.thinkingLevel).toBeUndefined();

    const doc = orchestrateModel({
      message: { text: 'a'.repeat(350), type: 'document' },
      personaModel: 'gemini-4-argon'
    });
    expect(doc.selectedModel).toBe('gemini-4-argon');
    expect(doc.role).toBe('multimodal_specialist');
    expect(doc.tier).toBe('complex');
  });

  it('escalates high-stakes disputes and financial complaints to gemini-4-carbon (deep_reasoner)', () => {
    const decision = orchestrateModel({
      message: {
        text: 'تم خصم المبلغ مرتين وعايز استرجاع فلوسي فوراً وإلا هقدم شكوى',
        type: 'text'
      },
      personaModel: 'gemini-4-argon'
    });
    expect(decision.selectedModel).toBe('gemini-4-carbon');
    expect(decision.tier).toBe('complex');
    expect(decision.role).toBe('deep_reasoner');
    expect(decision.thinkingLevel).toBe('HIGH');
    expect(decision.fallbackChain[0]).toBe('gemini-4-carbon');
  });

  it('routes complex tool-heavy or long analytical messages to deep_reasoner', () => {
    const decision = orchestrateModel({
      message: { text: 'Can you compare all plans and check order status?', type: 'text' },
      hasExternalTools: true,
      personaModel: 'gemini-4-argon'
    });
    expect(decision.selectedModel).toBe('gemini-4-argon');
    expect(decision.tier).toBe('complex');
    expect(decision.role).toBe('deep_reasoner');
    expect(decision.thinkingLevel).toBe('HIGH');
  });

  it('routes standard conversational queries to the configured persona model', () => {
    const decision = orchestrateModel({
      message: { text: 'مواعيد العيادة يوم الخميس إمتى؟', type: 'text' },
      personaModel: 'gemini-4-argon'
    });
    expect(decision.selectedModel).toBe('gemini-4-argon');
    expect(decision.tier).toBe('standard');
    expect(decision.role).toBe('balanced_workhorse');
    expect(decision.thinkingLevel).toBe('MEDIUM');
  });

  it('honors active external Jev decisions and ignores bypassed ones', () => {
    const active = orchestrateModel({
      message: { text: 'hello', type: 'text' },
      personaModel: 'gemini-4-argon',
      jevDecision: {
        selectedModel: 'gemini-4-carbon',
        tier: 'complex',
        confidence: 0.95,
        routerLatencyMs: 25,
        reason: 'External Jev classified complex',
        bypassed: false
      }
    });
    expect(active.selectedModel).toBe('gemini-4-carbon');
    expect(active.source).toBe('jev_external');

    const bypassed = orchestrateModel({
      message: { text: 'السلام عليكم', type: 'text' },
      personaModel: 'gemini-4-argon',
      jevDecision: {
        selectedModel: 'gemini-3.8-flash',
        tier: 'standard',
        confidence: 0,
        routerLatencyMs: 0,
        reason: 'Bypassed',
        bypassed: true
      }
    });
    expect(bypassed.selectedModel).toBe('gemini-4-hydrogen');
    expect(bypassed.source).toBe('orchestrator');

    const trace = toRoutingTrace(bypassed);
    expect(trace.selectedModel).toBe('gemini-4-hydrogen');
    expect(trace.bypassed).toBe(false);
  });

  it('integrates with ModeratorAgent to pick model and thinkingConfig dynamically', async () => {
    const memory = new MemoryStore({ dataDir: ':memory:' });
    stores.push(memory);
    const calls: Array<{ model?: string; thinkingLevel?: string }> = [];

    const mockGemini: Pick<GeminiClient, 'generateContent'> = {
      generateContent: async (_contents, options) => {
        calls.push({ model: options?.model, thinkingLevel: options?.thinkingConfig?.thinkingLevel });
        return {
          text: JSON.stringify({
            action: 'reply',
            intent: 'greeting',
            replyText: 'وعليكم السلام!',
            reasoning: 'Greeted user',
            confidence: 0.95
          })
        };
      }
    };

    const agent = new ModeratorAgent(mockGemini, memory);

    const greetingMsg: ChatMessage = {
      id: 'orch_msg_1',
      chatId: 'orch_user@s.whatsapp.net',
      sender: 'orch_user@s.whatsapp.net',
      text: 'السلام عليكم',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };
    const res1 = await agent.processInboundMessage(greetingMsg, { dryRun: true });
    expect(calls[0]).toEqual({ model: 'gemini-4-hydrogen', thinkingLevel: 'LOW' });
    expect(res1.decision.modelRouting?.selectedModel).toBe('gemini-4-hydrogen');

    const disputeMsg: ChatMessage = {
      id: 'orch_msg_2',
      chatId: 'orch_user@s.whatsapp.net',
      sender: 'orch_user@s.whatsapp.net',
      text: 'عندي مشكلة وعايز استرجاع فلوسي فوراً',
      timestamp: Date.now() + 1000,
      isFromMe: false,
      type: 'text'
    };
    const res2 = await agent.processInboundMessage(disputeMsg, { dryRun: true });
    expect(calls[1]).toEqual({ model: 'gemini-4-carbon', thinkingLevel: 'HIGH' });
    expect(res2.decision.modelRouting?.selectedModel).toBe('gemini-4-carbon');
  });
});
