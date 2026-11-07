import type { ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus, AgentDraft, ContactDossier } from './types';

const BASE_URL = '/api';

async function handleResponse<T>(res: Response, fallbackError: string): Promise<T> {
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(errorBody?.error || errorBody?.message || fallbackError);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getDashboardStatus(): Promise<{ required: boolean; authenticated: boolean }> {
    const res = await fetch(`${BASE_URL}/auth/status`, { cache: 'no-store' });
    return handleResponse<{ required: boolean; authenticated: boolean }>(res, 'Owner access status unavailable');
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
    return handleResponse<SystemStatus>(res, 'Failed to fetch status');
  },

  async getDossier(chatId: string): Promise<{ dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier`);
    return handleResponse<{ dossier: ContactDossier }>(res, 'Failed to fetch dossier');
  },

  async addFact(chatId: string, fact: string): Promise<{ success: boolean; dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact })
    });
    return handleResponse<{ success: boolean; dossier: ContactDossier }>(res, 'Failed to add contact fact');
  },

  async addCommitment(chatId: string, commitment: string): Promise<{ success: boolean; dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier/commitments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitment })
    });
    return handleResponse<{ success: boolean; dossier: ContactDossier }>(res, 'Failed to add contact commitment');
  },

  async connect(phoneNumber?: string): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingPhoneNumber: phoneNumber })
    });
    return handleResponse<{ status: string }>(res, 'Failed to initiate WhatsApp connection');
  },

  async disconnect(): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/disconnect`, { method: 'POST' });
    return handleResponse<{ status: string }>(res, 'Failed to disconnect WhatsApp');
  },

  async listChats(): Promise<{ chats: ChatSummary[] }> {
    const res = await fetch(`${BASE_URL}/chats`);
    return handleResponse<{ chats: ChatSummary[] }>(res, 'Failed to list chats');
  },

  async getMessages(chatId: string): Promise<{ messages: ChatMessage[] }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`);
    return handleResponse<{ messages: ChatMessage[] }>(res, 'Failed to fetch messages');
  },

  async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<{ success: boolean; message: ChatMessage }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, replyToMessageId })
    });
    return handleResponse<{ success: boolean; message: ChatMessage }>(res, 'Failed to send message');
  },

  async setChatMode(chatId: string, mode: 'autopilot' | 'copilot' | 'human'): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    return handleResponse<{ success: boolean }>(res, 'Failed to set chat mode');
  },

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, emoji })
    });
    return handleResponse<{ success: boolean }>(res, 'Failed to send reaction');
  },

  async listDrafts(): Promise<{ drafts: AgentDraft[] }> {
    const res = await fetch(`${BASE_URL}/drafts`);
    return handleResponse<{ drafts: AgentDraft[] }>(res, 'Failed to list drafts');
  },

  async approveDraft(draftId: string, editedText?: string, asVoice?: boolean): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedText, asVoice })
    });
    return handleResponse<{ success: boolean }>(res, 'Failed to approve draft');
  },

  async rejectDraft(draftId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/drafts/${draftId}/reject`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(res, 'Failed to reject draft');
  },

  async getPersona(): Promise<{ persona: ModeratorPersona; policy: PolicyConfig }> {
    const res = await fetch(`${BASE_URL}/persona`);
    return handleResponse<{ persona: ModeratorPersona; policy: PolicyConfig }>(res, 'Failed to fetch persona');
  },

  async updatePersona(persona: Partial<ModeratorPersona>, policy?: Partial<PolicyConfig>): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/persona`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, policy })
    });
    return handleResponse<{ success: boolean }>(res, 'Failed to update persona');
  },

  async simulate(text: string, senderName?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, senderName })
    });
    return handleResponse<any>(res, 'Could not preview assistant response');
  },

  async getFunnelMethods(): Promise<{ methods: any[] }> {
    const res = await fetch(`${BASE_URL}/funnel/methods`);
    return handleResponse<{ methods: any[] }>(res, 'Failed to fetch funnel methods');
  },

  async getFunnelStats(): Promise<{ circuitBreakers: any[]; activeMethodsCount: number }> {
    const res = await fetch(`${BASE_URL}/funnel/stats`);
    return handleResponse<{ circuitBreakers: any[]; activeMethodsCount: number }>(res, 'Failed to fetch funnel stats');
  },

  async dispatchFunnel(data: { method: string; payload?: any; queryParams?: any; timeoutMs?: number }): Promise<any> {
    const res = await fetch(`${BASE_URL}/funnel/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<any>(res, 'Failed to dispatch funnel request');
  },

  async resetCircuitBreaker(targetId: string): Promise<{ success: boolean; targetId: string }> {
    const res = await fetch(`${BASE_URL}/funnel/circuit-breaker/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId })
    });
    return handleResponse<{ success: boolean; targetId: string }>(res, 'Failed to reset circuit breaker');
  },

  async getMemories(chatId: string): Promise<{ memories: any[] }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/memories`);
    return handleResponse<{ memories: any[] }>(res, 'Failed to fetch contact memories');
  },

  async addMemory(chatId: string, content: string): Promise<{ status: string; message?: string; memories?: any[] }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return handleResponse<{ status: string; message?: string; memories?: any[] }>(res, 'Failed to save contact memory');
  },

  async deleteMemory(chatId: string, memoryId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean }>(res, 'Failed to delete contact memory');
  },

  async getChatStyle(chatId: string): Promise<{ style: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/style`);
    return handleResponse<{ style: string }>(res, 'Failed to fetch chat style');
  },

  async setChatStyle(chatId: string, style: string): Promise<{ success: boolean; style: string }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style })
    });
    return handleResponse<{ success: boolean; style: string }>(res, 'Failed to update chat style');
  },

  async createSticker(data: { imageBase64: string; mimeType: string; crop?: boolean; text?: string }): Promise<any> {
    const res = await fetch(`${BASE_URL}/media/sticker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<any>(res, 'Failed to generate sticker');
  }
};
