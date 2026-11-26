import { isRecord } from '../mcp/records';
import type { GeminiClient } from '../ai/gemini-client';
import type { BroadcastAudienceFilter, EligibleContact } from '../domain/broadcast-types';
import { scrubCredentials } from '../domain/learning-memory';

export interface BroadcastComposerDeps {
  gemini?: Pick<GeminiClient, 'generateContent'>;
  brandName?: string;
}

export class BroadcastComposer {
  constructor(private readonly deps: BroadcastComposerDeps = {}) {}

  /**
   * Parses a natural-language audience prompt into a structured BroadcastAudienceFilter.
   * Falls back deterministically to keyword search if Gemini is unavailable.
   */
  async parseAudiencePrompt(prompt: string): Promise<BroadcastAudienceFilter> {
    const trimmed = prompt.trim();
    if (!trimmed) return {};
    if (!this.deps.gemini) {
      return { query: trimmed };
    }

    try {
      const response = await this.deps.gemini.generateContent(
        [{
          role: 'user',
          parts: [{
            text: `Convert this WhatsApp broadcast audience description into a JSON filter object with optional keys:
- "query": string (keywords to match in name, notes, facts, memories)
- "stages": string[] (subset of ["lead", "qualified", "customer", "vip"])
- "activeWithinDays": number
- "inactiveAtLeastDays": number
- "minMessages": number

Description: ${trimmed}
Return ONLY valid JSON.`
          }]
        }],
        {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 300,
        }
      );
      const parsed: unknown = JSON.parse(response.text || '{}');
      if (parsed === null) return { query: trimmed };
      if (!isRecord(parsed)) return {};
      return {
        ...(typeof parsed.query === 'string' && parsed.query.trim() ? { query: parsed.query.trim() } : {}),
        ...(Array.isArray(parsed.stages) && parsed.stages.length ? { stages: parsed.stages.filter((s): s is string => typeof s === 'string') } : {}),
        ...(typeof parsed.activeWithinDays === 'number' && parsed.activeWithinDays > 0 ? { activeWithinDays: parsed.activeWithinDays } : {}),
        ...(typeof parsed.inactiveAtLeastDays === 'number' && parsed.inactiveAtLeastDays > 0 ? { inactiveAtLeastDays: parsed.inactiveAtLeastDays } : {}),
        ...(typeof parsed.minMessages === 'number' && parsed.minMessages >= 1 ? { minMessages: parsed.minMessages } : {}),
      };
    } catch {
      return { query: trimmed };
    }
  }

  /**
   * Generates a personalized WhatsApp message (or media caption / voice script)
   * grounded in the contact's dossier, memories, and preferred tone.
   */
  async personalizeForContact(
    contact: EligibleContact,
    messageGoal: string,
    options: { kind?: string; isFollowUp?: boolean } = {}
  ): Promise<string> {
    const fallback = this.deterministicPersonalize(contact, messageGoal, options.isFollowUp);
    if (!this.deps.gemini) {
      return fallback;
    }

    try {
      const contextLines = [
        `Contact Name: ${contact.name}`,
        `Relationship Stage: ${contact.stage}`,
        contact.preferredTone ? `Preferred Tone: ${contact.preferredTone}` : '',
        contact.facts.length ? `Known Facts: ${contact.facts.slice(0, 6).join('; ')}` : '',
        contact.memories.length ? `Recent Memories: ${contact.memories.slice(0, 4).join('; ')}` : '',
        contact.notes ? `Notes: ${contact.notes}` : '',
      ].filter(Boolean).join('\n');

      const prompt = [
        `You are drafting a ${options.isFollowUp ? 'polite follow-up' : 'proactive'} WhatsApp ${options.kind || 'message'} for a customer who has previously chatted with ${this.deps.brandName || 'our business'}.`,
        `Goal / Offer:\n${messageGoal}`,
        `Customer Context:\n${contextLines}`,
        `Rules:`,
        `- Match the language of the Goal (Arabic or English).`,
        `- Address the customer naturally by first name (${contact.name}) if appropriate.`,
        `- Keep it concise, warm, human, and WhatsApp-native (no robotic templates or spammy hype).`,
        `- Never invent prices, discounts, or commitments not in the Goal.`,
        `- Return ONLY the final message text.`,
      ].join('\n\n');

      const res = await this.deps.gemini.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        { temperature: 0.55, maxOutputTokens: 450 }
      );
      const text = res.text?.trim();
      if (!text) return fallback;
      const scrubbed = scrubCredentials(text);
      return scrubbed || fallback;
    } catch {
      return fallback;
    }
  }

  private deterministicPersonalize(contact: EligibleContact, messageGoal: string, isFollowUp = false): string {
    const firstName = contact.name.split(/\s+/)[0] || contact.name;
    let text = messageGoal
      .replace(/\{\{\s*name\s*\}\}/gi, firstName)
      .replace(/\{\{\s*full_name\s*\}\}/gi, contact.name)
      .replace(/\{\{\s*stage\s*\}\}/gi, contact.stage)
      .trim();

    if (!text.toLowerCase().includes(firstName.toLowerCase()) && firstName && firstName !== 'Unknown') {
      const isArabic = /[\u0600-\u06FF]/.test(text);
      if (isFollowUp) {
        text = isArabic ? `أهلاً ${firstName}، حبيت أطمن لو وصلك العرض اللي فات أو عندك أي استفسار؟` : `Hi ${firstName}, just checking in to see if you had any questions about my previous message.`;
      } else {
        text = isArabic ? `أهلاً ${firstName}،\n${text}` : `Hi ${firstName},\n${text}`;
      }
    }
    return scrubCredentials(text);
  }
}
