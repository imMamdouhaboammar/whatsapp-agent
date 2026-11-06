import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Bot, CheckCheck, ContactRound, MessageCircle, Play, Settings2, Smartphone, Wifi, WifiOff, X } from 'lucide-react';
import { api } from './api/client';
import type { AgentDecision, AgentDraft, AgentMode, ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus } from './api/types';
import { ChatList } from './components/ChatList';
import { BrandBrainPage } from './components/BrandBrainPage';
import { ChatThread } from './components/ChatThread';
import { ModeratorDrawer } from './components/ModeratorDrawer';
import { PairingModal } from './components/PairingModal';
import { PersonaSettingsPage } from './components/PersonaSettingsPage';
import { SimulatorModal } from './components/SimulatorModal';
import { useLocale } from './locale-context';

export function App() {
  const { language, setLanguage, direction, tr } = useLocale();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<AgentDraft[]>([]);
  const [persona, setPersona] = useState<ModeratorPersona | undefined>();
  const [policy, setPolicy] = useState<PolicyConfig | undefined>();
  const [personaLoadFailed, setPersonaLoadFailed] = useState(false);
  const [latestThought, setLatestThought] = useState<{ chatId: string; messageId: string; decision: AgentDecision } | undefined>();

  // Ref to always have the latest selectedChatId in SSE and polling callbacks
  const selectedChatIdRef = useRef<string | undefined>(selectedChatId);
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  // Modals state
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [page, setPage] = useState<'chats' | 'settings' | 'brain'>(() =>
    typeof window !== 'undefined' && window.location.pathname === '/settings/assistant' ? 'settings' :
    typeof window !== 'undefined' && window.location.pathname === '/brand-brain' ? 'brain' : 'chats'
  );
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [inspectorView, setInspectorView] = useState<'assistant' | 'drafts' | 'memory'>('assistant');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [compactScreen, setCompactScreen] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1160px)').matches
  );

  useEffect(() => {
    const onPopState = () => setPage(window.location.pathname === '/settings/assistant' ? 'settings' : window.location.pathname === '/brand-brain' ? 'brain' : 'chats');
    window.addEventListener('popstate', onPopState);
    const query = window.matchMedia('(max-width: 1160px)');
    const onViewportChange = (event: MediaQueryListEvent) => {
      setCompactScreen(event.matches);
      setInspectorOpen(false);
    };
    query.addEventListener('change', onViewportChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      query.removeEventListener('change', onViewportChange);
    };
  }, []);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

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
        setPersonaLoadFailed(false);
      } else {
        setPersonaLoadFailed(true);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setPersonaLoadFailed(true);
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
    const bootstrapTimer = window.setTimeout(() => void loadInitialData(), 0);

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

    eventSource.addEventListener('message_status', (e: MessageEvent) => {
      const { chatId, messageId, status } = JSON.parse(e.data) as {
        chatId: string;
        messageId: string;
        status: ChatMessage['status'];
      };
      if (selectedChatIdRef.current !== chatId) return;
      setMessages((prev) => prev.map((message) =>
        message.id === messageId && message.isFromMe ? { ...message, status } : message
      ));
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
      window.clearTimeout(bootstrapTimer);
      eventSource.close();
    };
  }, [loadInitialData]);

  // Handlers
  const handleSendMessage = async (text: string, replyToMessageId?: string) => {
    if (!selectedChatId) return;
    const res = await api.sendMessage(selectedChatId, text, replyToMessageId);
    if (res.success && res.message) {
      setMessages((prev) => prev.some((message) => message.id === res.message.id) ? prev : [...prev, res.message]);
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
  const pendingDraftChatIds = drafts.filter((draft) => draft.status === 'pending').map((draft) => draft.chatId);

  const selectChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setMobileView('chat');
    setInspectorView('assistant');
    setInspectorOpen(false);
  };

  const openInspector = (view: 'assistant' | 'drafts' | 'memory') => {
    setInspectorView(view);
    setInspectorExpanded(true);
    setInspectorOpen(compactScreen);
  };

  const inspectorVisible = compactScreen ? inspectorOpen : inspectorExpanded;
  const toggleInspector = () => {
    if (compactScreen) setInspectorOpen((open) => !open);
    else setInspectorExpanded((open) => !open);
  };
  const closeInspector = () => {
    if (compactScreen) setInspectorOpen(false);
    else setInspectorExpanded(false);
  };

  const openSettings = () => {
    if (page === 'settings') return;
    window.history.pushState({ waSettings: true }, '', '/settings/assistant');
    setPage('settings');
    setInspectorOpen(false);
  };
  const openBrain = () => {
    if (page === 'brain') return;
    window.history.pushState({ waBrain: true }, '', '/brand-brain');
    setPage('brain');
    setInspectorOpen(false);
  };
  const closeBrain = () => {
    if (window.history.state?.waBrain) window.history.back();
    else { window.history.replaceState(null, '', '/'); setPage('chats'); }
  };
  const closeSettings = () => {
    if (window.history.state?.waSettings) window.history.back();
    else {
      window.history.replaceState(null, '', '/');
      setPage('chats');
    }
  };

  return (
    <div className="wa-app" dir={direction}>
      <header className="wa-header">
        <div className="wa-brand" aria-label="WhatsApp Agent">
          <span className="wa-brand-mark"><MessageCircle size={22} strokeWidth={2.5} /></span>
          <strong dir="ltr">WhatsApp <span>Agent</span></strong>
        </div>
        <div className="wa-header-actions">
          <div className="wa-language-switch" role="group" aria-label={tr('لغة الواجهة', 'Interface language')}>
            <button type="button" aria-pressed={language === 'ar'} className={language === 'ar' ? 'is-active' : ''} onClick={() => setLanguage('ar')}>عربي</button>
            <button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')}>EN</button>
          </div>
          <button type="button" className={'wa-connection ' + (status?.state === 'connected' ? 'is-connected' : 'is-disconnected')} onClick={() => setIsPairingOpen(true)} aria-label={tr('حالة ربط واتساب', 'WhatsApp connection status')}>
            {status?.state === 'connected' ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{status?.state === 'connected' ? tr('متصل', 'Connected') : status?.state === 'connecting' ? tr('جارٍ الاتصال', 'Connecting') : tr('ربط واتساب', 'Link WhatsApp')}</span>
          </button>
          <span className="wa-header-separator" aria-hidden="true" />
          <button type="button" className="wa-icon-button wa-simulator-trigger" onClick={() => setIsSimulatorOpen(true)} aria-label={tr('اختبار رد المساعد', 'Test the assistant')} title={tr('اختبار رد المساعد', 'Test the assistant')}><Play size={19} /></button>
          <button type="button" className={'wa-icon-button ' + (page === 'brain' ? 'is-active' : '')} onClick={openBrain} aria-label={tr('ذاكرة البراند', 'Brand Brain')} title={tr('ذاكرة البراند', 'Brand Brain')}><BookOpen size={19} /></button>
          <button type="button" className={'wa-icon-button ' + (page === 'settings' ? 'is-active' : '')} onClick={openSettings} aria-label={tr('إعدادات المساعد', 'Assistant settings')} title={tr('إعدادات المساعد', 'Assistant settings')}><Settings2 size={19} /></button>
          {page === 'chats' && <button type="button" className="wa-header-agent-trigger" onClick={toggleInspector} aria-controls="wa-agent-panel" aria-expanded={inspectorVisible} aria-label={inspectorVisible ? tr('طي لوحة المساعد', 'Collapse AI assistant') : tr('فتح لوحة المساعد', 'Expand AI assistant')}>
            <Bot size={18} /><span>{tr('المساعد الذكي', 'AI assistant')}</span>
            {drafts.length > 0 && <span className="wa-count wa-count-light">{drafts.length}</span>}
          </button>}
        </div>
      </header>
      {page === 'settings' ? (
        <PersonaSettingsPage initialPersona={persona} error={personaLoadFailed} onRetry={() => { setPersonaLoadFailed(false); void loadInitialData(); }} onClose={closeSettings} onSave={handleSavePersona} />
      ) : page === 'brain' ? (
        <BrandBrainPage onClose={closeBrain} />
      ) : (
      <div className={'wa-workspace ' + (mobileView === 'list' ? 'is-list-view' : 'is-chat-view') + (!inspectorExpanded ? ' is-inspector-collapsed' : '')}>
        <nav className="wa-nav" aria-label={tr('القائمة الرئيسية', 'Main navigation')}>
          <div className="wa-nav-main">
            <button type="button" className={'wa-nav-button ' + (inspectorView === 'assistant' ? 'is-active' : '')} aria-label={tr('الدردشات', 'Chats')} title={tr('الدردشات', 'Chats')} onClick={() => { setInspectorView('assistant'); setInspectorOpen(false); setMobileView('list'); }}>
              <MessageCircle size={23} /><span>{tr('الدردشات', 'Chats')}</span>
            </button>
            <button type="button" className={'wa-nav-button ' + (inspectorView === 'drafts' ? 'is-active' : '')} aria-label={tr('المسودات المعلقة', 'Pending drafts')} title={tr('المسودات المعلقة', 'Pending drafts')} onClick={() => openInspector('drafts')}>
              <CheckCheck size={23} />{drafts.length > 0 && <span className="wa-nav-dot" aria-hidden="true" />}<span>{tr('المسودات', 'Drafts')}</span>
            </button>
            <button type="button" className={'wa-nav-button ' + (inspectorView === 'memory' ? 'is-active' : '')} aria-label={tr('ذاكرة جهة الاتصال', 'Contact memory')} title={tr('ذاكرة جهة الاتصال', 'Contact memory')} onClick={() => openInspector('memory')}>
              <ContactRound size={23} /><span>{tr('الذاكرة', 'Memory')}</span>
            </button>
          </div>
          <button type="button" className="wa-nav-device" onClick={() => setIsPairingOpen(true)} aria-label={tr('إدارة الجهاز المرتبط', 'Linked device')} title={tr('إدارة الجهاز المرتبط', 'Linked device')}>
            <Smartphone size={21} /><span className={'wa-presence-dot ' + (status?.state === 'connected' ? 'is-online' : '')} />
          </button>
        </nav>
        <ChatList chats={chats} selectedChatId={selectedChatId} pendingDraftChatIds={pendingDraftChatIds} onSelectChat={selectChat} />
        <ChatThread key={selectedChatId || 'empty'} chat={selectedChat} messages={messages} onSendMessage={handleSendMessage} onSendReaction={handleSendReaction} onChangeMode={handleChangeMode} onBack={() => setMobileView('list')} onOpenInspector={() => openInspector('assistant')} />
        <aside id="wa-agent-panel" className={'wa-agent-shell ' + (inspectorOpen ? 'is-open' : '')} aria-label={tr('لوحة المساعد الذكي', 'AI assistant panel')} aria-hidden={!inspectorVisible} inert={!inspectorVisible}>
          <button type="button" className="wa-inspector-close wa-icon-button" onClick={closeInspector} aria-label={tr('إغلاق لوحة المساعد', 'Close assistant panel')}><X size={20} /></button>
          <ModeratorDrawer key={(selectedChatId || 'none') + inspectorView} view={inspectorView} drafts={drafts} latestThought={latestThought} persona={persona} selectedChatId={selectedChatId} selectedChatMode={selectedChat?.agentMode} onSelectChat={selectChat} onApproveDraft={handleApproveDraft} onRejectDraft={handleRejectDraft} />
        </aside>
        {inspectorOpen && <button type="button" className="wa-scrim" onClick={() => setInspectorOpen(false)} aria-label={tr('إغلاق لوحة المساعد', 'Close assistant panel')} />}
      </div>
      )}
      <PairingModal isOpen={isPairingOpen} status={status} onClose={() => setIsPairingOpen(false)} onConnect={handleConnect} onDisconnect={handleDisconnect} />
      <SimulatorModal isOpen={isSimulatorOpen} onClose={() => setIsSimulatorOpen(false)} onSimulate={handleSimulate} />
    </div>
  );
}

export default App;

