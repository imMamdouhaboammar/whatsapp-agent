import { randomUUID } from 'node:crypto';
import type { VoiceSynthesizer } from '../ai/voice-synthesizer';
import { isPacing, type BroadcastStore } from '../domain/broadcast-store';
import { scrubCredentials } from '../domain/learning-memory';
import type {
  BroadcastApprovalMode,
  BroadcastAudienceFilter,
  BroadcastCampaign,
  BroadcastCampaignSummary,
  BroadcastFollowUpConfig,
  BroadcastPacingConfig,
  BroadcastRecipient,
  BroadcastRichContent,
  BroadcastTransport,
  EligibleContact,
} from '../domain/broadcast-types';
import type { MemoryStore } from '../domain/memory-store';
import { describeErrorDetail, logEvent } from '../observability/safe-log';
import type { MetaCloudApi, MetaCloudTemplateComponent } from '../transport/meta-cloud-api';
import type { WhatsAppSocketClient } from '../transport/whatsapp-socket';
import type { BroadcastComposer } from './broadcast-composer';

const OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out)\b|(?:إلغاء\s*الاشتراك|توقف|لا\s*ترسل|ما\s*ترسلش|وقف\s*الرسايل|مش\s*مهتم|مش\s*عايز\s*رسايل)/i;
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_MEDIA_FETCH_BYTES = 16 * 1024 * 1024;

export interface CreateBroadcastInput {
  name: string;
  goal: string;
  transport?: BroadcastTransport;
  approvalMode?: BroadcastApprovalMode;
  audiencePrompt?: string;
  audienceFilter?: BroadcastAudienceFilter;
  richContent: BroadcastRichContent;
  followUp?: Partial<BroadcastFollowUpConfig>;
  pacing?: Partial<BroadcastPacingConfig>;
  createdBy?: 'owner' | 'agent';
  permissionConfirmed?: boolean;
  signal?: AbortSignal;
}

export interface BroadcastOrchestratorDeps {
  store: BroadcastStore;
  memoryStore: Pick<MemoryStore, 'addMessage'>;
  composer: BroadcastComposer;
  whatsappClient?: Pick<WhatsAppSocketClient, 'sendMessage' | 'sendRichMedia' | 'sendVoiceNote' | 'getState'>;
  metaClient?: Pick<MetaCloudApi, 'sendText' | 'sendRichMedia' | 'sendTemplate'>;
  voiceSynthesizer?: Pick<VoiceSynthesizer, 'synthesizeVoice'>;
  voiceName?: () => string | undefined;
  defaultTransport?: 'baileys' | 'meta-cloud';
  publish?: (event: 'broadcast_updated' | 'broadcast_recipient_updated', data: unknown) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function isWithinQuietHours(pacing: BroadcastPacingConfig, now: number): boolean {
  if (!pacing.quietHours) return false;
  const { from, to, timeZone } = pacing.quietHours;
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(new Date(now));
    const hour = Number(hourStr) % 24;
    if (from === to) return false;
    if (from < to) return hour >= from && hour < to;
    return hour >= from || hour < to;
  } catch {
    return true;
  }
}

export class BroadcastOrchestrator {
  private readonly activeDispatches = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: BroadcastOrchestratorDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async previewAudience(filter: BroadcastAudienceFilter = {}, audiencePrompt?: string): Promise<{
    resolvedFilter: BroadcastAudienceFilter;
    contacts: EligibleContact[];
    excludedNoInbound: number;
  }> {
    const parsedPrompt = audiencePrompt?.trim()
      ? await this.deps.composer.parseAudiencePrompt(audiencePrompt)
      : {};
    const resolvedFilter: BroadcastAudienceFilter = {
      ...parsedPrompt,
      ...filter,
      excludeOptedOut: true,
    };
    const contacts = this.deps.store.findEligibleAudience(resolvedFilter, this.now());
    return { resolvedFilter, contacts, excludedNoInbound: this.deps.store.countNoInbound() };
  }

  async createCampaign(input: CreateBroadcastInput): Promise<{
    campaign: BroadcastCampaignSummary;
    recipients: BroadcastRecipient[];
  }> {
    if (input.signal?.aborted) throw new Error("Generation cancelled");
    const { resolvedFilter, contacts } = await this.previewAudience(input.audienceFilter, input.audiencePrompt);
    if (!contacts.length || (input.richContent.compositionMode && input.audienceFilter?.chatIds && new Set(input.audienceFilter.chatIds).size !== contacts.length)) throw new Error('No eligible audience or selection changed');
    if (input.richContent.compositionMode && (input.approvalMode === 'autonomous' || !input.permissionConfirmed || !input.audienceFilter?.chatIds?.length)) throw new Error('Explicit permission, selection and review required');
    if (input.richContent.compositionMode && (input.transport === 'meta-cloud' || (input.transport !== 'baileys' && this.deps.defaultTransport === 'meta-cloud'))) throw new Error('Studio requires verified Meta template consent integration before enabling Meta transport');
    if (input.richContent.compositionMode && input.richContent.kind === 'template') throw new Error('Studio does not support unverified templates');
    if (input.richContent.compositionMode && input.followUp?.enabled) throw new Error('Studio follow-ups require a new reviewed campaign');
    const approvalMode: BroadcastApprovalMode = input.approvalMode ?? 'preview_approve';
    const transport: BroadcastTransport = input.transport ?? 'auto';
    const followUp: BroadcastFollowUpConfig = {
      enabled: input.followUp?.enabled ?? false,
      delayMinutes: Math.max(1, input.followUp?.delayMinutes ?? 120),
      maxFollowUps: Math.min(3, Math.max(1, input.followUp?.maxFollowUps ?? 1)),
      triggerOn: input.followUp?.triggerOn ?? 'read_no_reply',
      messagePrompt: input.followUp?.messagePrompt?.trim() || 'Send a brief, helpful follow-up checking if they had any questions.',
    };
    const minDelayMs = Math.max(0, input.pacing?.minDelayMs ?? 2500);
    const maxDelayMs = Math.max(minDelayMs, input.pacing?.maxDelayMs ?? 6500);
    const pacing: BroadcastPacingConfig = {
      minDelayMs,
      maxDelayMs,
      ...(input.pacing?.maxWindowMinutes !== undefined ? {maxWindowMinutes: input.pacing.maxWindowMinutes} : {}),
      ...(input.pacing?.quietHours ? { quietHours: input.pacing.quietHours } : {}),
    };

    if (!isPacing(pacing)) throw new Error('Invalid pacing configuration');
    if (pacing.quietHours && !new Intl.DateTimeFormat('en',{timeZone:pacing.quietHours.timeZone}).resolvedOptions().timeZone) throw new Error('Invalid time zone');
    const brandContext = input.richContent.brief?.useBrandKnowledge ? await this.deps.composer.getBrandContext(input.goal) : [];
    const initialRecipientStatus = approvalMode === 'autonomous' ? 'approved' : 'draft';
    const composedRecipients: Array<{
      chatId: string;
      contactName: string;
      phoneNumber?: string;
      personalizedText: string;
      richContent: BroadcastRichContent;
      status: 'draft' | 'approved';
    }> = [];

    for (const contact of contacts) {
      if (input.signal?.aborted) throw new Error("Generation cancelled");
      const history = this.deps.store.getConversationContext(contact.chatId);
      const personalizedText = await this.deps.composer.personalizeForContact(
        contact,
        input.richContent.messageGoal || input.goal,
        { kind: input.richContent.kind, history, summaries: this.deps.store.getConversationSummaries(contact.chatId), brandContext, brief: input.richContent.brief, requireAI: input.richContent.compositionMode === 'conversation', templateOnly: input.richContent.compositionMode === 'template', signal: input.signal }
      );
      composedRecipients.push({
        chatId: contact.chatId,
        contactName: contact.name,
        phoneNumber: contact.phoneNumber,
        personalizedText,
        richContent: { ...input.richContent, messageGoal: personalizedText, personalization: {nameSource: contact.nameSource ?? "unknown", historyCount: history.length, brandSources: brandContext.length, nameConfidence: contact.nameConfidence, lastSnippet: contact.lastSnippet} },
        status: initialRecipientStatus,
      });
    }

    if (input.signal?.aborted) throw new Error("Generation cancelled");
    const stillEligible = this.deps.store.findEligibleAudience({...resolvedFilter, chatIds: contacts.map(contact => contact.chatId), limit: 500}, this.now());
    if (stillEligible.length !== contacts.length) throw new Error('Audience changed during generation');
    const campaign = this.deps.store.createCampaign({
      name: input.name.trim() || 'Smart Broadcast',
      goal: input.goal.trim() || input.richContent.messageGoal,
      transport,
      approvalMode,
      status: approvalMode === 'autonomous' ? 'approved' : 'draft',
      audienceFilter: resolvedFilter,
      richContent: input.richContent,
      followUp,
      pacing,
      createdBy: input.createdBy ?? 'owner',
    });

    const recipients = this.deps.store.addRecipients(campaign.id, composedRecipients);
    const summary: BroadcastCampaignSummary = {
      ...campaign,
      stats: this.deps.store.getCampaignStats(campaign.id),
    };
    this.deps.publish?.('broadcast_updated', summary);

    if (approvalMode === 'autonomous' && recipients.length > 0) {
      this.launchDispatch(campaign.id);
    }

    return { campaign: summary, recipients };
  }

  async regenerateDraft(campaignId: string, recipientId: string, nameOverride?: string, signal?: AbortSignal): Promise<BroadcastRecipient> {
    const campaign = this.deps.store.getCampaign(campaignId);
    const recipient = this.deps.store.getRecipient(recipientId);
    if (!campaign || campaign.status !== 'draft' || !recipient || recipient.campaignId !== campaignId ||
      !['draft','approved','skipped'].includes(recipient.status)) throw new Error('Draft not editable');
    const contact = this.deps.store.findEligibleAudience({chatIds:[recipient.chatId]},this.now())[0];
    if (!contact) throw new Error('Contact no longer eligible');
    const name = nameOverride?.trim();
    if (name !== undefined && (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]{0,79}$/u.test(name) || scrubCredentials(name) !== name)) throw new Error('Invalid contact name');
    const history = this.deps.store.getConversationContext(recipient.chatId);
    const brandContext = campaign.richContent.brief?.useBrandKnowledge ? await this.deps.composer.getBrandContext(campaign.goal) : [];
    const text = await this.deps.composer.personalizeForContact({...contact,name:name ?? contact.name},campaign.richContent.messageGoal,{
      kind:campaign.richContent.kind, history, summaries:this.deps.store.getConversationSummaries(recipient.chatId), brandContext,
      brief:campaign.richContent.brief, requireAI:true, signal,
    });
    if (signal?.aborted || !this.deps.store.findEligibleAudience({chatIds:[recipient.chatId]},this.now()).length) throw new Error('Draft generation cancelled or contact no longer eligible');
    const updated = this.deps.store.replaceDraft(recipient,text,name ?? contact.name,{...recipient.richContent,messageGoal:text,personalization:{
      nameSource:name ? 'operator' : contact.nameSource ?? 'unknown',historyCount:history.length,brandSources:brandContext.length,lastSnippet:contact.lastSnippet,
    }});
    if (!updated) throw new Error('Draft changed during generation');
    this.deps.publish?.('broadcast_recipient_updated',updated);
    this.publishCampaign(campaignId);
    return updated;
  }

  approveCampaign(campaignId: string): BroadcastCampaignSummary | null {
    const campaign = this.deps.store.getCampaign(campaignId);
    if (!campaign) return null;
    if (campaign.status === 'cancelled' || campaign.status === 'completed') {
      return { ...campaign, stats: this.deps.store.getCampaignStats(campaignId) };
    }
    if (campaign.richContent.compositionMode && this.deps.store.getCampaignStats(campaignId).draft > 0) return null;
    this.deps.store.approveAllDraftRecipients(campaignId);
    const updated = this.deps.store.updateCampaignStatus(campaignId, 'approved', {startedAt: this.now()}) ?? campaign;
    const summary: BroadcastCampaignSummary = {
      ...updated,
      stats: this.deps.store.getCampaignStats(campaignId),
    };
    this.deps.publish?.('broadcast_updated', summary);
    this.launchDispatch(campaignId);
    return summary;
  }

  pauseCampaign(campaignId: string): BroadcastCampaignSummary | null {
    const current = this.deps.store.getCampaign(campaignId);
    if (!current || !['running','approved'].includes(current.status)) return null;
    const updated = this.deps.store.updateCampaignStatus(campaignId, 'paused');
    if (!updated) return null;
    const summary: BroadcastCampaignSummary = {
      ...updated,
      stats: this.deps.store.getCampaignStats(campaignId),
    };
    this.deps.publish?.('broadcast_updated', summary);
    return summary;
  }

  cancelCampaign(campaignId: string): BroadcastCampaignSummary | null {
    const current = this.deps.store.getCampaign(campaignId);
    if (!current || ['completed','cancelled'].includes(current.status)) return null;
    const updated = this.deps.store.updateCampaignStatus(campaignId, 'cancelled', { completedAt: this.now() });
    if (!updated) return null;
    const summary: BroadcastCampaignSummary = {
      ...updated,
      stats: this.deps.store.getCampaignStats(campaignId),
    };
    this.deps.publish?.('broadcast_updated', summary);
    return summary;
  }

  private launchDispatch(campaignId: string): void {
    if (this.activeDispatches.has(campaignId)) return;
    this.startDispatchInBackground(campaignId).catch((error: unknown) => {
      logEvent('error', 'broadcast_dispatch_interrupted', {
        campaignId,
        error: describeErrorDetail(error),
      });
    });
  }

  startDispatchInBackground(campaignId: string): Promise<void> {
    const existing = this.activeDispatches.get(campaignId);
    if (existing) return existing;
    const task = this.dispatchCampaign(campaignId).finally(() => {
      this.activeDispatches.delete(campaignId);
    });
    this.activeDispatches.set(campaignId, task);
    return task;
  }

  async dispatchCampaign(campaignId: string): Promise<void> {
    const initial = this.deps.store.getCampaign(campaignId);
    if (!initial || !['approved','running'].includes(initial.status)) {
      return;
    }

    this.deps.store.updateCampaignStatus(campaignId, 'running', { startedAt: this.now() });
    this.publishCampaign(campaignId);

    const recipients = this.deps.store.listRecipients(campaignId).filter((r) => r.status === 'approved');

    for (let i = 0; i < recipients.length; i++) {
      const latestCampaign = this.deps.store.getCampaign(campaignId);
      if (!latestCampaign || latestCampaign.status === 'paused' || latestCampaign.status === 'cancelled') {
        return;
      }

      const recipient = recipients[i];
      if (!recipient) continue;
      if (this.deps.store.isOptedOut(recipient.chatId)) {
        const opted = this.deps.store.updateRecipientDelivery(recipient.id, { status: 'opted_out', nextFollowUpAt: null });
        if (opted) this.deps.publish?.('broadcast_recipient_updated', opted);
        continue;
      }

      if (latestCampaign.pacing.maxWindowMinutes !== undefined && latestCampaign.startedAt !== undefined && this.now() >= latestCampaign.startedAt + latestCampaign.pacing.maxWindowMinutes * 60000) {
        this.deps.store.updateCampaignStatus(campaignId, 'cancelled', {completedAt:this.now()});
        this.publishCampaign(campaignId);
        return;
      }
      if (!this.deps.store.findEligibleAudience({chatIds: [recipient.chatId], skipActiveHours: latestCampaign.audienceFilter.skipActiveHours}, this.now()).length) {
        this.deps.store.updateRecipientDelivery(recipient.id, {status: 'skipped', error: 'Contact no longer eligible'});
        continue;
      }
      if (this.resolveTransport(latestCampaign.transport) === 'baileys' && this.deps.whatsappClient?.getState().state !== 'connected') {
        this.deps.store.updateCampaignStatus(campaignId, 'paused');
        this.publishCampaign(campaignId);
        return;
      }
      if (isWithinQuietHours(latestCampaign.pacing, this.now())) {
        this.deps.store.updateCampaignStatus(campaignId, 'paused');
        this.publishCampaign(campaignId);
        return;
      }

      if (!this.deps.store.claimRecipient(recipient.id)) continue;
      try {
        const sent = await this.sendToRecipient(latestCampaign, recipient, recipient.personalizedText, recipient.richContent);
        const updated = this.deps.store.updateRecipientDelivery(recipient.id, {
          status: this.deps.store.isOptedOut(recipient.chatId) ? 'opted_out' : 'sent',
          transportUsed: sent.transportUsed,
          providerMessageId: sent.messageId,
          sentAt: this.now(),
          error: null,
        });
        if (updated) this.deps.publish?.('broadcast_recipient_updated', updated);

        this.deps.memoryStore.addMessage({
          id: sent.messageId || randomUUID(),
          chatId: recipient.chatId,
          sender: 'me',
          text: recipient.personalizedText,
          timestamp: this.now(),
          isFromMe: true,
          type: recipient.richContent.kind === 'voice_note' ? 'audio' : recipient.richContent.kind === 'image' ? 'image' : recipient.richContent.kind === 'video' ? 'video' : recipient.richContent.kind === 'document' ? 'document' : 'text',
          status: 'sent',
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failed = this.deps.store.updateRecipientDelivery(recipient.id, {
          status: this.deps.store.isOptedOut(recipient.chatId) ? 'opted_out' : 'failed',
          error: errorMsg,
        });
        if (failed) this.deps.publish?.('broadcast_recipient_updated', failed);
      }

      this.publishCampaign(campaignId);

      if (i < recipients.length - 1 && latestCampaign.pacing.maxDelayMs > 0) {
        const span = Math.max(0, latestCampaign.pacing.maxDelayMs - latestCampaign.pacing.minDelayMs);
        const delay = latestCampaign.pacing.minDelayMs + Math.floor(Math.random() * (span + 1));
        if (delay > 0) await this.sleep(delay);
      }
    }

    const finalCampaign = this.deps.store.getCampaign(campaignId);
    if (finalCampaign && finalCampaign.status === 'running') {
      const uncertain = this.deps.store.getCampaignStats(campaignId).queued > 0;
      this.deps.store.updateCampaignStatus(campaignId, uncertain ? 'paused' : 'completed', uncertain ? undefined : { completedAt: this.now() });
      this.publishCampaign(campaignId);
    }
  }

  private resolveTransport(preferred: BroadcastTransport): 'baileys' | 'meta-cloud' {
    if (preferred === 'baileys' || preferred === 'meta-cloud') return preferred;
    if (this.deps.defaultTransport) return this.deps.defaultTransport;
    if (this.deps.whatsappClient) return 'baileys';
    if (this.deps.metaClient) return 'meta-cloud';
    throw new Error('No WhatsApp transport is configured');
  }

  private async resolveMediaBuffer(content: BroadcastRichContent): Promise<Buffer> {
    if (content.mediaBase64) {
      const cleaned = content.mediaBase64.includes(',') ? (content.mediaBase64.split(',')[1] ?? '') : content.mediaBase64;
      return Buffer.from(cleaned, 'base64');
    }
    if (content.mediaUrl) {
      const res = await fetch(content.mediaUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Failed to fetch media URL (HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_MEDIA_FETCH_BYTES) {
        throw new Error('Media exceeds 16 MB limit');
      }
      return buf;
    }
    throw new Error('Rich media requires mediaBase64 or mediaUrl');
  }

  private assertStudioSendAllowed(campaign: BroadcastCampaign, recipient: BroadcastRecipient): void {
    if (!campaign.richContent.compositionMode) return;
    const current = this.deps.store.getCampaign(campaign.id);
    if (!current || current.status !== 'running' || this.deps.store.isOptedOut(recipient.chatId) ||
        !this.deps.store.findEligibleAudience({chatIds:[recipient.chatId],skipActiveHours:campaign.audienceFilter.skipActiveHours},this.now()).length ||
        isWithinQuietHours(current.pacing,this.now()) ||
        (current.startedAt !== undefined && current.pacing.maxWindowMinutes !== undefined && this.now() >= current.startedAt + current.pacing.maxWindowMinutes * 60000) ||
        this.deps.whatsappClient?.getState().state !== 'connected') throw new Error('Send preconditions changed');
  }

  private async sendToRecipient(
    campaign: BroadcastCampaign,
    recipient: BroadcastRecipient,
    text: string,
    richContent: BroadcastRichContent
  ): Promise<{ messageId: string; transportUsed: 'baileys' | 'meta-cloud' }> {
    const transportUsed = this.resolveTransport(campaign.transport);

    if (transportUsed === 'baileys') {
      const wa = this.deps.whatsappClient;
      if (!wa) throw new Error('Baileys transport is not available');

      if (richContent.kind === 'image' || richContent.kind === 'video' || richContent.kind === 'document') {
        const buffer = await this.resolveMediaBuffer(richContent);
        const mediaPayload =
          richContent.kind === 'image'
            ? { kind: 'image' as const, buffer, caption: text, mimetype: richContent.mimeType }
            : richContent.kind === 'video'
            ? { kind: 'video' as const, buffer, caption: text, mimetype: richContent.mimeType }
            : {
                kind: 'document' as const,
                buffer,
                fileName: richContent.fileName || 'attachment.pdf',
                mimetype: richContent.mimeType || 'application/pdf',
                caption: text,
              };
        this.assertStudioSendAllowed(campaign, recipient);
        const res = await wa.sendRichMedia(recipient.chatId, mediaPayload);
        return { messageId: res.messageId, transportUsed };
      }

      if (richContent.kind === 'voice_note' && !this.deps.voiceSynthesizer) throw new Error('Voice synthesis unavailable');
      if (richContent.kind === 'voice_note' && this.deps.voiceSynthesizer) {
        const audio = await this.deps.voiceSynthesizer.synthesizeVoice(text, this.deps.voiceName?.() ?? 'Kore');
        this.assertStudioSendAllowed(campaign, recipient);
        const res = await wa.sendVoiceNote(recipient.chatId, audio);
        return { messageId: res.messageId, transportUsed };
      }

      this.assertStudioSendAllowed(campaign, recipient);
      const res = await wa.sendMessage(recipient.chatId, text);
      return { messageId: res.messageId, transportUsed };
    }

    const meta = this.deps.metaClient;
    if (!meta) throw new Error('Meta Cloud API transport is not available');

    const audience = this.deps.store.findEligibleAudience({ chatIds: [recipient.chatId], excludeOptedOut: false }, this.now())[0];
    const lastInboundAtMs = audience?.lastInboundAtMs ?? 0;
    const within24h = lastInboundAtMs > 0 && this.now() - lastInboundAtMs < SERVICE_WINDOW_MS;

    if (richContent.kind === 'template' || !within24h) {
      if (!richContent.templateName) {
        throw new Error('Meta Cloud outside-24h broadcast requires an approved templateName');
      }
      const components: MetaCloudTemplateComponent[] = [];
      if (richContent.templateHeaderMediaType && richContent.templateHeaderMediaUrl) {
        const mediaType = richContent.templateHeaderMediaType;
        const headerParam =
          mediaType === 'image'
            ? { type: 'image' as const, image: { link: richContent.templateHeaderMediaUrl } }
            : mediaType === 'video'
              ? { type: 'video' as const, video: { link: richContent.templateHeaderMediaUrl } }
              : { type: 'document' as const, document: { link: richContent.templateHeaderMediaUrl } };
        components.push({
          type: 'header',
          parameters: [headerParam],
        });
      }
      if (text.trim()) {
        components.push({
          type: 'body',
          parameters: [{ type: 'text', text: text.slice(0, 1024) }],
        });
      }
      if (richContent.templateButtons?.length) {
        richContent.templateButtons.forEach((btn, idx) => {
          if (btn.urlOrPayload) {
            components.push({
              type: 'button',
              sub_type: btn.type,
              index: idx,
              parameters: [
                btn.type === 'url'
                  ? { type: 'text', text: btn.urlOrPayload }
                  : { type: 'payload', payload: btn.urlOrPayload },
              ],
            });
          }
        });
      }
      const res = await meta.sendTemplate({
        to: recipient.chatId,
        template: {
          name: richContent.templateName,
          languageCode: richContent.templateLanguage || 'en_US',
          ...(components.length ? { components } : {}),
        },
        eligibility: {
          optedInAtMs: audience?.lastMessageAtMs ?? (this.now() - 1000),
          approvedTemplate: true,
        },
      });
      return { messageId: res.messageId, transportUsed };
    }

    if ((richContent.kind === 'image' || richContent.kind === 'video' || richContent.kind === 'document' || richContent.kind === 'voice_note') && richContent.mediaUrl) {
      const kind = richContent.kind === 'voice_note' ? 'audio' : richContent.kind;
      const res = await meta.sendRichMedia({
        to: recipient.chatId,
        kind,
        mediaUrl: richContent.mediaUrl,
        caption: text,
        fileName: richContent.fileName,
        lastInboundAtMs,
      });
      return { messageId: res.messageId, transportUsed };
    }

    const res = await meta.sendText({
      to: recipient.chatId,
      text,
      lastInboundAtMs,
    });
    return { messageId: res.messageId, transportUsed };
  }

  onMessageReceipt(nativeMessageId: string, status: 'delivered' | 'read'): void {
    const recipient = this.deps.store.findRecipientByProviderMessageId(nativeMessageId);
    if (!recipient || recipient.repliedAt || recipient.status === 'opted_out') return;

    const campaign = this.deps.store.getCampaign(recipient.campaignId);
    const now = this.now();
    let nextFollowUpAt = recipient.nextFollowUpAt ?? null;

    if (campaign?.followUp.enabled && recipient.followUpCount < campaign.followUp.maxFollowUps) {
      const shouldSchedule =
        (campaign.followUp.triggerOn === 'read_no_reply' && status === 'read') ||
        (campaign.followUp.triggerOn === 'delivered_no_reply' && (status === 'delivered' || status === 'read'));
      if (shouldSchedule && !nextFollowUpAt) {
        nextFollowUpAt = now + campaign.followUp.delayMinutes * 60_000;
      }
    }

    const nextStatus =
      recipient.status === 'read' || recipient.status === 'followed_up'
        ? recipient.status
        : status;

    const updated = this.deps.store.updateRecipientDelivery(recipient.id, {
      status: nextStatus,
      ...(status === 'delivered' ? { deliveredAt: now } : {}),
      ...(status === 'read' ? { deliveredAt: recipient.deliveredAt ?? now, readAt: now } : {}),
      nextFollowUpAt,
    });
    if (updated) {
      this.deps.publish?.('broadcast_recipient_updated', updated);
      this.publishCampaign(recipient.campaignId);
    }
  }

  onInboundMessage(chatId: string, text: string): void {
    const now = this.now();
    if (OPT_OUT_PATTERN.test(text)) {
      this.deps.store.markOptOut(chatId, 'inbound_opt_out', now);
      return;
    }

    const active = this.deps.store.findActiveRecipientsForChat(chatId);
    for (const recipient of active) {
      const updated = this.deps.store.updateRecipientDelivery(recipient.id, {
        status: 'replied',
        repliedAt: now,
        nextFollowUpAt: null,
      });
      if (updated) {
        this.deps.publish?.('broadcast_recipient_updated', updated);
        this.publishCampaign(recipient.campaignId);
      }
    }
  }

  private followUpsRunning = false;

  async tickFollowUps(): Promise<number> {
    if (this.followUpsRunning) return 0;
    this.followUpsRunning = true;
    try { return await this.processFollowUps(); } finally { this.followUpsRunning = false; }
  }

  private async processFollowUps(): Promise<number> {
    const now = this.now();
    const due = this.deps.store.findDueFollowUps(now);
    let processed = 0;

    for (const recipient of due) {
      const campaign = this.deps.store.getCampaign(recipient.campaignId);
      if (!campaign || !campaign.followUp.enabled || recipient.followUpCount >= campaign.followUp.maxFollowUps) {
        this.deps.store.updateRecipientDelivery(recipient.id, { status: recipient.status, nextFollowUpAt: null });
        continue;
      }
      if (this.deps.store.isOptedOut(recipient.chatId)) {
        this.deps.store.updateRecipientDelivery(recipient.id, { status: 'opted_out', nextFollowUpAt: null });
        continue;
      }

      const contact = this.deps.store.findEligibleAudience({ chatIds: [recipient.chatId], excludeOptedOut: false }, now)[0] ?? {
        chatId: recipient.chatId,
        name: recipient.contactName,
        phoneNumber: recipient.phoneNumber,
        stage: 'lead',
        facts: [],
        memories: [],
        messageCount: 1,
      };

      const followUpText = await this.deps.composer.personalizeForContact(
        contact,
        `${campaign.followUp.messagePrompt}\nOriginal message: ${recipient.personalizedText}`,
        { isFollowUp: true, history: this.deps.store.getConversationContext(recipient.chatId), templateOnly: campaign.richContent.compositionMode === 'template' }
      );

      const latest = this.deps.store.getRecipient(recipient.id);
      const latestCampaign = this.deps.store.getCampaign(campaign.id);
      if (!latest || latest.repliedAt || this.deps.store.isOptedOut(recipient.chatId) || !latestCampaign || !['running','completed'].includes(latestCampaign.status) || isWithinQuietHours(campaign.pacing, this.now()) || !this.deps.store.findEligibleAudience({chatIds:[recipient.chatId]}, this.now()).length) continue;
      if (this.resolveTransport(campaign.transport) === 'baileys' && this.deps.whatsappClient?.getState().state !== 'connected') continue;
      // Clear the due time before crossing the transport boundary; an interrupted send is not replayed.
      this.deps.store.updateRecipientDelivery(recipient.id, {status: latest.status, nextFollowUpAt: null});
      try {
        const sent = await this.sendToRecipient(
          campaign,
          recipient,
          followUpText,
          { kind: campaign.richContent.kind === 'template' ? 'template' : 'text', messageGoal: followUpText, templateName: campaign.richContent.templateName, templateLanguage: campaign.richContent.templateLanguage }
        );
        const nextCount = recipient.followUpCount + 1;
        const scheduleAnother = nextCount < campaign.followUp.maxFollowUps
          ? now + campaign.followUp.delayMinutes * 60_000
          : null;

        const updated = this.deps.store.updateRecipientDelivery(recipient.id, {
          status: 'followed_up',
          providerMessageId: sent.messageId,
          followUpCount: nextCount,
          nextFollowUpAt: scheduleAnother,
        });
        if (updated) this.deps.publish?.('broadcast_recipient_updated', updated);

        this.deps.memoryStore.addMessage({
          id: sent.messageId || randomUUID(),
          chatId: recipient.chatId,
          sender: 'me',
          text: followUpText,
          timestamp: now,
          isFromMe: true,
          type: 'text',
          status: 'sent',
        });

        this.publishCampaign(campaign.id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.deps.store.updateRecipientDelivery(recipient.id, {
          status: recipient.status,
          nextFollowUpAt: null,
          error: `Follow-up failed: ${msg}`,
        });
      }
    }

    return processed;
  }

  private publishCampaign(campaignId: string): void {
    const campaign = this.deps.store.getCampaign(campaignId);
    if (!campaign) return;
    this.deps.publish?.('broadcast_updated', {
      ...campaign,
      stats: this.deps.store.getCampaignStats(campaignId),
    });
  }
}
