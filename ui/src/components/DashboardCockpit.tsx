import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, CheckCheck, ContactRound, MessageCircle, Network, Play, Radio, Settings2, Smartphone, Smile, Wifi, WifiOff, X } from 'lucide-react';
import { Gemini } from '@lobehub/icons';
import { WhatsApp } from '@lobehub/ui/icons';
import { Badge as AstryxBadge } from '@astryxdesign/core/Badge';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { api } from '../api/client';
import { ChatRequestCoordinator } from '../lib/chat-request-coordinator';
import { DashboardSync, type SyncHealth } from '../lib/dashboard-sync';
import { featureEnabled, type CapabilityRow } from '../lib/capabilities';
import type { AgentDraft, AgentMode, ChatMessage, ChatSummary, ModeratorPersona, PolicyConfig, SystemStatus } from '../api/types';
import { ChatList } from './ChatList';
import { BrandBrainPage } from './BrandBrainPage';
import { BroadcastPage } from './BroadcastPage';
import { ChatThread } from './ChatThread';
import { FunnelPage } from './FunnelPage';
import { ModeratorDrawer, type ModeratorThought } from './ModeratorDrawer';
import { PairingModal } from './PairingModal';
import { PersonaSettingsPage } from './PersonaSettingsPage';
import { SimulatorModal } from './SimulatorModal';
import { StickerStudioModal } from './StickerStudioModal';
import { OwnerSignOutButton } from './OwnerAccessGate';
import { useOwnerAccess } from './owner-access-context';
import { useLocale } from '../locale-context';

const handleSimulate = (text: string, senderName?: string) => api.simulate(text, senderName);

const handleConnect = async (phone?: string, refresh?: boolean) => {
  await api.connect(phone, refresh);
};

const handleDisconnect = async () => {
  await api.disconnect();
};

type EventPayload = Record<string, unknown>;

function isRecord(value: unknown): value is EventPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function readEvent(event: MessageEvent<unknown>) {
  if (typeof event.data !== 'string') return undefined;
  const value: unknown = JSON.parse(event.data);
  return isRecord(value) ? value : undefined;
}

function isMessageStatus(value: unknown): value is NonNullable<ChatMessage['status']> {
  return value === 'pending' || value === 'sent' || value === 'delivered' || value === 'read';
}

function isChatMessage(value: EventPayload): value is EventPayload & ChatMessage {
  const { type, status, quotedMessage, reactions, deliveryState } = value;
  return typeof value.id === 'string' && typeof value.chatId === 'string' &&
    typeof value.sender === 'string' && typeof value.text === 'string' &&
    typeof value.timestamp === 'number' && typeof value.isFromMe === 'boolean' &&
    (type === 'text' || type === 'audio' || type === 'image' || type === 'video' || type === 'document' || type === 'other') &&
    (status === undefined || isMessageStatus(status)) &&
    (deliveryState === undefined || deliveryState === 'queued' || deliveryState === 'attempting' ||
      deliveryState === 'uncertain' || deliveryState === 'failed') &&
    (value.lastAttemptAt === undefined || typeof value.lastAttemptAt === 'number') &&
    [value.senderName, value.mediaUrl, value.transcription, value.replyToId,
      value.sendIntentId, value.nativeMessageId].every(optionalString) &&
    (reactions === undefined || (Array.isArray(reactions) && reactions.every((emoji: unknown) => typeof emoji === 'string'))) &&
    (quotedMessage === undefined || (isRecord(quotedMessage) && typeof quotedMessage.id === 'string' &&
      typeof quotedMessage.sender === 'string' && typeof quotedMessage.text === 'string' &&
      optionalString(quotedMessage.senderName) && optionalString(quotedMessage.type)));
}

function isRoutingTrace(value: unknown) {
  return value === undefined || (isRecord(value) && typeof value.selectedModel === 'string' &&
    (value.tier === 'trivial' || value.tier === 'standard' || value.tier === 'complex') &&
    typeof value.confidence === 'number' && typeof value.routerLatencyMs === 'number' &&
    typeof value.reason === 'string' && (value.bypassed === undefined || typeof value.bypassed === 'boolean'));
}

function isDraft(value: EventPayload): value is EventPayload & AgentDraft {
  const { status, toolCall } = value;
  return [value.id, value.chatId, value.incomingMessageId, value.incomingText,
    value.proposedReply, value.reasoning].every((field) => typeof field === 'string') &&
    typeof value.confidence === 'number' && typeof value.createdAt === 'number' &&
    (status === 'pending' || status === 'approved' || status === 'rejected' || status === 'sent') &&
    (value.sendAsVoiceNote === undefined || typeof value.sendAsVoiceNote === 'boolean') &&
    isRoutingTrace(value.modelRouting) &&
    (toolCall === undefined || (isRecord(toolCall) && typeof toolCall.namespacedName === 'string' &&
      typeof toolCall.serverName === 'string' && typeof toolCall.toolName === 'string' && isRecord(toolCall.args) &&
      (toolCall.risk === 'readOnly' || toolCall.risk === 'mutating') &&
      optionalString(toolCall.reason) && optionalString(toolCall.proposedFollowUp)));
}

function isThoughtDecision(value: unknown): value is ModeratorThought['decision'] {
  return isRecord(value) && typeof value.intent === 'string' &&
    typeof value.reasoning === 'string' && typeof value.confidence === 'number' &&
    isRoutingTrace(value.modelRouting);
}

function isConnectionState(value: unknown): value is SystemStatus['state'] {
  return value === 'disconnected' || value === 'connecting' || value === 'qr_ready' ||
    value === 'pairing_code_ready' || value === 'connected' || value === 'failed';
}

function readConnectedUser(value: unknown) {
  if (isRecord(value) && typeof value.id === 'string') {
    return { id: value.id, name: typeof value.name === 'string' ? value.name : undefined,
      phone: typeof value.phone === 'string' ? value.phone : undefined };
  }
  return undefined;
}

async function refreshChats(setChats: (chats: ChatSummary[]) => void) {
  try {
    const response = await api.listChats();
    if (response.chats) setChats(response.chats);
  } catch (error) {
    console.warn('Failed to refresh chats:', error);
  }
}

export function DashboardCockpit() {
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
  const [latestThought, setLatestThought] = useState<ModeratorThought>();

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
  const [page, setPage] = useState<'chats' | 'settings' | 'brain' | 'funnel' | 'broadcast'>(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/settings/') ? 'settings' :
    typeof window !== 'undefined' && window.location.pathname === '/brand-brain' ? 'brain' :
    typeof window !== 'undefined' && window.location.pathname === '/funnel' ? 'funnel' :
    typeof window !== 'undefined' && window.location.pathname === '/broadcast' ? 'broadcast' : 'chats'
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
      window.location.pathname === '/funnel' ? 'funnel' :
      window.location.pathname === '/broadcast' ? 'broadcast' : 'chats'
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
    const [statusRes, chatsRes, draftsRes, personaRes, capsRes] = await Promise.allSettled([
      api.getStatus(),
      api.listChats(),
      api.listDrafts(),
      api.getPersona(),
      api.getRuntimeCapabilities()
    ]);

    let coreFailure: unknown = null;
    if (statusRes.status === 'rejected') coreFailure = statusRes.reason;
    else setStatus(statusRes.value);
    if (capsRes.status === 'fulfilled' && capsRes.value.capabilities) setCapabilityRows(capsRes.value.capabilities);
    if (chatsRes.status === 'rejected') {
      coreFailure = coreFailure ?? chatsRes.reason;
    } else if (Array.isArray(chatsRes.value.chats)) {
      sync.noteSnapshot();
      setChats(chatsRes.value.chats);
      setSelectedChatId((prev) => {
        const exists = chatsRes.value.chats.some((c: { id: string }) => c.id === prev);
        const firstChat = chatsRes.value.chats[0];
        return (!prev || !exists) && firstChat ? firstChat.id : prev;
      });
    }
    if (draftsRes.status === 'rejected') {
      coreFailure = coreFailure ?? draftsRes.reason;
    } else if (draftsRes.value.drafts) {
      setDrafts(draftsRes.value.drafts);
    }
    if (personaRes.status === 'fulfilled') {
      setPersona(personaRes.value.persona);
      policyRef.current = personaRes.value.policy;
      setPersonaLoadFailed(false);
    } else {
      setPersonaLoadFailed(true);
    }
    const failed = statusRes.status === 'rejected' || chatsRes.status === 'rejected' || draftsRes.status === 'rejected';
    setSyncHealth(failed ? sync.noteLoadFailure(coreFailure) : sync.noteLoadSuccess());
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
    if (!selectedChatId) return undefined;

    // WA-020: begin a new request cycle; the previous chat's outstanding
    // fetches are aborted and their late responses are ignored.
    const sync = messageSyncRef.current;
    const token = sync.begin(selectedChatId);

    // Immediately fetch messages when chat is selected
    const loadMessages = async () => {
      try {
        const res = await api.getMessages(selectedChatId, { signal: token.signal });
        if (sync.isCurrent(token)) setMessages(res.messages || []);
      } catch (error) {
        if (!token.signal.aborted) console.error(error);
      }
    };
    void loadMessages();

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
            const firstChat = res.chats[0];
            return (!prev || !exists) && firstChat ? firstChat.id : prev;
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
        const update = readEvent(e);
        if (!update || !isConnectionState(update.state) || typeof update.updatedAt !== 'number') return;
        const { state, updatedAt } = update;
        setStatus((prev) => ({
          ...prev,
          state,
          updatedAt,
          pendingDraftsCount: prev?.pendingDraftsCount ?? 0,
          connectedUser: 'connectedUser' in update ? readConnectedUser(update.connectedUser) : prev?.connectedUser,
          error: typeof update.error === 'string' ? update.error : undefined,
          qrDataUrl: typeof update.qrDataUrl === 'string' ? update.qrDataUrl : undefined,
          pairingCode: typeof update.pairingCode === 'string' ? update.pairingCode : undefined
        }));
      } catch {
        console.debug('[Dashboard] Ignored malformed state change');
      }
    });

    eventSource.addEventListener('open', () => {
      syncRef.current.noteStreamOpen();
      if (streamDroppedRef.current) {
        streamDroppedRef.current = false;
        void loadInitialData();
      }
    });

    eventSource.addEventListener('error', () => {
      streamDroppedRef.current = true;
      setSyncHealth(syncRef.current.noteStreamDrop());
      scheduleResync();
    });

    eventSource.addEventListener('new_message', (e: MessageEvent) => {
      try {
        const newMsg = readEvent(e);
        if (!newMsg || !isChatMessage(newMsg)) return;
        const activeId = selectedChatIdRef.current;
        if (activeId === newMsg.chatId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }

        void refreshChats(setChats);
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('message_status', (e: MessageEvent) => {
      try {
        const payload = readEvent(e);
        if (!payload) return;
        const { chatId, messageId, status: messageStatus } = payload;
        if (typeof chatId !== 'string' || typeof messageId !== 'string' || !isMessageStatus(messageStatus)) return;
        if (selectedChatIdRef.current !== chatId) return;
        setMessages((prev) => prev.map((message) =>
          message.id === messageId && message.isFromMe ? { ...message, status: messageStatus } : message
        ));
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('send_intent', (e: MessageEvent) => {
      let chatId: unknown;
      try {
        chatId = readEvent(e)?.chatId;
      } catch {
        console.debug('[Dashboard] Ignored malformed send intent');
        return;
      }
      const refreshMessages = async () => {
        try {
          if (typeof chatId !== 'string' || chatId !== selectedChatIdRef.current) return;
          const response = await api.getMessages(chatId);
          if (chatId === selectedChatIdRef.current) setMessages(response.messages);
        } catch (error) {
          console.warn('[Delivery] Could not refresh message states:', error);
        }
      };
      void refreshMessages();
    });

    eventSource.addEventListener('agent_thought', (e: MessageEvent) => {
      try {
        const thought = readEvent(e);
        if (thought && typeof thought.chatId === 'string' && typeof thought.messageId === 'string' && isThoughtDecision(thought.decision)) {
          setLatestThought({ chatId: thought.chatId, messageId: thought.messageId, decision: thought.decision });
        }
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('message_reaction', (e: MessageEvent) => {
      try {
        const payload = readEvent(e);
        if (!payload) return;
        const { chatId, messageId, emoji } = payload;
        const activeId = selectedChatIdRef.current;
        if (typeof chatId === 'string' && activeId === chatId && typeof messageId === 'string') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === messageId) {
                const current = m.reactions || [];
                const updated = typeof emoji === 'string' && emoji
                  ? Array.from(new Set([...current, emoji]))
                  : current;
                return { ...m, reactions: updated };
              }
              return m;
            })
          );
        }
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('new_draft', (e: MessageEvent) => {
      try {
        const draft = readEvent(e);
        if (draft && isDraft(draft)) {
          setDrafts((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)]);
        }
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('draft_updated', (e: MessageEvent) => {
      try {
        const payload = readEvent(e);
        if (typeof payload?.draftId === 'string') {
          setDrafts((prev) => prev.filter((d) => d.id !== payload.draftId));
        }
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('chat_updated', () => {
      void refreshChats(setChats);
    });

    eventSource.addEventListener('chat_deleted', (e: MessageEvent) => {
      try {
        const payload = readEvent(e);
        if (typeof payload?.chatId === 'string') {
          setChats((prev) => prev.filter((c) => c.id !== payload.chatId));
          if (selectedChatIdRef.current === payload.chatId) {
            setSelectedChatId(undefined);
            setMessages([]);
            setMobileView('list');
          }
        }
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
      }
    });

    eventSource.addEventListener('messages_cleared', (e: MessageEvent) => {
      try {
        const payload = readEvent(e);
        if (typeof payload?.chatId === 'string' && selectedChatIdRef.current === payload.chatId) {
          setMessages([]);
        }
      } catch {
        console.debug('[Dashboard] Ignored malformed event');
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
  const openBroadcast = () => {
    if (page === 'broadcast') return;
    window.history.pushState({ waBroadcast: true }, '', '/broadcast');
    setPage('broadcast');
    setInspectorOpen(false);
  };
  const closeBroadcast = () => {
    if (window.history.state?.waBroadcast) window.history.back();
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
          <fieldset className="wa-language-switch" style={{ minInlineSize: 0, margin: 0 }} aria-label={tr('لغة الواجهة', 'Interface language')}>
            <button type="button" aria-pressed={language === 'ar'} className={language === 'ar' ? 'is-active' : ''} onClick={() => setLanguage('ar')}>عربي</button>
            <button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')}>EN</button>
          </fieldset>
          <button type="button" className={'wa-connection ' + (status?.state === 'connected' ? 'is-connected' : 'is-disconnected')} onClick={() => setIsPairingOpen(true)} aria-label={tr('حالة ربط واتساب', 'WhatsApp connection status')}>
            {status?.state === 'connected' ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{status?.state === 'connected' ? tr('متصل', 'Connected') : status?.state === 'connecting' ? tr('جارٍ الاتصال', 'Connecting') : tr('ربط واتساب', 'Link WhatsApp')}</span>
          </button>
          <span className="wa-header-separator" aria-hidden="true" />
          <button type="button" className="wa-icon-button wa-simulator-trigger" onClick={() => setIsSimulatorOpen(true)} aria-label={tr('اختبار رد المساعد', 'Test the assistant')} title={tr('اختبار رد المساعد', 'Test the assistant')}><Play size={19} /></button>
          <button type="button" className="wa-icon-button" onClick={() => setIsStickerStudioOpen(true)} aria-label={tr('استوديو الملصقات', 'Sticker Studio')} title={tr('استوديو الملصقات', 'Sticker Studio')}><Smile size={19} /></button>
          <button type="button" className={'wa-icon-button ' + (page === 'broadcast' ? 'is-active' : '')} onClick={openBroadcast} aria-label={tr('البث الذكي', 'Smart Broadcast')} title={tr('البث الذكي', 'Smart Broadcast')}><Radio size={19} /></button>
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
      ) : page === 'broadcast' ? (
        <BroadcastPage onClose={closeBroadcast} />
      ) : (
      <div className={'wa-workspace ' + (mobileView === 'list' ? 'is-list-view' : 'is-chat-view') + (!inspectorExpanded ? ' is-inspector-collapsed' : '')}>
        {syncHealth !== 'live' && syncHealth !== 'loading' && (
          <div className={'wa-sync-banner is-' + syncHealth}>
            <output>
                {syncHealth === 'unauthenticated'
                ? tr('انتهت جلسة الوصول. سجّل الدخول مجددًا لتحديث البيانات.', 'Owner session expired. Sign in again to refresh data.')
                : syncHealth === 'error'
                  ? tr('تعذّر تحميل البيانات من الخادم.', 'Could not load data from the server.')
                  : tr('تظهر آخر بيانات معروفة؛ التحديث المباشر متعذّر حاليًا.', 'Showing last known data; live updates are unavailable.')}
            </output>
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


