import { useState, useEffect, useCallback, useRef } from 'react';
import { Bot, QrCode, Sliders, Play, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { api } from './api/client';
import type { AgentDecision, AgentDraft, AgentMode, ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus } from './api/types';
import { ChatList } from './components/ChatList';
import { ChatThread } from './components/ChatThread';
import { ModeratorDrawer } from './components/ModeratorDrawer';
import { PairingModal } from './components/PairingModal';
import { PersonaSettingsModal } from './components/PersonaSettingsModal';
import { SimulatorModal } from './components/SimulatorModal';

export function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<AgentDraft[]>([]);
  const [persona, setPersona] = useState<ModeratorPersona | undefined>();
  const [policy, setPolicy] = useState<PolicyConfig | undefined>();
  const [latestThought, setLatestThought] = useState<{ chatId: string; messageId: string; decision: AgentDecision } | undefined>();

  // Ref to always have the latest selectedChatId in SSE and polling callbacks
  const selectedChatIdRef = useRef<string | undefined>(selectedChatId);
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  // Modals state
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);

  // Load initial data
  const loadInitialData = useCallback(async () => {
    try {
      const [statusRes, chatsRes, draftsRes, personaRes] = await Promise.all([
        api.getStatus().catch(() => null),
        api.listChats().catch(() => ({ chats: [] })),
        api.listDrafts().catch(() => ({ drafts: [] })),
        api.getPersona().catch(() => null)
      ]);

      if (statusRes) setStatus(statusRes);
      if (chatsRes.chats && Array.isArray(chatsRes.chats)) {
        setChats(chatsRes.chats);
        setSelectedChatId((prev) => {
          const exists = chatsRes.chats.some((c: any) => c.id === prev);
          return (!prev || !exists) && chatsRes.chats.length > 0 ? chatsRes.chats[0].id : prev;
        });
      }
      if (draftsRes.drafts) setDrafts(draftsRes.drafts);
      if (personaRes) {
        setPersona(personaRes.persona);
        setPolicy(personaRes.policy);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  }, []);

  // Continuous Harvest Sync: Poll active chat messages every 2.5s for seamless resilience
  useEffect(() => {
    if (!selectedChatId) return;

    // Immediately fetch messages when chat is selected
    api.getMessages(selectedChatId).then((res) => {
      setMessages(res.messages || []);
    }).catch(console.error);

    const harvestTimer = setInterval(async () => {
      try {
        const res = await api.getMessages(selectedChatId);
        if (res.messages && Array.isArray(res.messages)) {
          setMessages((prev) => {
            if (prev.length !== res.messages.length) return res.messages;
            const isDifferent = res.messages.some((newMsg, idx) => {
              const oldMsg = prev[idx];
              return (
                !oldMsg ||
                oldMsg.id !== newMsg.id ||
                oldMsg.status !== newMsg.status ||
                (oldMsg.reactions?.length ?? 0) !== (newMsg.reactions?.length ?? 0)
              );
            });
            return isDifferent ? res.messages : prev;
          });
        }
      } catch {}
    }, 2500);

    return () => clearInterval(harvestTimer);
  }, [selectedChatId]);

  // Periodic Chat List Harvest: Poll every 4s for fresh chats & unread counts
  useEffect(() => {
    const chatListTimer = setInterval(async () => {
      try {
        const res = await api.listChats();
        if (res.chats && Array.isArray(res.chats)) {
          setChats(res.chats);
          setSelectedChatId((prev) => {
            const exists = res.chats.some((c: any) => c.id === prev);
            return (!prev || !exists) && res.chats.length > 0 ? res.chats[0].id : prev;
          });
        }
      } catch {}
    }, 4000);

    return () => clearInterval(chatListTimer);
  }, []);

  // Setup Server-Sent Events (SSE) for live streaming (mounted once)
  useEffect(() => {
    void loadInitialData();

    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('state_change', (e: MessageEvent) => {
      const updatedState = JSON.parse(e.data);
      setStatus((prev) => (prev ? { ...prev, ...updatedState } : updatedState));
    });

    eventSource.addEventListener('new_message', (e: MessageEvent) => {
      const newMsg: ChatMessage = JSON.parse(e.data);
      const activeId = selectedChatIdRef.current;
      if (activeId === newMsg.chatId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      }

      api.listChats().then((res) => {
        if (res.chats) setChats(res.chats);
      }).catch(() => {});
    });

    eventSource.addEventListener('agent_thought', (e: MessageEvent) => {
      const thoughtData = JSON.parse(e.data);
      setLatestThought(thoughtData);
    });

    eventSource.addEventListener('message_reaction', (e: MessageEvent) => {
      const { chatId, messageId, emoji } = JSON.parse(e.data);
      const activeId = selectedChatIdRef.current;
      if (activeId === chatId) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === messageId) {
              const current = m.reactions || [];
              const updated = emoji
                ? Array.from(new Set([...current, emoji]))
                : current;
              return { ...m, reactions: updated };
            }
            return m;
          })
        );
      }
    });

    eventSource.addEventListener('new_draft', (e: MessageEvent) => {
      const draft: AgentDraft = JSON.parse(e.data);
      setDrafts((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)]);
    });

    eventSource.addEventListener('draft_updated', (e: MessageEvent) => {
      const { draftId } = JSON.parse(e.data);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    });

    eventSource.addEventListener('chat_updated', () => {
      api.listChats().then((res) => {
        if (res.chats) setChats(res.chats);
      }).catch(() => {});
    });

    return () => {
      eventSource.close();
    };
  }, [loadInitialData]);

  // Handlers
  const handleSendMessage = async (text: string, replyToMessageId?: string) => {
    if (!selectedChatId) return;
    const res = await api.sendMessage(selectedChatId, text, replyToMessageId);
    if (res.success && res.message) {
      setMessages((prev) => [...prev, res.message]);
    }
  };

  const handleSendReaction = async (messageId: string, emoji: string) => {
    if (!selectedChatId) return;
    await api.sendReaction(selectedChatId, messageId, emoji);
  };

  const handleChangeMode = async (mode: AgentMode) => {
    if (!selectedChatId) return;
    await api.setChatMode(selectedChatId, mode);
    setChats((prev) =>
      prev.map((c) => (c.id === selectedChatId ? { ...c, agentMode: mode } : c))
    );
  };

  const handleApproveDraft = async (draftId: string, editedText?: string, asVoice?: boolean) => {
    await api.approveDraft(draftId, editedText, asVoice);
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleRejectDraft = async (draftId: string) => {
    await api.rejectDraft(draftId);
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleSavePersona = async (updatedPersona: Partial<ModeratorPersona>, updatedPolicy?: Partial<PolicyConfig>) => {
    await api.updatePersona(updatedPersona, updatedPolicy);
    if (persona) setPersona({ ...persona, ...updatedPersona });
    if (policy && updatedPolicy) setPolicy({ ...policy, ...updatedPolicy });
  };

  const handleSimulate = async (text: string, senderName?: string) => {
    return api.simulate(text, senderName);
  };

  const handleConnect = async (phone?: string) => {
    await api.connect(phone);
  };

  const handleDisconnect = async () => {
    await api.disconnect();
  };

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0b0f14] text-slate-100" dir="rtl">
      {/* Top Navbar */}
      <header className="h-14 border-b border-[#263140] bg-[#131922] px-4 flex items-center justify-between shrink-0 z-20">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100 tracking-wide">Fable Agentic WhatsApp</h1>
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">
                Argon & 3.8 Edition
              </span>
            </div>
            <p className="text-[10px] text-emerald-400 font-medium">Gemini 4 Argon & 3.8 Flash-TTS Autonomous Control Plane</p>
          </div>
        </div>

        {/* Center / Status Pill */}
        <div className="flex items-center gap-2">
          {/* Active Models Pill */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-[#0b0f14] border border-[#263140] text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-400">النموذج:</span>
            <span className="font-mono text-emerald-400 font-semibold">{persona?.model || 'gemini-4-argon'}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">الصوت:</span>
            <span className="font-mono text-cyan-400 font-semibold">{persona?.voiceName || 'kore'}</span>
          </div>

          {status?.state === 'connected' ? (
            <div
              onClick={() => setIsPairingOpen(true)}
              className="cursor-pointer flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium"
            >
              <Wifi className="w-3.5 h-3.5 animate-pulse" />
              <span>متصل: {status.connectedUser?.phone || status.connectedUser?.name || 'WhatsApp'}</span>
            </div>
          ) : status?.state === 'qr_ready' ? (
            <div
              onClick={() => setIsPairingOpen(true)}
              className="cursor-pointer flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium animate-pulse"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>رمز QR جاهز للمسح</span>
            </div>
          ) : (
            <div
              onClick={() => setIsPairingOpen(true)}
              className="cursor-pointer flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium"
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>غير متصل - اضغط للربط</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSimulatorOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1c2430] hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-400 border border-[#263140] text-xs font-medium transition-colors"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">محاكي الردود</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1c2430] hover:bg-[#253245] text-slate-300 border border-[#263140] text-xs font-medium transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">تخصيص الموديرتور</span>
          </button>

          <button
            onClick={() => setIsPairingOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors shadow-lg shadow-emerald-950/30"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>ربط جهاز</span>
          </button>
        </div>
      </header>

      {/* Main App Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat List */}
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={(id) => setSelectedChatId(id)}
        />

        {/* Center: Chat Thread */}
        <ChatThread
          chat={selectedChat}
          messages={messages}
          onSendMessage={handleSendMessage}
          onSendReaction={handleSendReaction}
          onChangeMode={handleChangeMode}
        />

        {/* Right: Moderator Agent Drawer */}
        <ModeratorDrawer
          drafts={drafts}
          latestThought={latestThought}
          persona={persona}
          selectedChatId={selectedChatId}
          onApproveDraft={handleApproveDraft}
          onRejectDraft={handleRejectDraft}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenSimulator={() => setIsSimulatorOpen(true)}
        />
      </div>

      {/* Modals */}
      <PairingModal
        isOpen={isPairingOpen}
        status={status}
        onClose={() => setIsPairingOpen(false)}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <PersonaSettingsModal
        isOpen={isSettingsOpen}
        initialPersona={persona}
        initialPolicy={policy}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSavePersona}
      />

      <SimulatorModal
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        onSimulate={handleSimulate}
      />
    </div>
  );
}

export default App;
