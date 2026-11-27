export type AgentMode = 'autopilot' | 'copilot' | 'human';

export interface QuotedMessageInfo {
  id: string;
  sender: string;
  senderName?: string;
  text: string;
  type?: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  sender: string;
  senderName?: string;
  text: string;
  timestamp: number;
  isFromMe: boolean;
  type: 'text' | 'audio' | 'image' | 'video' | 'document' | 'other';
  mediaUrl?: string;
  transcription?: string;
  replyToId?: string;
  quotedMessage?: QuotedMessageInfo;
  reactions?: string[];
  status?: 'pending' | 'sent' | 'delivered' | 'read';
  sendIntentId?: string;
  deliveryState?: 'queued' | 'attempting' | 'uncertain' | 'failed';
  lastAttemptAt?: number;
  nativeMessageId?: string;
}

export interface ChatSummary {
  id: string;
  name: string;
  phoneNumber?: string;
  unreadCount: number;
  lastMessage?: string;
  lastTimestamp?: number;
  isGroup: boolean;
  agentMode: AgentMode;
  avatarUrl?: string;
}

export interface ModelRoutingTrace {
  selectedModel: string;
  tier: 'trivial' | 'standard' | 'complex';
  confidence: number;
  routerLatencyMs: number;
  reason: string;
  bypassed?: boolean;
}

export interface AgentDecision {
  action: 'reply' | 'draft' | 'ignore' | 'human' | 'act';
  intent: string;
  replyText?: string;
  reasoning: string;
  confidence: number;
  simulatedDelayMs: number;
  suggestedReaction?: string;
  modelRouting?: ModelRoutingTrace;
}

export interface PendingToolCall {
  namespacedName: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: 'readOnly' | 'mutating';
  reason?: string;
  proposedFollowUp?: string;
}

export interface AgentDraft {
  id: string;
  chatId: string;
  incomingMessageId: string;
  incomingText: string;
  proposedReply: string;
  sendAsVoiceNote?: boolean;
  reasoning: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'sent';
  createdAt: number;
  modelRouting?: ModelRoutingTrace;
  toolCall?: PendingToolCall;
}

export interface ContactDossier {
  chatId: string;
  name: string;
  phone?: string;
  stage?: 'lead' | 'qualified' | 'negotiation' | 'customer' | 'vip' | 'archived';
  facts: string[];
  commitments: string[];
  preferredTone?: string;
  notes?: string;
  updatedAt: number;
}

export interface SystemStatus {
  state: 'disconnected' | 'connecting' | 'qr_ready' | 'pairing_code_ready' | 'connected' | 'failed' | 'disabled';
  qrDataUrl?: string;
  pairingCode?: string;
  connectedUser?: {
    id: string;
    name?: string;
    phone?: string;
  };
  error?: string;
  pendingDraftsCount?: number;
  updatedAt?: number;
  transportMode?: string;
  metaCloudConfigured?: boolean;
  reason?: string;
}

export interface GeminiModelOption {
  id: string;
  name: string;
  generation: 4 | 3;
  tier: 'flagship' | 'frontier' | 'workhorse' | 'multimodal' | 'legacy';
  description: string;
  recommendedRole: string;
}

export const SUPPORTED_GEMINI_MODELS: readonly GeminiModelOption[] = [
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    generation: 4,
    tier: 'flagship',
    description: 'Flagship frontier model for deep reasoning, complex logic, and architecture',
    recommendedRole: 'Deep reasoning, complex dispute resolution, advanced logic'
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    generation: 4,
    tier: 'frontier',
    description: 'Balanced frontier workhorse for software engineering and conversation moderation',
    recommendedRole: 'Primary agent persona, complex inquiries, long conversation context'
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    generation: 4,
    tier: 'workhorse',
    description: 'High-speed execution model built for rapid agentic workflows and everyday tasks',
    recommendedRole: 'Fast agent turns, standard inquiries, high-throughput routing'
  },
  {
    id: 'gemini-4-neon',
    name: 'Gemini 4 Neon',
    generation: 4,
    tier: 'multimodal',
    description: 'Low-latency multimodal execution engine for fast vision and audio processing',
    recommendedRole: 'Multimodal analysis, audio transcription, image inspection'
  },
  {
    id: 'gemini-4-flash',
    name: 'Gemini 4 Flash',
    generation: 4,
    tier: 'workhorse',
    description: 'Fast, responsive execution tier for high-frequency conversation turns',
    recommendedRole: 'General fast execution'
  },
  {
    id: 'gemini-4-pro',
    name: 'Gemini 4 Pro',
    generation: 4,
    tier: 'frontier',
    description: 'Advanced frontier model for complex reasoning and enterprise workloads',
    recommendedRole: 'Enterprise reasoning & compliance'
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    generation: 3,
    tier: 'legacy',
    description: 'Fast standard model from previous generation',
    recommendedRole: 'Legacy fallback & high-speed backup'
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    generation: 3,
    tier: 'legacy',
    description: 'Capable reasoning model from previous generation',
    recommendedRole: 'Legacy reasoning backup'
  }
];

export interface ModeratorPersona {
  name: string;
  language: string;
  tone: string;
  systemPrompt: string;
  rules: string[];
  model: string;
  temperature: number;
  minConfidence: number;
  simulateTypingDelay: boolean;
  minTypingDelayMs: number;
  maxTypingDelayMs: number;
  voiceName?: string;
}

export interface PolicyConfig {
  version: number;
  defaultAction: string;
  minConfidence: number;
  rules: Array<{
    id: string;
    intent: string;
    effect: 'allow' | 'require_approval' | 'deny';
    action?: string;
  }>;
}

export interface WorkspaceStats {
  chatsCount: number;
  messagesCount: number;
  draftsCount: number;
  memoriesCount: number;
  foldsCount: number;
  dbSizeBytes: number;
  connectionState: SystemStatus['state'] | null;
  connectedUser?: SystemStatus['connectedUser'] | null;
  transportMode: string;
}

export interface WorkspaceCleanResult {
  success: boolean;
  freedBytes: number;
  cleanedItems: string[];
}

export interface ConversationFold {
  id: string;
  chatId: string;
  tier: 1 | 2 | 3;
  topic: string;
  summary: string;
  startMessageId: string;
  endMessageId: string;
  directMessageIds: string[];
  sourceFoldIds: string[];
  messageCount: number;
  factsExtracted: string[];
  createdAt: number;
  survivedCount?: number;
  generation?: 'young' | 'old';
}

export interface ContextBudgetStatus {
  chatId: string;
  model: string;
  modelLimitTokens: number;
  targetContextBudget: number;
  currentTokens: number;
  tokensSaved: number;
  compressionRatio: number;
  activeFoldsCount: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  rawMessageCount: number;
  uncompressedMessageCount: number;
  preservedRecentCount: number;
  nudgeDecision: 'idle' | 'soft' | 'strong';
}

export type BroadcastTransport = 'auto' | 'baileys' | 'meta-cloud';
export type BroadcastApprovalMode = 'preview_approve' | 'autonomous';
export type BroadcastRichKind = 'text' | 'image' | 'video' | 'document' | 'voice_note' | 'template';
export type BroadcastCampaignStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'cancelled';
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

export interface BroadcastRichContent {
  kind: BroadcastRichKind;
  messageGoal: string;
  compositionMode?: 'conversation' | 'template';
  brief?: {cta: string; tone: string; constraints: string; useBrandKnowledge: boolean};
  personalization?: {nameSource: string; historyCount: number; brandSources: number; nameConfidence?: number; lastSnippet?: string};
  mediaUrl?: string;
  mediaBase64?: string;
  mimeType?: string;
  fileName?: string;
  templateName?: string;
  templateLanguage?: string;
  templateHeaderMediaType?: 'image' | 'video' | 'document';
  templateHeaderMediaUrl?: string;
  templateButtons?: Array<{ type: 'url' | 'quick_reply'; text: string; urlOrPayload?: string }>;
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

export interface BroadcastCampaignSummary {
  id: string;
  name: string;
  goal: string;
  transport: BroadcastTransport;
  approvalMode: BroadcastApprovalMode;
  status: BroadcastCampaignStatus;
  richContent: BroadcastRichContent;
  followUp: {
    enabled: boolean;
    delayMinutes: number;
    maxFollowUps: number;
    triggerOn: 'read_no_reply' | 'delivered_no_reply';
    messagePrompt: string;
  };
  createdBy: 'owner' | 'agent';
  createdAt: number;
  updatedAt: number;
  stats: BroadcastCampaignStats;
}

export interface BroadcastRecipient {
  id: string;
  campaignId: string;
  chatId: string;
  contactName: string;
  phoneNumber?: string;
  transportUsed?: 'baileys' | 'meta-cloud';
  personalizedText: string;
  richContent?: BroadcastRichContent;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  repliedAt?: number;
  status: BroadcastRecipientStatus;
  followUpCount: number;
  error?: string;
}

export interface EligibleBroadcastContact {
  chatId: string;
  name: string;
  phoneNumber?: string;
  stage: string;
  messageCount: number;
  lastMessageAtMs?: number;
  nameSource?: 'inferred_from_chat' | 'contact' | 'unknown';
  nameConfidence?: number;
  lastSnippet?: string;
}

export interface BroadcastAudienceFilter {chatIds?: string[]; query?: string; stages?: string[]; activeWithinDays?: number; inactiveAtLeastDays?: number; chatMode?: 'autopilot' | 'copilot' | 'human'; skipActiveHours?: number; limit?: number}
