export type AutonomyAction = 'reply' | 'draft' | 'ignore' | 'human' | 'act';
export type PolicyEffect = 'allow' | 'require_approval' | 'deny';
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
  mediaBuffer?: Buffer | Uint8Array;
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
  action: AutonomyAction;
  intent: string;
  replyText?: string;
  reasoning: string;
  confidence: number;
  simulatedDelayMs: number;
  suggestedReaction?: string;
}

export interface PolicyRule {
  id: string;
  intent: string;
  effect: PolicyEffect;
  action?: AutonomyAction;
  minConfidence?: number;
}

export interface PolicyConfig {
  version: number;
  defaultAction: AutonomyAction;
  minConfidence: number;
  rules: PolicyRule[];
}

export interface ModeratorPersona {
  name: string;
  language: 'ar-EG' | 'ar-SA' | 'en' | string;
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

export type ConnectionState = 'disconnected' | 'connecting' | 'qr_ready' | 'pairing_code_ready' | 'connected' | 'failed';

export interface PairingState {
  state: ConnectionState;
  qrDataUrl?: string;
  pairingCode?: string;
  connectedUser?: {
    id: string;
    name?: string;
    phone?: string;
  };
  error?: string;
  updatedAt: number;
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
