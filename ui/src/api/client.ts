import type { ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus, AgentDraft, AgentDecision, ContactDossier, WorkspaceStats, WorkspaceCleanResult, ContextBudgetStatus, ConversationFold, BroadcastCampaignSummary, BroadcastRecipient, EligibleBroadcastContact, BroadcastTransport, BroadcastApprovalMode, BroadcastRichContent, BroadcastAudienceFilter } from './types';
import { record, responseContracts, type ResponseContract } from './response-contracts';

const BASE_URL = '/api';

/** WA-026: HTTP failures carry their status so callers can classify them (401 vs 503 vs offline). */
export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function handleResponse<T>(res: Response, fallbackError: string, matches: ResponseContract<T>): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const errorBody: unknown = await res.json().catch(() => null);
    const error = record(errorBody) ? errorBody.error : undefined;
    const message = record(errorBody) ? errorBody.message : undefined;
    throw new ApiError(
      (typeof error === 'string' && error) || (typeof message === 'string' && message) || fallbackError,
      res.status,
    );
  }
  if (contentType && !contentType.includes('application/json')) {
    throw new ApiError(`${fallbackError} (unexpected ${contentType.split(';')[0]} response)`, res.status);
  }
  const value: unknown = await res.json();
  if (!matches(value)) throw new ApiError(`${fallbackError} (invalid response body)`, res.status);
  return value;
}

export type FunnelMode = 'ALL_SETTLED' | 'FIRST_SUCCESS' | 'QUORUM';

export interface FunnelTargetMeta {
  id: string;
  name: string;
  enabled?: boolean;
  method?: string;
  timeoutMs?: number;
}

export interface FunnelMethodMeta {
  method: string;
  description: string;
  mode: FunnelMode;
  targets: FunnelTargetMeta[];
  timeoutMs: number;
  quorumCount?: number;
}

export interface CircuitBreakerStatus {
  targetId: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  cooldownRemainingMs?: number;
}

export interface FunnelTargetResult {
  targetId: string;
  targetName: string;
  statusCode: number;
  durationMs: number;
  success: boolean;
  cancelled?: boolean;
  data?: unknown;
  error?: string;
}

export interface FunnelDispatchResult {
  traceId: string;
  method: string;
  mode: FunnelMode;
  startedAt: string;
  totalDurationMs: number;
  success: boolean;
  successfulCount: number;
  failedCount: number;
  results: FunnelTargetResult[];
  winningTargetId?: string;
  error?: string;
}

export interface ContactMemoryItem {
  id: string;
  content: string;
  created_at: number;
}

interface SimulationResult {
  success: boolean;
  simulatedMessage: ChatMessage;
  decision?: AgentDecision;
  draftCreated?: AgentDraft;
  shouldSendImmediately: boolean;
}

export interface StickerResult {
  success?: boolean;
  bytes?: number;
  stickerBase64?: string;
  error?: string;
  mimeType?: string;
}

export const api = {
  async getDashboardStatus(): Promise<{ required: boolean; authenticated: boolean }> {
    const res = await fetch(`${BASE_URL}/auth/status`, { cache: 'no-store' });
    return handleResponse(res, 'Owner access status unavailable', responseContracts.dashboardStatus);
  },

  async startDashboardSession(token: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!res.ok) throw new Error('Invalid owner access token');
  },

  async endDashboardSession(): Promise<void> {
    const res = await fetch(`${BASE_URL}/auth/session`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not sign out');
  },

  async getStatus(): Promise<SystemStatus> {
    const res = await fetch(`${BASE_URL}/status`);
    return handleResponse(res, 'Failed to fetch status', responseContracts.systemStatus);
  },

  async getDossier(chatId: string): Promise<{ dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier`);
    return handleResponse(res, 'Failed to fetch dossier', responseContracts.dossier);
  },

  async addFact(chatId: string, fact: string): Promise<{ success: boolean; dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact })
    });
    return handleResponse(res, 'Failed to add contact fact', responseContracts.updatedDossier);
  },

  async addCommitment(chatId: string, commitment: string): Promise<{ success: boolean; dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier/commitments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitment })
    });
    return handleResponse(res, 'Failed to add contact commitment', responseContracts.updatedDossier);
  },

  async connect(phoneNumber?: string, refresh?: boolean): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingPhoneNumber: phoneNumber, refresh })
    });
    return handleResponse(res, 'Failed to initiate WhatsApp connection', responseContracts.status);
  },

  async disconnect(clearSession: boolean = true): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearSession })
    });
    return handleResponse(res, 'Failed to disconnect WhatsApp', responseContracts.status);
  },

  async getRuntimeCapabilities(): Promise<{ capabilities: Array<{ capability: string; enabled: boolean; reason: string }> }> {
    const res = await fetch(`${BASE_URL}/runtime/capabilities`, { cache: 'no-store' });
    return handleResponse(res, 'Failed to fetch runtime capabilities', responseContracts.capabilities);
  },

  async listChats(): Promise<{ chats: ChatSummary[] }> {
    const res = await fetch(`${BASE_URL}/chats`);
    return handleResponse(res, 'Failed to list chats', responseContracts.chats);
  },

  async getMessages(chatId: string, options?: { signal?: AbortSignal }): Promise<{ messages: ChatMessage[] }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`, { signal: options?.signal });
    return handleResponse(res, 'Failed to fetch messages', responseContracts.chatMessages);
  },

  async sendMessage(chatId: string, text: string, replyToMessageId?: string, clientMutationId?: string): Promise<{ success: boolean; message?: ChatMessage; state: string; intentId: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, replyToMessageId, clientMutationId: clientMutationId || crypto.randomUUID() })
    });
    return handleResponse(res, 'Failed to send message', responseContracts.sendMessage);
  },

  async retrySendIntent(intentId: string, clientMutationId: string): Promise<{ success: boolean; state: string; intentId: string }> {
    const res = await fetch(`${BASE_URL}/send-intents/${encodeURIComponent(intentId)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, clientMutationId })
    });
    return handleResponse(res, 'Failed to retry send intent', responseContracts.sendIntent);
  },

  async setChatMode(chatId: string, mode: 'autopilot' | 'copilot' | 'human'): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    return handleResponse(res, 'Failed to set chat mode', responseContracts.success);
  },

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, emoji })
    });
    return handleResponse(res, 'Failed to send reaction', responseContracts.success);
  },

  async listDrafts(): Promise<{ drafts: AgentDraft[] }> {
    const res = await fetch(`${BASE_URL}/drafts`);
    return handleResponse(res, 'Failed to list drafts', responseContracts.drafts);
  },

  async approveDraft(draftId: string, editedText?: string, asVoice?: boolean): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedText, asVoice })
    });
    return handleResponse(res, 'Failed to approve draft', responseContracts.success);
  },

  async rejectDraft(draftId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/drafts/${draftId}/reject`, { method: 'POST' });
    return handleResponse(res, 'Failed to reject draft', responseContracts.success);
  },

  async getPersona(): Promise<{ persona: ModeratorPersona; policy: PolicyConfig }> {
    const res = await fetch(`${BASE_URL}/persona`);
    return handleResponse(res, 'Failed to fetch persona', responseContracts.persona);
  },

  async updatePersona(persona: Partial<ModeratorPersona>, policy?: Partial<PolicyConfig>): Promise<{ success: boolean; persona: ModeratorPersona; policy: PolicyConfig }> {
    const res = await fetch(`${BASE_URL}/persona`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, policy })
    });
    return handleResponse(res, 'Failed to update persona', responseContracts.personaUpdate);
  },

  async simulate(text: string, senderName?: string): Promise<SimulationResult> {
    const res = await fetch(`${BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, senderName })
    });
    return handleResponse(res, 'Could not preview assistant response', responseContracts.simulation);
  },

  async getFunnelMethods(signal?: AbortSignal): Promise<{ methods: FunnelMethodMeta[] }> {
    const res = await fetch(`${BASE_URL}/funnel/methods`, { signal, cache: 'no-store' });
    return handleResponse(res, 'Failed to fetch funnel methods', responseContracts.funnelMethods);
  },

  async getFunnelStats(signal?: AbortSignal): Promise<{ circuitBreakers: CircuitBreakerStatus[]; activeMethodsCount: number }> {
    const res = await fetch(`${BASE_URL}/funnel/stats`, { signal, cache: 'no-store' });
    return handleResponse(res, 'Failed to fetch funnel stats', responseContracts.funnelStats);
  },

  async dispatchFunnel(data: { method: string; payload?: Record<string, unknown>; queryParams?: Record<string, string>; timeoutMs?: number }, key: string): Promise<FunnelDispatchResult> {
    const res = await fetch(`${BASE_URL}/funnel/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key.trim() },
      body: JSON.stringify(data)
    });
    return handleResponse(res, 'Failed to dispatch funnel request', responseContracts.funnelDispatch);
  },

  async resetCircuitBreaker(targetId: string, key: string): Promise<{ success: boolean; targetId: string }> {
    const res = await fetch(`${BASE_URL}/funnel/circuit-breaker/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key.trim() },
      body: JSON.stringify({ targetId })
    });
    return handleResponse(res, 'Failed to reset circuit breaker', responseContracts.circuitBreakerReset);
  },

  async getMemories(chatId: string): Promise<{ memories: ContactMemoryItem[] }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/memories`);
    return handleResponse(res, 'Failed to fetch contact memories', responseContracts.contactMemories);
  },

  async addMemory(chatId: string, content: string): Promise<{ status: string; message?: string; memories?: ContactMemoryItem[] }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return handleResponse(res, 'Failed to save contact memory', responseContracts.savedMemory);
  },

  async deleteMemory(chatId: string, memoryId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE'
    });
    return handleResponse(res, 'Failed to delete contact memory', responseContracts.success);
  },

  async getChatStyle(chatId: string): Promise<{ style: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/style`);
    return handleResponse(res, 'Failed to fetch chat style', responseContracts.style);
  },

  async setChatStyle(chatId: string, style: string): Promise<{ success: boolean; style: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style })
    });
    return handleResponse(res, 'Failed to update chat style', responseContracts.updatedStyle);
  },

  async sendSticker(chatId: string, stickerBase64: string, clientMutationId: string): Promise<{ success: boolean; message?: ChatMessage; state: string; intentId: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/stickers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stickerBase64, clientMutationId })
    });
    return handleResponse(res, 'Failed to send sticker', responseContracts.sendMessage);
  },

  async createSticker(data: { imageBase64: string; mimeType: string; crop?: boolean; text?: string }): Promise<StickerResult> {
    const res = await fetch(`${BASE_URL}/media/sticker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse(res, 'Failed to generate sticker', responseContracts.sticker);
  },

  async deleteChat(chatId: string): Promise<{ success: boolean; chatId: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}`, {
      method: 'DELETE'
    });
    return handleResponse(res, 'Failed to delete chat', responseContracts.chatMutation);
  },

  async clearChatMessages(chatId: string): Promise<{ success: boolean; chatId: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'DELETE'
    });
    return handleResponse(res, 'Failed to clear chat messages', responseContracts.chatMutation);
  },

  async getWorkspaceStats(): Promise<WorkspaceStats> {
    const res = await fetch(`${BASE_URL}/workspace/stats`);
    return handleResponse(res, 'Failed to fetch workspace storage stats', responseContracts.workspaceStats);
  },

  async cleanWorkspace(): Promise<WorkspaceCleanResult> {
    const res = await fetch(`${BASE_URL}/workspace/clean`, {
      method: 'POST'
    });
    return handleResponse(res, 'Failed to clean workspace cache', responseContracts.workspaceClean);
  },

  async resetWorkspace(target: 'all' | 'session' | 'chats' | 'drafts' | 'memories' | 'learning' | 'cache'): Promise<{ success: boolean; target: string; [key: string]: unknown }> {
    const res = await fetch(`${BASE_URL}/workspace/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    return handleResponse(res, `Failed to reset workspace ${target}`, responseContracts.workspaceReset);
  },

  async getContextStatus(chatId: string): Promise<{ chatId: string; status: ContextBudgetStatus | null }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/context-status`);
    return handleResponse(res, 'Failed to fetch context status', responseContracts.contextStatus);
  },

  async getFolds(chatId: string, tier?: number): Promise<{ chatId: string; folds: ConversationFold[] }> {
    const q = tier ? `?tier=${tier}` : '';
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/folds${q}`);
    return handleResponse(res, 'Failed to fetch folds', responseContracts.folds);
  },

  async foldNow(chatId: string): Promise<{ chatId: string; status: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/fold-now`, { method: 'POST' });
    return handleResponse(res, 'Failed to trigger context compression', responseContracts.foldCompression);
  },

  async searchMemory(chatId: string, query: string, limit = 25): Promise<{ chatId: string; query: string; results: { messages: ChatMessage[]; folds: ConversationFold[] } }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/memory-search?query=${encodeURIComponent(query)}&limit=${limit}`);
    return handleResponse(res, 'Failed to search memory', responseContracts.memorySearch);
  },

  async decompressFold(chatId: string, foldId: string, aroundId?: string): Promise<{ foldId: string; chatId: string; total: number; messages: ChatMessage[] }> {
    const q = aroundId ? `?around=${encodeURIComponent(aroundId)}` : '';
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/folds/${encodeURIComponent(foldId)}/decompress${q}`);
    return handleResponse(res, 'Failed to decompress fold', responseContracts.decompressedFold);
  },

  async listBroadcasts(): Promise<{ campaigns: BroadcastCampaignSummary[] }> {
    const res = await fetch(`${BASE_URL}/broadcasts`);
    return handleResponse(res, 'Failed to load broadcasts', responseContracts.broadcasts);
  },

  async previewBroadcastAudience(audiencePrompt?: string, filter?: BroadcastAudienceFilter): Promise<{ contacts: EligibleBroadcastContact[]; excludedNoInbound?: number }> {
    const res = await fetch(`${BASE_URL}/broadcasts/audience`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audiencePrompt, filter })
    });
    return handleResponse(res, 'Failed to preview audience', responseContracts.broadcastAudience);
  },

  async createBroadcast(payload: {
    name: string;
    goal: string;
    transport: BroadcastTransport;
    approvalMode: BroadcastApprovalMode;
    audiencePrompt?: string;
    audienceFilter?: BroadcastAudienceFilter;
    permissionConfirmed?: boolean;
    pacing?: {minDelayMs: number; maxDelayMs: number; maxWindowMinutes?: number; quietHours?: {from:number;to:number;timeZone:string}};
    richContent: BroadcastRichContent;
    followUp?: { enabled: boolean; delayMinutes: number; triggerOn: 'read_no_reply' | 'delivered_no_reply'; messagePrompt: string };
  }): Promise<{ campaign: BroadcastCampaignSummary; recipients: BroadcastRecipient[] }> {
    const res = await fetch(`${BASE_URL}/broadcasts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return handleResponse(res, 'Failed to create broadcast', responseContracts.broadcastDetails);
  },

  async getBroadcast(id: string): Promise<{ campaign: BroadcastCampaignSummary; recipients: BroadcastRecipient[] }> {
    const res = await fetch(`${BASE_URL}/broadcasts/${encodeURIComponent(id)}`);
    return handleResponse(res, 'Failed to load broadcast details', responseContracts.broadcastDetails);
  },

  async updateBroadcastRecipient(
    campaignId: string,
    recipientId: string,
    patch: { personalizedText?: string; status?: 'draft' | 'approved' | 'skipped' }
  ): Promise<{ recipient: BroadcastRecipient }> {
    const res = await fetch(`${BASE_URL}/broadcasts/${encodeURIComponent(campaignId)}/recipients/${encodeURIComponent(recipientId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return handleResponse(res, 'Failed to update recipient', responseContracts.broadcastRecipient);
  },

  async regenerateBroadcastRecipient(campaignId: string, recipientId: string, name?: string): Promise<{recipient:BroadcastRecipient}> {
    const res = await fetch(`${BASE_URL}/broadcasts/${encodeURIComponent(campaignId)}/recipients/${encodeURIComponent(recipientId)}/regenerate`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name}),
    });
    return handleResponse(res,'Failed to regenerate draft',responseContracts.broadcastRecipient);
  },

  async approveBroadcast(id: string): Promise<{ campaign: BroadcastCampaignSummary }> {
    const res = await fetch(`${BASE_URL}/broadcasts/${encodeURIComponent(id)}/approve`, { method: 'POST' });
    return handleResponse(res, 'Failed to approve broadcast', responseContracts.broadcastCampaign);
  },

  async pauseBroadcast(id: string): Promise<{ campaign: BroadcastCampaignSummary }> {
    const res = await fetch(`${BASE_URL}/broadcasts/${encodeURIComponent(id)}/pause`, { method: 'POST' });
    return handleResponse(res, 'Failed to pause broadcast', responseContracts.broadcastCampaign);
  },

  async cancelBroadcast(id: string): Promise<{ campaign: BroadcastCampaignSummary }> {
    const res = await fetch(`${BASE_URL}/broadcasts/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    return handleResponse(res, 'Failed to cancel broadcast', responseContracts.broadcastCampaign);
  }
};
