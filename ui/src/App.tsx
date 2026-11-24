import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, CheckCheck, ContactRound, MessageCircle, Network, Play, Settings2, Smartphone, Smile, Wifi, WifiOff, X } from 'lucide-react';
import { Gemini } from '@lobehub/icons';
import { WhatsApp } from '@lobehub/ui/icons';
import { Badge as AstryxBadge } from '@astryxdesign/core/Badge';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { api } from './api/client';
import { ChatRequestCoordinator } from './lib/chat-request-coordinator';
import { DashboardSync, type SyncHealth } from './lib/dashboard-sync';
import { featureEnabled, type CapabilityRow } from './lib/capabilities';
import type { AgentDecision, AgentDraft, AgentMode, ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus } from './api/types';
import { ChatList } from './components/ChatList';
import { BrandBrainPage } from './components/BrandBrainPage';
import { ChatThread } from './components/ChatThread';
import { FunnelPage } from './components/FunnelPage';
import { ModeratorDrawer } from './components/ModeratorDrawer';
import { PairingModal } from './components/PairingModal';
import { PersonaSettingsPage } from './components/PersonaSettingsPage';
import { SimulatorModal } from './components/SimulatorModal';
import { StickerStudioModal } from './components/StickerStudioModal';
import { OwnerSignOutButton } from './components/OwnerAccessGate';
import { useOwnerAccess } from './components/owner-access-context';
import { useLocale } from './locale-context';

export function App() {
  const { language, setLanguage, direction, tr } = useLocale();
  const ownerAccess = useOwnerAccess();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError(false);
    try { await ownerAccess.signOut(); }
    catch { setSignOutError(true); }
    finally { setSigningOut(false); }
  };
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<AgentDraft[]>([]);
  const [persona, setPersona] = useState<ModeratorPersona | undefined>();
  const policyRef = useRef<PolicyConfig | undefined>(undefined);
  const [personaLoadFailed, setPersonaLoadFailed] = useState(false);
  // WA-026: explicit freshness model; a failed refresh keeps the last known
  // good snapshot and surfaces stale/error instead of an empty success.
  const syncRef = useRef(new DashboardSync());
  const [syncHealth, setSyncHealth] = useState<SyncHealth>('loading');
  const retryTimerRef = useRef<number | undefined>(undefined);
  const streamDroppedRef = useRef(false);
  const [latestThought, setLatestThought] = useState<{ chatId: string; messageId: string; decision: AgentDecision } | undefined>();

  // Ref to always have the latest selectedChatId in SSE and polling callbacks
  const selectedChatIdRef = useRef<string | undefined>(selectedChatId);
  // WA-020: generation-gated request cycles; stale responses never apply.
  const messageSyncRef = useRef(new ChatRequestCoordinator());
  // WA-024: transport feature capabilities; unsupported actions are hidden.
  const [capabilityRows, setCapabilityRows] = useState<CapabilityRow[]>([]);
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  // Modals state
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [page, setPage] = useState<'chats' | 'settings' | 'brain' | 'funnel'>(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/settings/') ? 'settings' :
    typeof window !== 'undefined' && window.location.pathname === '/brand-brain' ? 'brain' :
    typeof window !== 'undefined' && window.location.pathname === '/funnel' ? 'funnel' : 'chats'
  );
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isStickerStudioOpen, setIsStickerStudioOpen] = useState(false);
  const [inspectorView, setInspectorView] = useState<'assistant' | 'drafts' | 'memory'>('assistant');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [compactScreen, setCompactScreen] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1160px)').matches
  );

  useEffect(() => {
    const onPopState = () => setPage(
      window.location.pathname.startsWith('/settings/') ? 'settings' :
      window.location.pathname === '/brand-brain' ? 'brain' :
      window.location.pathname === '/funnel' ? 'funnel' : 'chats'
    );
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

  // Load initial data. WA-026: failures keep the last known good snapshot and
  // flip the dashboard to stale/error; they are never converted to empty lists.
  const loadInitialData = useCallback(async () => {
    const sync = syncRef.current;
    const [statusRes, chatsRes, draftsRes, personaRes, capsRes] = await Promise.all([
      api.getStatus().catch((err: unknown) => err as Error),
      api.listChats().catch((err: unknown) => err as Error),
      api.listDrafts().catch((err: unknown) => err as Error),
      api.getPersona().catch(() => null),
      api.getRuntimeCapabilities().catch(() => null)
    ]);

    let coreFailure: unknown = null;
    if (statusRes instanceof Error) coreFailure = statusRes;
    else setStatus(statusRes);
    if (capsRes?.capabilities) setCapabilityRows(capsRes.capabilities);
    if (chatsRes instanceof Error) {
      coreFailure = coreFailure ?? chatsRes;
    } else if (Array.isArray(chatsRes.chats)) {
      sync.noteSnapshot();
      setChats(chatsRes.chats);
      setSelectedChatId((prev) => {
        const exists = chatsRes.chats.some((c: { id: string }) => c.id === prev);
        return (!prev || !exists) && chatsRes.chats.length > 0 ? chatsRes.chats[0].id : prev;
      });
    }
    if (draftsRes instanceof Error) {
      coreFailure = coreFailure ?? draftsRes;
    } else if (draftsRes.drafts) {
      setDrafts(draftsRes.drafts);
    }
    if (personaRes) {
      setPersona(personaRes.persona);
      policyRef.current = personaRes.policy;
      setPersonaLoadFailed(false);
    } else {
      setPersonaLoadFailed(true);
    }
    setSyncHealth(coreFailure ? sync.noteLoadFailure(coreFailure) : sync.noteLoadSuccess());
  }, []);

  // WA-026: bounded automatic resync while the live stream is down. The budget
  // is finite; a manual retry or a stream reconnect re-arms it.
  const scheduleResync = useCallback(() => {
    if (retryTimerRef.current !== undefined) return;
    const attempt = () => {
      const delay = syncRef.current.nextRetryDelayMs();
      if (delay === null) return;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = undefined;
        void loadInitialData().finally(() => {
          if (streamDroppedRef.current) attempt();
        });
      }, delay);
    };
    attempt();
  }, [loadInitialData]);

  const handleSyncRetry = useCallback(() => {
    syncRef.current.resetRetries();
    setSyncHealth('loading');
    void loadInitialData().finally(() => {
      if (streamDroppedRef.current) scheduleResync();
    });
  }, [loadInitialData, scheduleResync]);

  // Continuous Harvest Sync: Poll active chat messages every 2.5s for seamless resilience
  useEffect(() => {
    if (!selectedChatId) return;

    // WA-020: begin a new request cycle; the previous chat's outstanding
    // fetches are aborted and their late responses are ignored.
    const sync = messageSyncRef.current;
    const token = sync.begin(selectedChatId);

    // Immediately fetch messages when chat is selected
    api.getMessages(selectedChatId, { signal: token.signal }).then((res) => {
      if (!sync.isCurrent(token)) return;
      setMessages(res.messages || []);
    }).catch((err) => {
      if (!token.signal.aborted) console.error(err);
    });

    const harvestTimer = setInterval(async () => {
      if (!sync.isCurrent(token)) return;
      try {
        const res = await api.getMessages(selectedChatId, { signal: token.signal });
        if (!sync.isCurrent(token)) return;
        if (res.messages && Array.isArray(res.messages)) {
          setMessages((prev) => {
            if (prev.length !== res.messages.length) return res.messages;
            const isDifferent = res.messages.some((newMsg, idx) => {
              const oldMsg = prev[idx];
              return (
                !oldMsg ||
                oldMsg.id !== newMsg.id ||
                oldMsg.status !== newMsg.status ||
                oldMsg.deliveryState !== newMsg.deliveryState ||
                oldMsg.lastAttemptAt !== newMsg.lastAttemptAt ||
                oldMsg.nativeMessageId !== newMsg.nativeMessageId ||
                (oldMsg.reactions?.length ?? 0) !== (newMsg.reactions?.length ?? 0)
              );
            });
            return isDifferent ? res.messages : prev;
          });
        }
      } catch (err) {
        if (!token.signal.aborted) console.debug('[App] Background message sync:', err);
      }
    }, 15000);

    return () => {
      clearInterval(harvestTimer);
      sync.cancelAll();
    };
  }, [selectedChatId]);

  // Periodic Chat List Drift-Sync: Low-frequency background sync (15s)
  useEffect(() => {
    const chatListTimer = setInterval(async () => {
      try {
        const res = await api.listChats();
        if (res.chats && Array.isArray(res.chats)) {
          setChats(res.chats);
          setSelectedChatId((prev) => {
            const exists = res.chats.some((c: { id: string }) => c.id === prev);
            return (!prev || !exists) && res.chats.length > 0 ? res.chats[0].id : prev;
          });
        }
        setSyncHealth(syncRef.current.noteLoadSuccess());
      } catch (err) {
        console.debug('[App] Background chat list sync:', err);
        setSyncHealth(syncRef.current.noteLoadFailure(err));
      }
    }, 15000);

    return () => clearInterval(chatListTimer);
  }, []);

  // Setup Server-Sent Events (SSE) for live streaming (mounted once)
  useEffect(() => {
    const bootstrapTimer = window.setTimeout(() => void loadInitialData(), 0);

    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('state_change', (e: MessageEvent) => {
      try {
        const updatedState = JSON.parse(e.data);
        setStatus((prev) => {
          if (!prev) return updatedState;
          return {
            ...prev,
            ...updatedState,
            error: updatedState.error ?? undefined,
            qrDataUrl: updatedState.qrDataUrl ?? undefined,
            pairingCode: updatedState.pairingCode ?? undefined
          };
        });
      } catch {
        // Ignore malformed message
      }
    });

    eventSource.onopen = () => {
      syncRef.current.noteStreamOpen();
      if (streamDroppedRef.current) {
        streamDroppedRef.current = false;
        // Reconnected: reconcile anything missed while the stream was down.
        void loadInitialData();
      }
    };

    eventSource.onerror = () => {
      // Mark retained data stale and resync with a bounded retry budget instead
      // of firing a full reload on every error event.
      streamDroppedRef.current = true;
      setSyncHealth(syncRef.current.noteStreamDrop());
      scheduleResync();
    };

    eventSource.addEventListener('new_message', (e: MessageEvent) => {
      try {
        const newMsg = JSON.parse(e.data) as ChatMessage;
        if (!newMsg || typeof newMsg !== 'object' || typeof newMsg.id !== 'string' || typeof newMsg.chatId !== 'string') return;
        const activeId = selectedChatIdRef.current;
        if (activeId === newMsg.chatId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }

        api.listChats().then((res) => {
          if (res.chats) setChats(res.chats);
        }).catch((err) => console.warn('Failed to refresh chats after new message:', err));
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('message_status', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (!payload || typeof payload !== 'object') return;
        const { chatId, messageId, status } = payload as {
          chatId: string;
          messageId: string;
          status: ChatMessage['status'];
        };
        if (selectedChatIdRef.current !== chatId) return;
        setMessages((prev) => prev.map((message) =>
          message.id === messageId && message.isFromMe ? { ...message, status } : message
        ));
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('send_intent', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { chatId: string };
        if (data.chatId !== selectedChatIdRef.current) return;
        void api.getMessages(data.chatId).then((response) => {
          // The selection may have changed while the fetch was in flight.
          if (selectedChatIdRef.current !== data.chatId) return;
          setMessages(response.messages);
        }).catch((error) => {
          console.warn('[Delivery] Could not refresh message states:', error);
        });
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('agent_thought', (e: MessageEvent) => {
      try {
        const thoughtData = JSON.parse(e.data);
        if (thoughtData && typeof thoughtData === 'object') {
          setLatestThought(thoughtData);
        }
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('message_reaction', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (!payload || typeof payload !== 'object') return;
        const { chatId, messageId, emoji } = payload;
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
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('new_draft', (e: MessageEvent) => {
      try {
        const draft = JSON.parse(e.data) as AgentDraft;
        if (draft && draft.id) {
          setDrafts((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)]);
        }
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('draft_updated', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload && payload.draftId) {
          setDrafts((prev) => prev.filter((d) => d.id !== payload.draftId));
        }
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('chat_updated', () => {
      api.listChats().then((res) => {
        if (res.chats) setChats(res.chats);
      }).catch((err) => console.warn('Failed to refresh chats after new message:', err));
    });

    eventSource.addEventListener('chat_deleted', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { chatId?: string };
        if (payload?.chatId) {
          setChats((prev) => prev.filter((c) => c.id !== payload.chatId));
          if (selectedChatIdRef.current === payload.chatId) {
            setSelectedChatId(undefined);
            setMessages([]);
            setMobileView('list');
          }
        }
      } catch {
        // Ignore malformed SSE message
      }
    });

    eventSource.addEventListener('messages_cleared', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { chatId?: string };
        if (payload?.chatId && selectedChatIdRef.current === payload.chatId) {
          setMessages([]);
        }
      } catch {
        // Ignore malformed SSE message
      }
    });

    return () => {
      window.clearTimeout(bootstrapTimer);
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
      eventSource.close();
    };
  }, [loadInitialData, scheduleResync]);

  // Handlers
  const handleSendMessage = async (text: string, replyToMessageId?: string, clientMutationId?: string) => {
    if (!selectedChatId) return;
    const chatId = selectedChatId;
    const res = await api.sendMessage(chatId, text, replyToMessageId, clientMutationId);
    const latest = await api.getMessages(chatId);
    // Ignore the refresh if the user switched chats while the send was in flight.
    if (selectedChatIdRef.current !== chatId) return;
    setMessages(latest.messages);
    if (res.state === 'failed') throw new Error('Send failed before reaching WhatsApp');
  };

  const handleRetrySendIntent = async (intentId: string, clientMutationId: string) => {
    if (!selectedChatId) return;
    const chatId = selectedChatId;
    await api.retrySendIntent(intentId, clientMutationId);
    const latest = await api.getMessages(chatId);
    if (selectedChatIdRef.current !== chatId) return;
    setMessages(latest.messages);
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

  const handleDeleteChat = async (chatId: string) => {
    await api.deleteChat(chatId);
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (selectedChatId === chatId) {
      setSelectedChatId(undefined);
      setMessages([]);
      setMobileView('list');
    }
  };

  const handleClearChatMessages = async (chatId: string) => {
    await api.clearChatMessages(chatId);
    if (selectedChatId === chatId) {
      setMessages([]);
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    await api.rejectDraft(draftId);
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleSavePersona = async (updatedPersona: Partial<ModeratorPersona>, updatedPolicy?: Partial<PolicyConfig>) => {
    await api.updatePersona(updatedPersona, updatedPolicy);
    if (persona) setPersona({ ...persona, ...updatedPersona });
    if (policyRef.current && updatedPolicy) policyRef.current = { ...policyRef.current, ...updatedPolicy };
  };

  const handleSimulate = async (text: string, senderName?: string) => {
    return api.simulate(text, senderName);
  };

  const handleConnect = async (phone?: string, refresh?: boolean) => {
    await api.connect(phone, refresh);
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
  const openFunnel = () => {
    if (page === 'funnel') return;
    window.history.pushState({ waFunnel: true }, '', '/funnel');
    setPage('funnel');
    setInspectorOpen(false);
  };
  const closeFunnel = () => {
    if (window.history.state?.waFunnel) window.history.back();
    else { window.history.replaceState(null, '', '/'); setPage('chats'); }
  };
  const closeSettings = () => {
    window.history.replaceState(null, '', '/');
    setPage('chats');
  };

  return (
    <div className="wa-app" dir={direction}>
      <header className="wa-header">
        <div className="wa-brand" aria-label="WhatsApp Agent">
          <span className="wa-brand-mark"><WhatsApp.Color size={22} /></span>
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
          <button type="button" className="wa-icon-button" onClick={() => setIsStickerStudioOpen(true)} aria-label={tr('استوديو الملصقات', 'Sticker Studio')} title={tr('استوديو الملصقات', 'Sticker Studio')}><Smile size={19} /></button>
          <button type="button" className={'wa-icon-button ' + (page === 'funnel' ? 'is-active' : '')} onClick={openFunnel} aria-label={tr('محرك التوزيع المتوازي', 'Scatter-Gather Funnel')} title={tr('محرك التوزيع المتوازي', 'Scatter-Gather Funnel')}><Network size={19} /></button>
          <button type="button" className={'wa-icon-button ' + (page === 'brain' ? 'is-active' : '')} onClick={openBrain} aria-label={tr('ذاكرة البراند', 'Brand Brain')} title={tr('ذاكرة البراند', 'Brand Brain')}><BookOpen size={19} /></button>
          <button type="button" className={'wa-icon-button ' + (page === 'settings' ? 'is-active' : '')} onClick={openSettings} aria-label={tr('إعدادات المساعد', 'Assistant settings')} title={tr('إعدادات المساعد', 'Assistant settings')}><Settings2 size={19} /></button>
          {ownerAccess.required && <>
            <span className="wa-header-separator" aria-hidden="true" />
            {signOutError && <span role="alert" className="wa-signout-error">{tr('تعذّر تسجيل الخروج', 'Could not sign out')}</span>}
            <OwnerSignOutButton onSignOut={handleSignOut} pending={signingOut} />
          </>}
          {page === 'chats' && <button type="button" className="wa-header-agent-trigger" onClick={toggleInspector} aria-controls="wa-agent-panel" aria-expanded={inspectorVisible} aria-label={(drafts.length > 0 ? tr('المساعد الذكي ' + drafts.length, 'AI assistant ' + drafts.length) : tr('المساعد الذكي', 'AI assistant')) + ', ' + (inspectorVisible ? tr('طي اللوحة', 'collapse panel') : tr('فتح اللوحة', 'expand panel'))}>
            <span aria-hidden="true" style={{display:"contents"}}><Gemini.Color size={18} /></span><span>{tr('المساعد الذكي', 'AI assistant')}</span>
            {drafts.length > 0 && <span className="wa-count wa-count-light"><AstryxBadge variant="teal" label={drafts.length} /></span>}
          </button>}
        </div>
      </header>
      {page === 'settings' ? (
        <PersonaSettingsPage initialPersona={persona} connectionState={status?.state} error={personaLoadFailed} onRetry={() => { setPersonaLoadFailed(false); void loadInitialData(); }} onClose={closeSettings} onOpenKnowledge={openBrain} onOpenSimulator={() => setIsSimulatorOpen(true)} onSave={handleSavePersona} />
      ) : page === 'brain' ? (
        <BrandBrainPage onClose={closeBrain} />
      ) : page === 'funnel' ? (
        <FunnelPage onClose={closeFunnel} />
      ) : (
      <div className={'wa-workspace ' + (mobileView === 'list' ? 'is-list-view' : 'is-chat-view') + (!inspectorExpanded ? ' is-inspector-collapsed' : '')}>
        {syncHealth !== 'live' && syncHealth !== 'loading' && (
          <div className={'wa-sync-banner is-' + syncHealth} role="status">
            <span>
                {syncHealth === 'unauthenticated'
                ? tr('انتهت جلسة الوصول. سجّل الدخول مجددًا لتحديث البيانات.', 'Owner session expired. Sign in again to refresh data.')
                : syncHealth === 'error'
                  ? tr('تعذّر تحميل البيانات من الخادم.', 'Could not load data from the server.')
                  : tr('تظهر آخر بيانات معروفة؛ التحديث المباشر متعذّر حاليًا.', 'Showing last known data; live updates are unavailable.')}
            </span>
              {syncHealth !== 'unauthenticated' && (
              <button type="button" className="wa-sync-retry" onClick={handleSyncRetry}>{tr('إعادة المحاولة', 'Retry')}</button>
              )}
          </div>
          )}
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
            <Smartphone size={21} />
            <StatusDot
              variant={status?.state === 'connected' ? 'success' : 'neutral'}
              label={
                status?.state === 'connected'
                  ? tr('متصل', 'Connected')
                  : status?.state === 'connecting'
                  ? tr('جارٍ الاتصال...', 'Connecting...')
                  : status?.state === 'qr_ready' || status?.state === 'pairing_code_ready'
                  ? tr('بانتظار مسح الرمز أو الربط', 'Awaiting pairing')
                  : status?.state === 'failed'
                  ? tr('فشل الاتصال', 'Connection failed')
                  : tr('غير متصل', 'Disconnected')
              }
              isPulsing={status?.state === 'connecting'}
            />
          </button>
        </nav>
        <ChatList chats={chats} selectedChatId={selectedChatId} pendingDraftChatIds={pendingDraftChatIds} onSelectChat={selectChat} />
        <ChatThread key={selectedChatId || 'empty'} chat={selectedChat} messages={messages} reactionsEnabled={featureEnabled(capabilityRows, 'feature:reactions', true)} onSendMessage={handleSendMessage} onRetrySendIntent={handleRetrySendIntent} onSendReaction={handleSendReaction} onChangeMode={handleChangeMode} onBack={() => setMobileView('list')} onOpenInspector={() => openInspector('assistant')} onDeleteChat={handleDeleteChat} onClearMessages={handleClearChatMessages} />
        <aside id="wa-agent-panel" className={'wa-agent-shell ' + (inspectorOpen ? 'is-open' : '')} aria-label={tr('لوحة المساعد الذكي', 'AI assistant panel')} aria-hidden={!inspectorVisible} inert={!inspectorVisible}>
          <button type="button" className="wa-inspector-close wa-icon-button" onClick={closeInspector} aria-label={tr('إغلاق لوحة المساعد', 'Close assistant panel')}><X size={20} /></button>
          <ModeratorDrawer key={(selectedChatId || 'none') + inspectorView} view={inspectorView} drafts={drafts} latestThought={latestThought} persona={persona} selectedChatId={selectedChatId} selectedChatMode={selectedChat?.agentMode} onSelectChat={selectChat} onApproveDraft={handleApproveDraft} onRejectDraft={handleRejectDraft} />
        </aside>
        {inspectorOpen && <button type="button" className="wa-scrim" onClick={() => setInspectorOpen(false)} aria-label={tr('إغلاق لوحة المساعد', 'Close assistant panel')} />}
      </div>
      )}
      <PairingModal isOpen={isPairingOpen} status={status} onClose={() => setIsPairingOpen(false)} onConnect={handleConnect} onDisconnect={handleDisconnect} />
      <SimulatorModal isOpen={isSimulatorOpen} onClose={() => setIsSimulatorOpen(false)} onSimulate={handleSimulate} />
      <StickerStudioModal isOpen={isStickerStudioOpen} onClose={() => setIsStickerStudioOpen(false)} selectedChatId={selectedChatId} onSendSticker={async (chatId, _b64) => { await api.sendMessage(chatId, '[Sticker]'); }} />
    </div>
  );
}

export default App;

