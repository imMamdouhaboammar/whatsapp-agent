import type { ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus, AgentDraft, ContactDossier } from './types';

const BASE_URL = '/api';

export const api = {
  async getStatus(): Promise<SystemStatus> {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error('Failed to fetch status');
    return res.json();
  },

  async getDossier(chatId: string): Promise<{ dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier`);
    if (!res.ok) throw new Error('Failed to fetch dossier');
    return res.json();
  },

  async addFact(chatId: string, fact: string): Promise<{ success: boolean; dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier/facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact })
    });
    return res.json();
  },

  async addCommitment(chatId: string, commitment: string): Promise<{ success: boolean; dossier: ContactDossier }> {
    const res = await fetch(`${BASE_URL}/contacts/${encodeURIComponent(chatId)}/dossier/commitments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitment })
    });
    return res.json();
  },

  async connect(phoneNumber?: string): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingPhoneNumber: phoneNumber })
    });
    return res.json();
  },

  async disconnect(): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/disconnect`, { method: 'POST' });
    return res.json();
  },

  async listChats(): Promise<{ chats: ChatSummary[] }> {
    const res = await fetch(`${BASE_URL}/chats`);
    return res.json();
  },

  async getMessages(chatId: string): Promise<{ messages: ChatMessage[] }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`);
    return res.json();
  },

  async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<{ success: boolean; message: ChatMessage }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, replyToMessageId })
    });
    return res.json();
  },

  async setChatMode(chatId: string, mode: 'autopilot' | 'copilot' | 'human'): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    return res.json();
  },

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/chats/${encodeURIComponent(chatId)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, emoji })
    });
    return res.json();
  },

  async listDrafts(): Promise<{ drafts: AgentDraft[] }> {
    const res = await fetch(`${BASE_URL}/drafts`);
    return res.json();
  },

  async approveDraft(draftId: string, editedText?: string, asVoice?: boolean): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedText, asVoice })
    });
    return res.json();
  },

  async rejectDraft(draftId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/drafts/${draftId}/reject`, { method: 'POST' });
    return res.json();
  },

  async getPersona(): Promise<{ persona: ModeratorPersona; policy: PolicyConfig }> {
    const res = await fetch(`${BASE_URL}/persona`);
    return res.json();
  },

  async updatePersona(persona: Partial<ModeratorPersona>, policy?: Partial<PolicyConfig>): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/persona`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, policy })
    });
    return res.json();
  },

  async simulate(text: string, senderName?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, senderName })
    });
    return res.json();
  }
};
