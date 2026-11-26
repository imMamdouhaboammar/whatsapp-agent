import { GeminiClient } from '../src/ai/gemini-client';
import { describe, expect, it, spyOn } from 'bun:test';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApiServer } from '../src/server/api';
import { MemoryStore } from '../src/domain/memory-store';
import { DualMemoryManager } from '../src/domain/learning-memory';
import type { ChatMessage, ChatSummary } from '../src/domain/types';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';
import { ModeratorAgent } from '../src/ai/moderator-agent';
import { SSEBroadcaster } from '../src/server/sse';

describe('Workspace Reset & Cleaner Endpoints', () => {
  const testDataDir = './data/test_ws_reset_suite';

  const setupServer = () => {
    try {
      rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    mkdirSync(testDataDir, { recursive: true });

    const memory = new MemoryStore({ dataDir: testDataDir });
    const learningMemory = new DualMemoryManager({ storageDir: testDataDir });

    let disconnectCalledWithPurge = false;
    const mockClient = new WhatsAppSocketClient();
    spyOn(mockClient, 'getState').mockReturnValue({
      state: 'connected',
      connectedUser: { id: 'tester', phone: '+201092677269', name: 'Tester' },
      updatedAt: Date.now()
    });
    spyOn(mockClient, 'disconnect').mockImplementation(async (purgeCredentials) => {
      disconnectCalledWithPurge = Boolean(purgeCredentials);
    });
    spyOn(mockClient, 'start').mockResolvedValue();

    const mockAgent = new ModeratorAgent(new GeminiClient({ apiKey: 'test-key' }), memory);

    const broadcastEvents: Array<{ type: string; data?: unknown }> = [];
    const sse = new SSEBroadcaster();
    spyOn(sse, 'broadcast').mockImplementation((event, data) => {
      broadcastEvents.push({ type: event, data });
    });

    const app = createApiServer({
      dataDir: testDataDir,
      memoryStore: memory,
      whatsappClient: mockClient,
      moderatorAgent: mockAgent,
      dualMemoryManager: learningMemory,
      sse
    });

    return {
      app,
      memory,
      learningMemory,
      mockClient,
      broadcastEvents,
      getDisconnectCalledWithPurge: () => disconnectCalledWithPurge,
      cleanup: () => {
        memory.close();
        try {
          rmSync(testDataDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    };
  };

  it('DELETE /api/chats/:chatId deletes the specified chat and its messages', async () => {
    const { app, memory, broadcastEvents, cleanup } = setupServer();
    try {
      const chatId = 'target-chat@s.whatsapp.net';
      const chat: ChatSummary = {
        id: chatId,
        name: 'Target Chat',
        unreadCount: 0,
        isGroup: false,
        agentMode: 'autopilot',
        lastTimestamp: Date.now()
      };
      const msg: ChatMessage = {
        id: 'msg-1',
        chatId,
        sender: chatId,
        text: 'Hello test',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      };

      memory.saveChat(chat);
      memory.addMessage(msg);

      expect(memory.getChat(chatId)).toBeDefined();
      expect(memory.getMessages(chatId).length).toBe(1);

      const res = await app.request(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: 'DELETE'
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, chatId });

      expect(memory.getChat(chatId)).toBeUndefined();
      expect(memory.getMessages(chatId).length).toBe(0);

      const deleteEvent = broadcastEvents.find((e) => e.type === 'chat_deleted');
      expect(deleteEvent).toBeDefined();
      expect(deleteEvent?.data).toHaveProperty('chatId', chatId);
    } finally {
      cleanup();
    }
  });

  it('DELETE /api/chats/:chatId/messages clears messages but preserves chat entry', async () => {
    const { app, memory, broadcastEvents, cleanup } = setupServer();
    try {
      const chatId = 'keep-chat@s.whatsapp.net';
      const chat: ChatSummary = {
        id: chatId,
        name: 'Keep Chat',
        unreadCount: 2,
        isGroup: false,
        agentMode: 'copilot',
        lastTimestamp: Date.now()
      };
      const msg: ChatMessage = {
        id: 'msg-keep',
        chatId,
        sender: chatId,
        text: 'Clear me please',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      };

      memory.saveChat(chat);
      memory.addMessage(msg);

      const res = await app.request(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'DELETE'
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveProperty('success', true);

      // Chat record still exists
      expect(memory.getChat(chatId)).toBeDefined();
      // Messages are cleared
      expect(memory.getMessages(chatId).length).toBe(0);

      const clearEvent = broadcastEvents.find((e) => e.type === 'messages_cleared');
      expect(clearEvent).toBeDefined();
      expect(clearEvent?.data).toHaveProperty('chatId', chatId);
    } finally {
      cleanup();
    }
  });

  it('GET /api/workspace/stats returns database size and entity metrics', async () => {
    const { app, memory, cleanup } = setupServer();
    try {
      memory.saveChat({
        id: 'stats-chat@s.whatsapp.net',
        name: 'Stats Chat',
        unreadCount: 0,
        isGroup: false,
        agentMode: 'autopilot',
        lastTimestamp: Date.now()
      });
      memory.addMessage({
        id: 'stats-msg',
        chatId: 'stats-chat@s.whatsapp.net',
        sender: 'stats-chat@s.whatsapp.net',
        text: 'Stats message',
        timestamp: Date.now(),
        isFromMe: false,
        type: 'text'
      });

      const res = await app.request('/api/workspace/stats');
      expect(res.status).toBe(200);
      const stats: unknown = await res.json();
      if (!stats || typeof stats !== 'object' ||
          !('chatsCount' in stats) || typeof stats.chatsCount !== 'number' ||
          !('messagesCount' in stats) || typeof stats.messagesCount !== 'number' ||
          !('dbSizeBytes' in stats) || typeof stats.dbSizeBytes !== 'number') {
        throw new Error('Expected numeric workspace statistics');
      }
      expect(stats.chatsCount).toBeGreaterThanOrEqual(1);
      expect(stats.messagesCount).toBeGreaterThanOrEqual(1);
      expect(stats.dbSizeBytes).toBeGreaterThanOrEqual(0);
      expect(stats).toHaveProperty('connectionState', 'connected');
    } finally {
      cleanup();
    }
  });

  it('POST /api/workspace/clean cleans temporary files and optimizes SQLite storage', async () => {
    const { app, cleanup } = setupServer();
    try {
      // Create a temporary cache directory inside testDataDir that cleanWorkspace should detect and remove
      const dummyTestDir = join(testDataDir, '.temp');
      mkdirSync(dummyTestDir, { recursive: true });
      writeFileSync(join(dummyTestDir, 'dummy.txt'), 'hello world');

      const res = await app.request('/api/workspace/clean', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        success: true, cleanedItems: expect.arrayContaining([expect.stringContaining('.temp')])
      });
    } finally {
      cleanup();
    }
  });

  it('POST /api/workspace/reset supports selective targets', async () => {
    const { app, memory, getDisconnectCalledWithPurge, cleanup } = setupServer();
    try {
      // Seed data
      memory.saveChat({
        id: 'c1@s.whatsapp.net',
        name: 'C1',
        unreadCount: 0,
        isGroup: false,
        agentMode: 'autopilot',
        lastTimestamp: Date.now()
      });
      memory.saveDraft({
        id: 'draft-1',
        chatId: 'c1@s.whatsapp.net',
        incomingMessageId: 'inbound-1',
        incomingText: 'User question',
        proposedReply: 'Proposed response',
        confidence: 0.9,
        reasoning: 'Test draft',
        status: 'pending',
        createdAt: Date.now()
      });
      memory.addFactToDossier('c1@s.whatsapp.net', 'User likes tea');

      // 1. Reset drafts
      const resDrafts = await app.request('/api/workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'drafts' })
      });
      expect(resDrafts.status).toBe(200);
      expect(memory.getPendingDrafts().length).toBe(0);
      expect(memory.getChat('c1@s.whatsapp.net')).toBeDefined();

      // 2. Reset memories
      const resMem = await app.request('/api/workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'memories' })
      });
      expect(resMem.status).toBe(200);
      const facts = memory.getDossier('c1@s.whatsapp.net')?.facts || [];
      expect(facts.length).toBe(0);

      // 3. Reset chats
      const resChats = await app.request('/api/workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'chats' })
      });
      expect(resChats.status).toBe(200);
      expect(memory.getChat('c1@s.whatsapp.net')).toBeUndefined();

      // 4. Reset session
      const resSession = await app.request('/api/workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'session' })
      });
      expect(resSession.status).toBe(200);
      expect(getDisconnectCalledWithPurge()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('POST /api/workspace/reset with target all triggers complete factory reset', async () => {
    const { app, memory, getDisconnectCalledWithPurge, broadcastEvents, cleanup } = setupServer();
    try {
      memory.saveChat({
        id: 'all-chat@s.whatsapp.net',
        name: 'All Chat',
        unreadCount: 0,
        isGroup: false,
        agentMode: 'autopilot',
        lastTimestamp: Date.now()
      });
      memory.saveDraft({
        id: 'draft-all',
        chatId: 'all-chat@s.whatsapp.net',
        incomingMessageId: 'inbound-all',
        incomingText: 'User question for all',
        proposedReply: 'All draft',
        confidence: 0.8,
        reasoning: 'All test',
        status: 'pending',
        createdAt: Date.now()
      });

      const res = await app.request('/api/workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'all' })
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, target: 'all' });

      expect(memory.getChat('all-chat@s.whatsapp.net')).toBeUndefined();
      expect(memory.getPendingDrafts().length).toBe(0);
      expect(getDisconnectCalledWithPurge()).toBe(true);

      const resetEvent = broadcastEvents.find((e) => e.type === 'workspace_reset');
      expect(resetEvent).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it('POST /api/workspace/reset rejects invalid targets with 400', async () => {
    const { app, cleanup } = setupServer();
    try {
      const res = await app.request('/api/workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'invalid-target' })
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error', expect.stringContaining('Unknown reset target'));
    } finally {
      cleanup();
    }
  });
});
