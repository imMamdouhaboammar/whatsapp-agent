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
  action: 'reply' | 'draft' | 'ignore' | 'human';
  intent: string;
  replyText?: string;
  reasoning: string;
  confidence: number;
  simulatedDelayMs: number;
  suggestedReaction?: string;
  modelRouting?: ModelRoutingTrace;
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
}

export interface ContactDossier {
  chatId: string;
  name: string;
  phone?: string;
  stage?: 'lead' | 'qualified' | 'negotiation' | 'customer' | 'vip';
  facts: string[];
  commitments: string[];
  preferredTone?: string;
  notes?: string;
  updatedAt: number;
}

export interface SystemStatus {
  state: 'disconnected' | 'connecting' | 'qr_ready' | 'pairing_code_ready' | 'connected' | 'failed';
  qrDataUrl?: string;
  pairingCode?: string;
  connectedUser?: {
    id: string;
    name?: string;
    phone?: string;
  };
  error?: string;
  pendingDraftsCount: number;
  updatedAt: number;
}

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
