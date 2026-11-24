import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  WAMessageStatus,
  jidNormalizedUser,
  type WASocket,
  type proto,
  type WAMessage
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Readable } from 'node:stream';
import { readStreamWithCap, MediaTooLargeError } from '../agent/media-bounds';
import pino from 'pino';
import { rmSync, mkdirSync } from 'node:fs';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ChatMessage, PairingState } from '../domain/types';

export interface WhatsAppReactionEvent {
  chatId: string;
  messageId: string;
  emoji: string;
  fromMe: boolean;
}

export interface WhatsAppMessageStatusEvent {
  chatId: string;
  messageId: string;
  status: NonNullable<ChatMessage['status']>;
}

export function mapWhatsAppMessageStatus(status: number | null | undefined): ChatMessage['status'] | undefined {
  switch (status) {
    case WAMessageStatus.PENDING: return 'pending';
    case WAMessageStatus.SERVER_ACK: return 'sent';
    case WAMessageStatus.DELIVERY_ACK: return 'delivered';
    case WAMessageStatus.READ:
    case WAMessageStatus.PLAYED: return 'read';
    default: return undefined;
  }
}

/**
 * WA-014: every close reason lands in exactly one class. Terminal conditions (logged out,
 * forbidden, replaced session) stop the lifecycle and request owner action; QR cycling is an
 * expected pairing restart with its own budget; everything else is a transient network failure
 * eligible for bounded retry. Never evade provider restrictions by retrying terminal codes.
 */
export type DisconnectClass = 'terminal' | 'qr_cycle' | 'transient';

export function classifyDisconnect(statusCode: number | undefined): DisconnectClass {
  if (statusCode === DisconnectReason.loggedOut || // 401
      statusCode === DisconnectReason.forbidden || // 403
      statusCode === 440) {                        // connectionReplaced
    return 'terminal';
  }
  if (statusCode === DisconnectReason.timedOut ||     // 408
      statusCode === DisconnectReason.restartRequired || // 515
      statusCode === 500) {
    return 'qr_cycle';
  }
  return 'transient';
}

/** WA-014: bounded retry lifecycle budgets. */
export const MAX_RECONNECT_ATTEMPTS = 8;
export const MAX_QR_CYCLES = 20;

export interface WhatsAppSocketOptions {
  sessionDir?: string;
  audioTranscriber?: AudioTranscriber;
  onStateChange?: (state: PairingState) => void;
  onMessage?: (message: ChatMessage, metadata?: { historical: boolean }) => void;
  onReaction?: (reaction: WhatsAppReactionEvent) => void;
  onMessageStatus?: (event: WhatsAppMessageStatusEvent) => void;
  /** WA-013/WA-014 test seams; production defaults preserve the current Baileys wiring. */
  socketFactory?: (config: Record<string, unknown>) => WASocket;
  authStateFactory?: (sessionDir: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
  versionProvider?: () => Promise<{ version: [number, number, number] }>;
  reconnectDelays?: { baseMs: number; maxMs: number };
  /** WA-017 test seam: media download as a stream so byte caps are enforced during
   * transfer. Production default preserves Baileys downloadMediaMessage behavior. */
  mediaDownloader?: (message: WAMessage) => Promise<Readable>;
}

export class WhatsAppSocketClient {
  private sock: WASocket | null = null;
  private authState: any = null;
  private sessionDir: string;
  private audioTranscriber?: AudioTranscriber;
  private onStateChange?: (state: PairingState) => void;
  private onMessageCallback?: (message: ChatMessage, metadata?: { historical: boolean }) => void;
  private onReactionCallback?: (reaction: WhatsAppReactionEvent) => void;
  private onMessageStatusCallback?: (event: WhatsAppMessageStatusEvent) => void;
  // WA-016: every insertion path into these caches enforces the bound (FIFO eviction).
  private static readonly MAX_RAW_MESSAGES = 500;
  private static readonly MAX_TRANSPORT_JIDS = 1000;
  private rawMessages = new Map<string, WAMessage>();
  private transportJids = new Map<string, string>();

  /**
   * WA-016: the ONLY way these caches grow. A cache set always enforces the documented
   * bound, so no insertion path can leak memory in a long-running session.
   */
  private boundedCacheSet<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
    if (map.has(key)) map.delete(key); // refresh FIFO position
    map.set(key, value);
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  /**
   * WA-016: quote cache identity is (chat, message), never the bare provider message id -
   * a bare id could resolve a quote against a different contact's message.
   */
  private quoteKey(chatId: string, messageId: string): string {
    return JSON.stringify([chatId, messageId]);
  }
  private currentState: PairingState = {
    state: 'disconnected',
    updatedAt: Date.now()
  };
  private isConnecting = false;
  private isExplicitlyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private pairingCodeRequestedNumber: string | null = null;
  private startMutex: Promise<void> = Promise.resolve();
  // WA-013: every lifecycle transition bumps the generation; callbacks from retired
  // generations fence themselves before mutating state.
  private socketGeneration = 0;
  private qrCycleCount = 0;
  private readonly socketFactory: (config: Record<string, unknown>) => WASocket;
  private readonly authStateFactory: (sessionDir: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
  private readonly versionProvider: () => Promise<{ version: [number, number, number] }>;
  private readonly reconnectDelays: { baseMs: number; maxMs: number };
  private readonly mediaDownloader: (message: WAMessage) => Promise<Readable>;

  constructor(options: WhatsAppSocketOptions = {}) {
    this.sessionDir = options.sessionDir ?? './data/session';
    this.audioTranscriber = options.audioTranscriber;
    this.onStateChange = options.onStateChange;
    this.onMessageCallback = options.onMessage;
    this.onReactionCallback = options.onReaction;
    this.onMessageStatusCallback = options.onMessageStatus;
    this.socketFactory = options.socketFactory ?? ((config) => makeWASocket(config as any));
    this.authStateFactory = options.authStateFactory ?? ((dir) => useMultiFileAuthState(dir));
    this.versionProvider = options.versionProvider ?? (() => fetchLatestBaileysVersion());
    this.reconnectDelays = options.reconnectDelays ?? { baseMs: 500, maxMs: 15_000 };
    this.mediaDownloader = options.mediaDownloader
      ?? ((message) => downloadMediaMessage(message, 'stream', {}) as unknown as Promise<Readable>);
  }

  getState(): PairingState {
    return { ...this.currentState };
  }

  /**
   * Atomically flushes the session directory to purge stale credentials
   */
  public clearSession(): void {
    try {
      rmSync(this.sessionDir, { recursive: true, force: true });
      mkdirSync(this.sessionDir, { recursive: true });
      this.authState = null;
    } catch (err: unknown) {
      const fsErr = err as { code?: string };
      if (fsErr?.code !== 'ENOENT') {
        console.warn('[WhatsApp] Failed to cleanly clear session directory:', err);
      }
    }
  }

  private setState(updates: Partial<PairingState>) {
    this.currentState = {
      ...this.currentState,
      ...updates,
      updatedAt: Date.now()
    };
    if ('error' in updates && updates.error === undefined) delete this.currentState.error;
    if ('qrDataUrl' in updates && updates.qrDataUrl === undefined) delete this.currentState.qrDataUrl;
    if ('pairingCode' in updates && updates.pairingCode === undefined) delete this.currentState.pairingCode;

    // Emit a JSON-normalized snapshot where cleared fields are explicitly null
    const snapshot = {
      ...this.currentState,
      qrDataUrl: this.currentState.qrDataUrl ?? null,
      pairingCode: this.currentState.pairingCode ?? null,
      error: this.currentState.error ?? null
    };
    this.onStateChange?.(snapshot as PairingState);
  }

  /**
   * Initializes and starts the WhatsApp socket connection with serialization mutex
   */
  async start(pairingPhoneNumber?: string, options?: { refresh?: boolean; viaReconnect?: boolean }): Promise<void> {
    // A deliberate start (UI, pairing request) is a new pairing epoch: retry budgets reset.
    // Timer-driven restarts keep counting so WA-014's bounded budget can actually exhaust.
    if (!options?.viaReconnect) {
      this.reconnectAttempts = 0;
      this.qrCycleCount = 0;
    }
    const priorMutex = this.startMutex;
    let releaseMutex!: () => void;
    this.startMutex = new Promise<void>((resolve) => { releaseMutex = resolve; });
    await priorMutex.catch((err) => {
      console.warn('[WhatsAppSocket] Prior startMutex invocation settled with error:', err);
    });

    try {
      await this.internalStart(pairingPhoneNumber, options);
    } finally {
      releaseMutex();
    }
  }

  private async internalStart(pairingPhoneNumber?: string, options?: { refresh?: boolean }): Promise<void> {
    const generation = ++this.socketGeneration;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isExplicitlyClosed = false;

    // Allow re-initiating if explicit refresh is requested or if not currently connecting
    if (this.isConnecting && !options?.refresh) return;

    if (options?.refresh) {
      this.clearSession();
    }

    if (pairingPhoneNumber) {
      this.pairingCodeRequestedNumber = pairingPhoneNumber.replace(/\D/g, '');
    } else if (options?.refresh || !pairingPhoneNumber) {
      this.pairingCodeRequestedNumber = null;
    }

    // Clean up any existing socket before reconnecting to prevent session conflicts
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('messages.upsert');
        this.sock.ev.removeAllListeners('messages.update');
        this.sock.ev.removeAllListeners('message-receipt.update');
        this.sock.ev.removeAllListeners('messaging-history.set');
        this.sock.end(undefined);
      } catch (err) {
        console.warn('[WhatsApp] Error during socket listener cleanup:', err);
      }
      this.sock = null;
    }

    this.isConnecting = true;
    this.setState({ state: 'connecting', error: undefined });

    try {
      let { state, saveCreds } = await this.authStateFactory(this.sessionDir);

      // Self-heal: If auth credentials have `me` set but are unregistered (or corrupted from prior logout),
      // Baileys will neither generate a QR code nor connect. Wipe the dead session and re-initialize.
      if (state.creds?.me && !state.creds?.registered) {
        console.warn('[WhatsApp] Detected stale unregistered credentials with me populated. Auto-flushing session...');
        this.clearSession();
        const freshAuth = await this.authStateFactory(this.sessionDir);
        state = freshAuth.state;
        saveCreds = freshAuth.saveCreds;
      }

      // WA-013: a disconnect() or a newer start() that landed during the auth await
      // owns the lifecycle now; this older attempt must stop before touching the socket.
      if (generation !== this.socketGeneration) return;

      this.authState = state;
      const { version } = await this.versionProvider();
      if (generation !== this.socketGeneration) return;

      const logger = pino({ level: 'silent' });

      const sock = this.socketFactory({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000
      });
      if (generation !== this.socketGeneration) return;
      this.sock = sock;

      // WA-013: credential writes flush only while this socket generation is current.
      this.sock.ev.on('creds.update', () => {
        if (generation !== this.socketGeneration) return;
        void saveCreds();
      });

      this.sock.ev.on('connection.update', async (update) => {
        if (generation !== this.socketGeneration) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.isConnecting = false;
          const socket = this.sock;
          if (socket && this.pairingCodeRequestedNumber && !socket.authState?.creds?.registered) {
            try {
              const code = await socket.requestPairingCode(this.pairingCodeRequestedNumber);
              if (generation !== this.socketGeneration || this.sock !== socket) return;
              this.setState({
                state: 'pairing_code_ready',
                pairingCode: code,
                qrDataUrl: undefined,
                error: undefined
              });
            } catch (err: any) {
              this.setState({ error: `Failed to request pairing code: ${err.message}` });
            }
          } else {
            try {
              const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
              if (generation !== this.socketGeneration || this.sock !== socket) return;
              this.setState({
                state: 'qr_ready',
                qrDataUrl: dataUrl,
                pairingCode: undefined,
                error: undefined // Clear any transient reconnect error once fresh QR is ready
              });
            } catch (err: any) {
              this.setState({ error: `Failed to render QR code: ${err.message}` });
            }
          }
        }

        if (connection === 'open') {
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.reconnectAttempts = 0;
          this.qrCycleCount = 0;
          this.isConnecting = false;
          const user = this.sock?.user;
          this.setState({
            state: 'connected',
            qrDataUrl: undefined,
            pairingCode: undefined,
            error: undefined,
            connectedUser: user
              ? {
                  id: user.id,
                  name: user.name,
                  phone: user.id.split(':')[0] || user.id.split('@')[0]
                }
              : undefined
          });
        }

        if (connection === 'close') {
          this.isConnecting = false;
          if (this.isExplicitlyClosed) {
            this.setState({
              state: 'disconnected',
              error: undefined,
              qrDataUrl: undefined,
              pairingCode: undefined
            });
            return;
          }

          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          const kind = classifyDisconnect(statusCode);

          // WA-014: terminal codes never auto-retry - evading provider restrictions is not allowed.
          if (statusCode === DisconnectReason.loggedOut) {
            this.clearSession();
            this.setState({
              state: 'disconnected',
              error: 'Session logged out. Please re-pair your WhatsApp device.'
            });
            return;
          }
          if (kind === 'terminal') {
            this.setState({
              state: 'failed',
              error: `Connection terminated (${statusCode ?? 'unknown'}). Owner action required: review the session and reconnect manually.`
            });
            return;
          }

          if (kind === 'qr_cycle') {
            // During QR pairing, 408 (timeout), 500, and 515 are routine cycling events.
            this.qrCycleCount++;
            if (this.qrCycleCount > MAX_QR_CYCLES) {
              this.setState({
                state: 'failed',
                error: `Pairing did not complete: QR restart budget exhausted after ${MAX_QR_CYCLES} cycles. Owner action required to pair again.`
              });
              return;
            }
            this.setState({ state: 'connecting', error: undefined });
            this.scheduleReconnect(generation, this.reconnectDelays.baseMs * 3);
            return;
          }

          // transient: bounded retry with exponential backoff
          this.reconnectAttempts++;
          if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            this.setState({
              state: 'failed',
              error: `Reconnect budget exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts (last disconnect code ${statusCode ?? 'unknown'}). Owner action required.`
            });
            return;
          }
          const { baseMs, maxMs } = this.reconnectDelays;
          const maxBackoff = Math.min(baseMs * 2 * Math.pow(1.5, this.reconnectAttempts), maxMs);
          const backoff = Math.floor(baseMs + Math.random() * Math.max(1, maxBackoff - baseMs));
          this.setState({
            state: 'connecting',
            error: `Connection lost. Reconnecting in ${Math.max(1, Math.round(backoff / 1000))}s...`
          });
          this.scheduleReconnect(generation, backoff);
        }
      });


      const publishStatus = (remoteJid: string, messageId: string, status: NonNullable<ChatMessage['status']>) => {
        void this.canonicalizeJid(remoteJid)
          .then((chatId) => this.onMessageStatusCallback?.({ chatId, messageId, status }))
          .catch((error) => console.warn('[WhatsApp] Could not resolve receipt JID:', error));
      };

      this.sock.ev.on('messages.update', (updates) => {
        if (generation !== this.socketGeneration) return;
        for (const { key, update } of updates) {
          if (!key.id || !key.remoteJid || key.fromMe === false) continue;
          const status = mapWhatsAppMessageStatus(update.status);
          if (status) publishStatus(key.remoteJid, key.id, status);
        }
      });

      // Participant receipts do not establish group-wide delivery or read state.
      this.sock.ev.on('message-receipt.update', (receipts) => {
        if (generation !== this.socketGeneration) return;
        for (const { key, receipt } of receipts) {
          if (!key.id || !key.remoteJid || key.fromMe === false || key.remoteJid.endsWith('@g.us')) continue;
          const status = receipt.readTimestamp ? 'read' : receipt.receiptTimestamp ? 'delivered' : undefined;
          if (status) publishStatus(key.remoteJid, key.id, status);
        }
      });

      // Handle incoming & synced messages (both real-time 'notify' and background 'append')
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (generation !== this.socketGeneration) return;
        for (const raw of messages) {
          if (!raw.message) continue;
          // Ignore status broadcasts
          if (raw.key.remoteJid === 'status@broadcast') continue;

          // Cache raw message for replying/quoting (bounded, composite identity)
          if (raw.key?.id && raw.key.remoteJid && raw.message) {
            this.boundedCacheSet(this.rawMessages, this.quoteKey(raw.key.remoteJid, raw.key.id), raw, WhatsAppSocketClient.MAX_RAW_MESSAGES);
          }

          try {
            const parsed = await this.parseIncomingMessage(raw);
            if (parsed) {
              this.onMessageCallback?.(parsed, { historical: type !== "notify" });
            }
          } catch {
            // Log message parsing error gracefully
          }
        }
      });

      // Handle continuous history harvest synced from phone
      this.sock.ev.on('messaging-history.set', async ({ messages: historyMessages }) => {
        if (generation !== this.socketGeneration) return;
        if (!historyMessages || !Array.isArray(historyMessages)) return;
        for (const raw of historyMessages) {
          if (!raw.message) continue;
          if (raw.key.remoteJid === 'status@broadcast') continue;

          if (raw.key?.id && raw.key.remoteJid && raw.message) {
            this.boundedCacheSet(this.rawMessages, this.quoteKey(raw.key.remoteJid, raw.key.id), raw, WhatsAppSocketClient.MAX_RAW_MESSAGES);
          }

          try {
            const parsed = await this.parseIncomingMessage(raw);
            if (parsed) {
              this.onMessageCallback?.(parsed, { historical: true });
            }
          } catch (err) {
            console.warn('[WhatsApp] Failed to parse historical incoming message:', err);
          }
        }
      });
    } catch (err: any) {
      this.isConnecting = false;
      this.setState({ state: 'failed', error: err.message });
    }
  }

  /**
   * WA-013/WA-014: schedules a restart owned by the socket generation that closed. If the
   * generation moved on (disconnect() or a manual start() landed first), the timer is inert.
   */
  private scheduleReconnect(generation: number, delayMs: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (generation !== this.socketGeneration) return;
      void this.start(this.pairingCodeRequestedNumber || undefined, { viaReconnect: true });
    }, delayMs);
  }

  /**
   * Canonicalizes any WhatsApp JID (phone, companion device, or LID) into standard <phone>@s.whatsapp.net
   */
  async canonicalizeJid(jid: string): Promise<string> {
    if (!jid) return jid;
    const normalized = jidNormalizedUser(jid);

    if (normalized.endsWith('@lid')) {
      const lidUser = normalized.split('@')[0];
      try {
        if (this.authState?.keys) {
          const mapping = await this.authState.keys.get('lid-mapping', [`${lidUser}_reverse`]);
          const phone = mapping?.[`${lidUser}_reverse`];
          if (phone) {
            const canonical = `${phone}@s.whatsapp.net`;
            this.boundedCacheSet(this.transportJids, canonical, jid, WhatsAppSocketClient.MAX_TRANSPORT_JIDS);
            this.boundedCacheSet(this.transportJids, jid, canonical, WhatsAppSocketClient.MAX_TRANSPORT_JIDS);
            return canonical;
          }
        }
      } catch (err) {
        console.warn('[WhatsApp] Failed to resolve reverse LID mapping:', err);
      }
    }

    this.boundedCacheSet(this.transportJids, normalized, jid, WhatsAppSocketClient.MAX_TRANSPORT_JIDS);
    return normalized;
  }

  /**
   * Recursively unwraps nested message containers (ephemeral, viewOnce, edited, etc.)
   */
  private unwrapMessage(msg: proto.IMessage | null | undefined): proto.IMessage | null {
    if (!msg) return null;
    if (msg.ephemeralMessage?.message) return this.unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage?.message) return this.unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2?.message) return this.unwrapMessage(msg.viewOnceMessageV2.message);
    if (msg.documentWithCaptionMessage?.message) return this.unwrapMessage(msg.documentWithCaptionMessage.message);
    if (msg.editedMessage?.message?.protocolMessage?.editedMessage) {
      return this.unwrapMessage(msg.editedMessage.message.protocolMessage.editedMessage);
    }
    return msg;
  }

  /**
   * Parses raw Baileys proto.IWebMessageInfo into clean ChatMessage
   */
  private async parseIncomingMessage(raw: proto.IWebMessageInfo): Promise<ChatMessage | null> {
    const key = raw.key;
    if (!key?.remoteJid) return null;

    const chatId = await this.canonicalizeJid(key.remoteJid);
    const rawMessage = raw.message;
    if (!rawMessage) return null;

    const message = this.unwrapMessage(rawMessage);
    if (!message) return null;

    // Handle reaction messages without creating phantom message bubbles
    if (message.reactionMessage) {
      const reaction = message.reactionMessage;
      const targetId = reaction.key?.id;
      const emoji = reaction.text || '';
      if (targetId) {
        this.onReactionCallback?.({
          chatId,
          messageId: targetId,
          emoji,
          fromMe: Boolean(key.fromMe)
        });
      }
      return null;
    }

    // Filter out internal sync and protocol messages
    if (
      message.protocolMessage ||
      message.senderKeyDistributionMessage ||
      message.keepInChatMessage ||
      message.pollUpdateMessage
    ) {
      return null;
    }

    const isFromMe = Boolean(key.fromMe);
    const sender = isFromMe
      ? this.sock?.user?.id || 'me'
      : (key.participant ? await this.canonicalizeJid(key.participant) : chatId);

    let type: ChatMessage['type'] = 'text';
    let text = '';
    let transcription: string | undefined = undefined;
    let audioBuffer: Buffer | undefined = undefined;

    if (message.conversation) {
      text = message.conversation;
      type = 'text';
    } else if (message.extendedTextMessage?.text) {
      text = message.extendedTextMessage.text;
      type = 'text';
    } else if (message.audioMessage) {
      type = 'audio';
      const fileLength = Number(message.audioMessage.fileLength ?? 0);
      const MAX_AUDIO_BYTES = 16 * 1024 * 1024; // 16 MB limit to prevent low-spec VPS OOM
      if (fileLength > MAX_AUDIO_BYTES) {
        console.warn(`[WhatsApp] Audio attachment exceeds 16MB limit (${fileLength} bytes). Skipping download.`);
        text = '🎵 [رسالة صوتية - الحجم يتجاوز 16 ميجابايت]';
      } else {
        try {
          if (this.sock) {
            // WA-017: stream with a hard byte cap during transfer; a false declared
            // fileLength can never cause an unbounded download.
            const stream = await this.mediaDownloader(raw as WAMessage);
            const buffer = await readStreamWithCap(stream, MAX_AUDIO_BYTES);
            audioBuffer = buffer;
            if (this.audioTranscriber && buffer && buffer.length > 0) {
              const result = await this.audioTranscriber.transcribeAudio(buffer, message.audioMessage.mimetype || 'audio/ogg; codecs=opus');
              transcription = result.transcription;
              text = transcription ? `🎵 [صوتي: ${transcription}]` : '🎵 [رسالة صوتية]';
            } else {
              text = '🎵 [رسالة صوتية]';
            }
          }
        } catch (err) {
          if (err instanceof MediaTooLargeError) {
            console.warn('[WhatsApp] Audio download exceeded the 16MB cap during transfer. Discarding.');
            text = '🎵 [رسالة صوتية - الحجم يتجاوز 16 ميجابايت]';
          } else {
            text = '🎵 [رسالة صوتية]';
          }
        }
      }
    } else if (message.imageMessage) {
      type = 'image';
      text = message.imageMessage.caption ? `📷 ${message.imageMessage.caption}` : '📷 [صورة]';
    } else if (message.videoMessage) {
      type = 'video';
      text = message.videoMessage.caption ? `🎥 ${message.videoMessage.caption}` : '🎥 [فيديو]';
    } else if (message.documentMessage) {
      type = 'document';
      text = message.documentMessage.caption
        ? `📄 ${message.documentMessage.caption}`
        : `📄 [ملف: ${message.documentMessage.fileName || 'مستند'}]`;
    }

    // Do NOT generate phantom bubbles for empty / unsupported messages
    if (!text.trim() && type === 'text') {
      return null;
    }

    const contextInfo =
      message.extendedTextMessage?.contextInfo ||
      message.imageMessage?.contextInfo ||
      message.videoMessage?.contextInfo ||
      message.audioMessage?.contextInfo ||
      message.documentMessage?.contextInfo;

    const replyToId = contextInfo?.stanzaId || undefined;
    let quotedMessage: ChatMessage['quotedMessage'] = undefined;

    if (replyToId && contextInfo) {
      const qMsg = this.unwrapMessage(contextInfo.quotedMessage);
      let quotedText = '';
      let quotedType = 'text';

      if (qMsg) {
        if (qMsg.conversation) {
          quotedText = qMsg.conversation;
        } else if (qMsg.extendedTextMessage?.text) {
          quotedText = qMsg.extendedTextMessage.text;
        } else if (qMsg.imageMessage) {
          quotedText = qMsg.imageMessage.caption ? `📷 ${qMsg.imageMessage.caption}` : '📷 صورة';
          quotedType = 'image';
        } else if (qMsg.videoMessage) {
          quotedText = qMsg.videoMessage.caption ? `🎥 ${qMsg.videoMessage.caption}` : '🎥 فيديو';
          quotedType = 'video';
        } else if (qMsg.audioMessage) {
          quotedText = '🎵 رسالة صوتية';
          quotedType = 'audio';
        } else if (qMsg.documentMessage) {
          quotedText = `📄 ${qMsg.documentMessage.fileName || 'مستند'}`;
          quotedType = 'document';
        }
      }

      const myId = this.sock?.user?.id;
      const isQuotedFromMe = contextInfo.participant
        ? (myId ? jidNormalizedUser(contextInfo.participant) === jidNormalizedUser(myId) : false)
        : false;

      quotedMessage = {
        id: replyToId,
        sender: contextInfo.participant ? await this.canonicalizeJid(contextInfo.participant) : chatId,
        senderName: isQuotedFromMe ? 'أنت' : (raw.pushName || undefined),
        text: quotedText,
        type: quotedType
      };
    }

    return {
      id: key.id || `msg_${Date.now()}`,
      chatId,
      sender,
      senderName: raw.pushName || undefined,
      text,
      timestamp: Number(raw.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
      isFromMe,
      type,
      transcription,
      mediaBuffer: audioBuffer,
      replyToId: replyToId || undefined,
      quotedMessage,
      status: isFromMe ? (mapWhatsAppMessageStatus(raw.status) ?? 'sent') : 'delivered'
    };
  }

  private notConnectedError(): Error & { code: string } {
    const error = new Error('WhatsApp socket is not connected') as Error & { code: string };
    error.code = 'WHATSAPP_NOT_CONNECTED';
    return error;
  }

  /**
   * WA-013: a send must stay bound to the socket generation that accepted it. If the socket
   * was swapped or torn down mid-flight (stale generation), fail instead of writing through
   * a socket that no longer owns the pairing.
   */
  private assertCurrentSocket(socketAtEntry: WASocket | null, generationAtEntry: number): WASocket {
    if (!socketAtEntry || this.sock !== socketAtEntry || this.socketGeneration !== generationAtEntry) {
      throw this.notConnectedError();
    }
    return socketAtEntry;
  }

  /**
   * Sends a message to a WhatsApp chat with optional realistic typing delay
   */
  async sendMessage(
    chatId: string,
    text: string,
    options: { replyToMessageId?: string; simulatedDelayMs?: number } = {}
  ): Promise<{ messageId: string }> {
    const generationAtEntry = this.socketGeneration;
    const socketAtEntry = this.assertCurrentSocket(this.sock, generationAtEntry);

    const targetJid = this.transportJids.get(chatId) || chatId;

    // Emit composing presence indicator
    try {
      await socketAtEntry.sendPresenceUpdate('composing', targetJid);
    } catch (err) {
      console.warn('[WhatsApp] Failed to send composing presence update:', err);
    }

    if (options.simulatedDelayMs && options.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.simulatedDelayMs));
    }

    // WA-013: re-check after the delay - the socket may have been replaced or disconnected meanwhile
    this.assertCurrentSocket(socketAtEntry, generationAtEntry);

    try {
      await socketAtEntry.sendPresenceUpdate('paused', targetJid);
    } catch (err) {
      console.warn('[WhatsApp] Failed to send paused presence update:', err);
    }

    // Safely resolve quoted message: only pass if raw message is cached with authentic proto.IMessage
    let quoted: WAMessage | undefined = undefined;
    if (options.replyToMessageId) {
      const cached = this.rawMessages.get(this.quoteKey(targetJid, options.replyToMessageId));
      if (cached && cached.message) {
        quoted = cached;
      }
    }

    const sent = await socketAtEntry.sendMessage(targetJid, { text }, quoted ? { quoted } : undefined);

    const messageId = sent?.key?.id;
    if (!messageId) {
      const error = new Error('WhatsApp send outcome is ambiguous: native message ID missing') as Error & { code: string };
      error.code = 'WHATSAPP_ACCEPTANCE_AMBIGUOUS';
      throw error;
    }
    if (sent.message) this.boundedCacheSet(this.rawMessages, this.quoteKey(targetJid, messageId), sent, WhatsAppSocketClient.MAX_RAW_MESSAGES);
    return { messageId };
  }

  /**
   * Sends a native WhatsApp PTT voice note (recording audio)
   */
  async sendVoiceNote(
    chatId: string,
    audioBuffer: Buffer | Uint8Array,
    options: { replyToMessageId?: string; simulatedRecordingDurationMs?: number } = {}
  ): Promise<{ messageId: string }> {
    const generationAtEntry = this.socketGeneration;
    const socketAtEntry = this.assertCurrentSocket(this.sock, generationAtEntry);

    const targetJid = this.transportJids.get(chatId) || chatId;

    // Emit recording audio presence indicator
    try {
      await socketAtEntry.sendPresenceUpdate('recording', targetJid);
    } catch (err) {
      console.warn('[WhatsApp] Failed to send recording presence update:', err);
    }

    const recordingDelay = options.simulatedRecordingDurationMs ?? 2500;
    if (recordingDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, recordingDelay));
    }

    // WA-013: re-check after the recording delay
    this.assertCurrentSocket(socketAtEntry, generationAtEntry);

    try {
      await socketAtEntry.sendPresenceUpdate('paused', targetJid);
    } catch (err) {
      console.warn('[WhatsApp] Failed to send paused presence update:', err);
    }

    // Safely resolve quoted message if available
    let quoted: WAMessage | undefined = undefined;
    if (options.replyToMessageId) {
      const cached = this.rawMessages.get(this.quoteKey(targetJid, options.replyToMessageId));
      if (cached && cached.message) {
        quoted = cached;
      }
    }

    const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    const sent = await socketAtEntry.sendMessage(
      targetJid,
      {
        audio: buf,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      },
      quoted ? { quoted } : undefined
    );

    const messageId = sent?.key?.id;
    if (!messageId) {
      const error = new Error('WhatsApp send outcome is ambiguous: native message ID missing') as Error & { code: string };
      error.code = 'WHATSAPP_ACCEPTANCE_AMBIGUOUS';
      throw error;
    }
    if (sent.message) this.boundedCacheSet(this.rawMessages, this.quoteKey(targetJid, messageId), sent, WhatsAppSocketClient.MAX_RAW_MESSAGES);
    return { messageId };
  }

  /**
   * Reacts to a message with an emoji (e.g. 👍, ❤️, 🙏)
   */
  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected');
    const targetJid = this.transportJids.get(chatId) || chatId;
    await this.sock.sendMessage(targetJid, {
      react: {
        text: emoji,
        key: {
          remoteJid: targetJid,
          id: messageId
        }
      }
    });
  }

  /**
   * Sends a WebP sticker to a WhatsApp chat
   */
  async sendSticker(
    chatId: string,
    stickerBuffer: Buffer | Uint8Array,
    options: { replyToMessageId?: string } = {}
  ): Promise<{ messageId: string }> {
    if (!this.sock) {
      const error = new Error('WhatsApp socket is not connected') as Error & { code: string };
      error.code = 'WHATSAPP_NOT_CONNECTED';
      throw error;
    }

    const targetJid = this.transportJids.get(chatId) || chatId;
    let quoted: WAMessage | undefined = undefined;
    if (options.replyToMessageId) {
      const cached = this.rawMessages.get(this.quoteKey(targetJid, options.replyToMessageId));
      if (cached && cached.message) {
        quoted = cached;
      }
    }

    const buf = Buffer.isBuffer(stickerBuffer) ? stickerBuffer : Buffer.from(stickerBuffer);
    const sent = await this.sock.sendMessage(
      targetJid,
      {
        sticker: buf
      },
      quoted ? { quoted } : undefined
    );

    const messageId = sent?.key?.id;
    if (!messageId) {
      const error = new Error('WhatsApp send outcome is ambiguous: native message ID missing') as Error & { code: string };
      error.code = 'WHATSAPP_ACCEPTANCE_AMBIGUOUS';
      throw error;
    }
    if (sent.message) this.boundedCacheSet(this.rawMessages, this.quoteKey(targetJid, messageId), sent, WhatsAppSocketClient.MAX_RAW_MESSAGES);
    return { messageId };
  }

  /**
   * Disconnects the socket
   */
  async disconnect(clearSession: boolean = false): Promise<void> {
    // WA-013: fence first - every listener, timer and in-flight start() checkpoint is
    // generation-guarded, so an explicit disconnect wins even while startup is blocked
    // on a network await. Teardown then runs without waiting on the lifecycle mutex:
    // internalStart() re-checks the generation after every await, so it can never
    // assign or rewire a socket after this fence lands.
    this.socketGeneration++;
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('messages.upsert');
        this.sock.ev.removeAllListeners('messages.update');
        this.sock.ev.removeAllListeners('message-receipt.update');
        this.sock.ev.removeAllListeners('messaging-history.set');
        this.sock.end(undefined);
      } catch (err) {
        console.warn('[WhatsApp] Error during socket disconnect:', err);
      }
      this.sock = null;
    }
    if (clearSession) {
      this.clearSession();
    }
    this.isConnecting = false;
    this.setState({
      state: 'disconnected',
      error: undefined,
      qrDataUrl: undefined,
      pairingCode: undefined
    });
  }
}
