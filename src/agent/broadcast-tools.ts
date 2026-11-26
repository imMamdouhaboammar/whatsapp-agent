import { isRecord } from '../mcp/records';
import type { BroadcastOrchestrator } from './broadcast-orchestrator';
import type { BroadcastStore } from '../domain/broadcast-store';
import type { ToolRegistry } from './tools';
import type { BroadcastRichKind } from '../domain/broadcast-types';

export function registerBroadcastTools(
  registry: ToolRegistry,
  brandId: string,
  deps: { store: BroadcastStore; orchestrator: BroadcastOrchestrator }
): void {
  registry.register(brandId, {
    name: 'broadcast_find_audience',
    kind: 'read',
    scope: 'broadcast:read',
    description: 'Find contacts who have an established previous connection with the business.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' },
        limit: { type: 'INTEGER' },
      },
    },
    validate: (value): value is { query?: string; limit?: number } =>
      value !== null && typeof value === 'object' && !Array.isArray(value),
    execute: async (input) => {
      const { contacts } = await deps.orchestrator.previewAudience(
        { limit: input.limit ?? 50 },
        input.query
      );
      return {
        count: contacts.length,
        contacts: contacts.map((c) => ({
          chatId: c.chatId,
          name: c.name,
          stage: c.stage,
          messageCount: c.messageCount,
        })),
      };
    },
  });

  registry.register(brandId, {
    name: 'broadcast_create_campaign',
    kind: 'write',
    scope: 'broadcast:write',
    description: 'Create a personalized rich WhatsApp broadcast campaign for previously connected users.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        goal: { type: 'STRING' },
        audiencePrompt: { type: 'STRING' },
        kind: { type: 'STRING', enum: ['text', 'image', 'video', 'document', 'voice_note', 'template'] },
        mediaUrl: { type: 'STRING' },
        templateName: { type: 'STRING' },
        approvalMode: { type: 'STRING', enum: ['preview_approve', 'autonomous'] },
        followUpEnabled: { type: 'BOOLEAN' },
      },
      required: ['name', 'goal'],
    },
    validate: (value): value is {
      name: string;
      goal: string;
      audiencePrompt?: string;
      kind?: BroadcastRichKind;
      mediaUrl?: string;
      templateName?: string;
      approvalMode?: 'preview_approve' | 'autonomous';
      followUpEnabled?: boolean;
    } => isRecord(value) && typeof value.name === 'string' && typeof value.goal === 'string' &&
      (value.audiencePrompt === undefined || typeof value.audiencePrompt === 'string') &&
      (value.kind === undefined || value.kind === 'text' || value.kind === 'image' || value.kind === 'video' ||
        value.kind === 'document' || value.kind === 'voice_note' || value.kind === 'template') &&
      (value.mediaUrl === undefined || typeof value.mediaUrl === 'string') &&
      (value.templateName === undefined || typeof value.templateName === 'string') &&
      (value.approvalMode === undefined || value.approvalMode === 'preview_approve' || value.approvalMode === 'autonomous') &&
      (value.followUpEnabled === undefined || typeof value.followUpEnabled === 'boolean'),
    execute: async (input) => {
      const created = await deps.orchestrator.createCampaign({
        name: input.name,
        goal: input.goal,
        audiencePrompt: input.audiencePrompt,
        approvalMode: input.approvalMode ?? 'preview_approve',
        richContent: {
          kind: input.kind ?? 'text',
          messageGoal: input.goal,
          ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
          ...(input.templateName ? { templateName: input.templateName, templateLanguage: 'en_US' } : {}),
        },
        followUp: { enabled: input.followUpEnabled ?? false },
        createdBy: 'agent',
      });
      return {
        campaignId: created.campaign.id,
        status: created.campaign.status,
        recipientCount: created.recipients.length,
      };
    },
  });

  registry.register(brandId, {
    name: 'broadcast_approve_and_send',
    kind: 'write',
    scope: 'broadcast:write',
    description: 'Approve a draft broadcast campaign and start dispatching messages.',
    parameters: {
      type: 'OBJECT',
      properties: {
        campaignId: { type: 'STRING' },
      },
      required: ['campaignId'],
    },
    validate: (value): value is { campaignId: string } =>
      isRecord(value) && typeof value.campaignId === 'string',
    execute: async (input) => {
      const updated = deps.orchestrator.approveCampaign(input.campaignId);
      if (!updated) throw new Error('Broadcast campaign not found');
      return { campaignId: updated.id, status: updated.status, stats: updated.stats };
    },
  });
}
