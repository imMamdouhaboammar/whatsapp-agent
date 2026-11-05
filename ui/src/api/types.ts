export type AgentMode = 'autopilot' | 'copilot' | 'human';

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
  status?: 'pending' | 'sent' | 'delivered' | 'read';
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

export interface AgentDecision {
  action: 'reply' | 'draft' | 'ignore' | 'human';
  intent: string;
  replyText?: string;
  reasoning: string;
  confidence: number;
  simulatedDelayMs: number;
  suggestedReaction?: string;
}

export interface AgentDraft {
  id: string;
  chatId: string;
  incomingMessageId: string;
  incomingText: string;
  proposedReply: string;
  reasoning: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'sent';
  createdAt: number;
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
