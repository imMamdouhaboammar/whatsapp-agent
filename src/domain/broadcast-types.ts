export type BroadcastTransport = 'auto' | 'baileys' | 'meta-cloud';

export type BroadcastApprovalMode = 'preview_approve' | 'autonomous';

export type BroadcastCampaignStatus =
  | 'draft'
  | 'approved'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type BroadcastRecipientStatus =
  | 'draft'
  | 'approved'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'replied'
  | 'followed_up'
  | 'skipped'
  | 'failed'
  | 'opted_out';

export type BroadcastRichKind =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'voice_note'
  | 'template';

export interface BroadcastTemplateButton {
  type: 'url' | 'quick_reply';
  text: string;
  urlOrPayload?: string;
}

export interface BroadcastRichContent {
  kind: BroadcastRichKind;
  /** Prompt or base template message used by the AI agent to personalize per contact. */
  messageGoal: string;
  compositionMode?: "conversation" | "template";
  brief?: { cta: string; tone: string; constraints: string; useBrandKnowledge: boolean };
  personalization?: { nameSource: string; historyCount: number; brandSources: number; nameConfidence?: number; lastSnippet?: string };
  /** Optional media URL (used by Meta Cloud or fetched for Baileys if buffer not supplied). */
  mediaUrl?: string;
  /** Optional base64-encoded media payload (used for Baileys uploads from Dashboard/API). */
  mediaBase64?: string;
  mimeType?: string;
  fileName?: string;
  /** Meta Cloud approved template configuration. */
  templateName?: string;
  templateLanguage?: string;
  templateHeaderMediaType?: 'image' | 'video' | 'document';
  templateHeaderMediaUrl?: string;
  templateButtons?: BroadcastTemplateButton[];
}

export interface BroadcastAudienceFilter {
  /** Natural-language segment description or keyword filter (e.g. "VIP leads interested in pricing"). */
  query?: string;
  /** Dossier stages to include (e.g. ['lead', 'qualified', 'customer']). */
  stages?: string[];
  chatMode?: "autopilot" | "copilot" | "human";
  /** Minimum number of prior messages required to qualify as a previous connection. */
  minMessages?: number;
  skipActiveHours?: number;
  /** Only include contacts active within the last N days. */
  activeWithinDays?: number;
  /** Only include contacts inactive for at least N days (re-engagement). */
  inactiveAtLeastDays?: number;
  /** Exclude opted-out contacts (defaults to true). */
  excludeOptedOut?: boolean;
  /** Explicit subset of chat IDs to target (must still have a previous connection). */
  chatIds?: string[];
  /** Maximum contacts to include (capped at 500). */
  limit?: number;
}

export interface BroadcastFollowUpConfig {
  enabled: boolean;
  /** Delay in minutes after trigger event before sending follow-up. */
  delayMinutes: number;
  /** Maximum number of follow-up nudges per recipient (1-3). */
  maxFollowUps: number;
  /** Trigger condition: read without reply, or delivered without reply. */
  triggerOn: 'read_no_reply' | 'delivered_no_reply';
  /** Guidance prompt for the AI agent when generating the follow-up. */
  messagePrompt: string;
}

export interface BroadcastPacingConfig {
  minDelayMs: number;
  maxWindowMinutes?: number;
  maxDelayMs: number;
  quietHours?: {
    from: number;
    to: number;
    timeZone: string;
  };
}

export interface BroadcastHistoryEntry { role: "customer" | "business"; text: string }

export interface EligibleContact {
  chatId: string;
  name: string;
  phoneNumber?: string;
  stage: string;
  facts: string[];
  preferredTone?: string;
  notes?: string;
  memories: string[];
  messageCount: number;
  nameSource?: "inferred_from_chat" | "contact" | "unknown";
  lastSnippet?: string;
  nameConfidence?: number;
  lastMessageAtMs?: number;
  lastInboundAtMs?: number;
}

export interface BroadcastCampaign {
  id: string;
  name: string;
  goal: string;
  transport: BroadcastTransport;
  approvalMode: BroadcastApprovalMode;
  status: BroadcastCampaignStatus;
  audienceFilter: BroadcastAudienceFilter;
  richContent: BroadcastRichContent;
  followUp: BroadcastFollowUpConfig;
  pacing: BroadcastPacingConfig;
  createdBy: 'owner' | 'agent';
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface BroadcastRecipient {
  id: string;
  campaignId: string;
  chatId: string;
  contactName: string;
  phoneNumber?: string;
  transportUsed?: 'baileys' | 'meta-cloud';
  personalizedText: string;
  richContent: BroadcastRichContent;
  status: BroadcastRecipientStatus;
  providerMessageId?: string;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  repliedAt?: number;
  followUpCount: number;
  nextFollowUpAt?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BroadcastCampaignStats {
  total: number;
  draft: number;
  approved: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  followedUp: number;
  skipped: number;
  failed: number;
  optedOut: number;
}

export interface BroadcastCampaignSummary extends BroadcastCampaign {
  stats: BroadcastCampaignStats;
}
