import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  jidNormalizedUser,
  type WASocket,
  type proto
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ChatMessage, ConnectionState, PairingState } from '../domain/types';

export interface WhatsAppReactionEvent {
  chatId: string;
  messageId: string;
  emoji: string;
  fromMe: boolean;
}

export interface WhatsAppSocketOptions {
  sessionDir?: string;
  audioTranscriber?: AudioTranscriber;
  onStateChange?: (state: PairingState) => void;
  onMessage?: (message: ChatMessage) => void;
  onReaction?: (reaction: WhatsAppReactionEvent) => void;
}

export class WhatsAppSocketClient {
  private sock: WASocket | null = null;
  private authState: any = null;
  private sessionDir: string;
  private audioTranscriber?: AudioTranscriber;
  private onStateChange?: (state: PairingState) => void;
  private onMessageCallback?: (message: ChatMessage) => void;
  private onReactionCallback?: (reaction: WhatsAppReactionEvent) => void;
  private rawMessages = new Map<string, proto.IWebMessageInfo>();
  private transportJids = new Map<string, string>();
  private currentState: PairingState = {
    state: 'disconnected',
    updatedAt: Date.now()
  };
  private isConnecting = false;
  private reconnectAttempts = 0;
  private pairingCodeRequestedNumber: string | null = null;

  constructor(options: WhatsAppSocketOptions = {}) {
    this.sessionDir = options.sessionDir ?? './data/session';
    this.audioTranscriber = options.audioTranscriber;
    this.onStateChange = options.onStateChange;
    this.onMessageCallback = options.onMessage;
    this.onReactionCallback = options.onReaction;
  }

  getState(): PairingState {
    return { ...this.currentState };
  }

  private setState(updates: Partial<PairingState>) {
    this.currentState = {
      ...this.currentState,
      ...updates,
      updatedAt: Date.now()
    };
    this.onStateChange?.(this.currentState);
  }

  /**
   * Initializes and starts the WhatsApp socket connection
   */
  async start(pairingPhoneNumber?: string): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    if (pairingPhoneNumber) {
      this.pairingCodeRequestedNumber = pairingPhoneNumber.replace(/\D/g, '');
    }

    // Clean up any existing socket before reconnecting to prevent session conflicts
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('messages.upsert');
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }

    this.setState({ state: 'connecting', error: undefined });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      this.authState = state;
      const { version } = await fetchLatestBaileysVersion();

      const logger = pino({ level: 'silent' });

      this.sock = makeWASocket({
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

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !this.pairingCodeRequestedNumber) {
          try {
            const dataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
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

        if (connection === 'open') {
          this.reconnectAttempts = 0;
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
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (statusCode === DisconnectReason.loggedOut) {
            this.setState({
              state: 'disconnected',
              error: 'Session logged out. Please re-pair your WhatsApp device.'
            });
          } else if (shouldReconnect) {
            this.reconnectAttempts++;
            // During QR pairing, 408 (timeout), 500, and 515 are routine cycling events
            const isQRCycle = statusCode === 408 || statusCode === 500 || statusCode === 515;
            const backoff = isQRCycle ? 1500 : Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);

            if (!isQRCycle) {
              this.setState({
                state: 'connecting',
                error: `Connection lost. Reconnecting in ${Math.round(backoff / 1000)}s...`
              });
            } else {
              this.setState({
                state: 'connecting',
                error: undefined
              });
            }

            setTimeout(() => {
              void this.start(this.pairingCodeRequestedNumber || undefined);
            }, backoff);
          } else {
            this.setState({
              state: 'failed',
              error: `Connection terminated: ${lastDisconnect?.error?.message || statusCode}`
            });
          }
        }
      });

      // Handle phone pairing code if requested
      if (this.pairingCodeRequestedNumber && !this.sock.authState.creds.registered) {
        setTimeout(async () => {
          try {
            if (this.sock && this.pairingCodeRequestedNumber) {
              const code = await this.sock.requestPairingCode(this.pairingCodeRequestedNumber);
              this.setState({
                state: 'pairing_code_ready',
                pairingCode: code,
                qrDataUrl: undefined
              });
            }
          } catch (err: any) {
            this.setState({ error: `Failed to request pairing code: ${err.message}` });
          }
        }, 3000);
      }

      // Handle incoming & synced messages (both real-time 'notify' and background 'append')
      this.sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const raw of messages) {
          if (!raw.message) continue;
          // Ignore status broadcasts
          if (raw.key.remoteJid === 'status@broadcast') continue;

          // Cache raw message for replying/quoting
          if (raw.key?.id && raw.message) {
            this.rawMessages.set(raw.key.id, raw);
            if (this.rawMessages.size > 500) {
              const firstKey = this.rawMessages.keys().next().value;
              if (firstKey) this.rawMessages.delete(firstKey);
            }
          }

          try {
            const parsed = await this.parseIncomingMessage(raw);
            if (parsed) {
              this.onMessageCallback?.(parsed);
            }
          } catch (err) {
            // Log message parsing error gracefully
          }
        }
      });

      // Handle continuous history harvest synced from phone
      this.sock.ev.on('messaging-history.set', async ({ messages: historyMessages }) => {
        if (!historyMessages || !Array.isArray(historyMessages)) return;
        for (const raw of historyMessages) {
          if (!raw.message) continue;
          if (raw.key.remoteJid === 'status@broadcast') continue;

          if (raw.key?.id && raw.message) {
            this.rawMessages.set(raw.key.id, raw);
          }

          try {
            const parsed = await this.parseIncomingMessage(raw);
            if (parsed) {
              this.onMessageCallback?.(parsed);
            }
          } catch {}
        }
      });
    } catch (err: any) {
      this.isConnecting = false;
      this.setState({ state: 'failed', error: err.message });
    }
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
            this.transportJids.set(canonical, jid);
            this.transportJids.set(jid, canonical);
            return canonical;
          }
        }
      } catch {}
    }

    this.transportJids.set(normalized, jid);
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
    if (!key.remoteJid) return null;

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
      try {
        if (this.sock) {
          const buffer = (await downloadMediaMessage(raw, 'buffer', {})) as Buffer;
          audioBuffer = buffer;
          if (this.audioTranscriber && buffer && buffer.length > 0) {
            const result = await this.audioTranscriber.transcribeAudio(buffer, message.audioMessage.mimetype || 'audio/ogg; codecs=opus');
            transcription = result.transcription;
            text = transcription ? `🎵 [صوتي: ${transcription}]` : '🎵 [رسالة صوتية]';
          } else {
            text = '🎵 [رسالة صوتية]';
          }
        }
      } catch {
        text = '🎵 [رسالة صوتية]';
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
      status: isFromMe ? 'sent' : 'delivered'
    };
  }

  /**
   * Sends a message to a WhatsApp chat with optional realistic typing delay
   */
  async sendMessage(
    chatId: string,
    text: string,
    options: { replyToMessageId?: string; simulatedDelayMs?: number } = {}
  ): Promise<{ messageId: string }> {
    if (!this.sock) {
      throw new Error('WhatsApp socket is not connected');
    }

    const targetJid = this.transportJids.get(chatId) || chatId;

    // Emit composing presence indicator
    try {
      await this.sock.sendPresenceUpdate('composing', targetJid);
    } catch {}

    if (options.simulatedDelayMs && options.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.simulatedDelayMs));
    }

    try {
      await this.sock.sendPresenceUpdate('paused', targetJid);
    } catch {}

    // Safely resolve quoted message: only pass if raw message is cached with authentic proto.IMessage
    let quoted: proto.IWebMessageInfo | undefined = undefined;
    if (options.replyToMessageId) {
      const cached = this.rawMessages.get(options.replyToMessageId);
      if (cached && cached.message) {
        quoted = cached;
      }
    }

    const sent = await this.sock.sendMessage(targetJid, { text }, quoted ? { quoted } : undefined);

    if (sent?.key?.id && sent.message) {
      this.rawMessages.set(sent.key.id, sent);
    }

    return { messageId: sent?.key?.id || `msg_${Date.now()}` };
  }

  /**
   * Sends a native WhatsApp PTT voice note (recording audio)
   */
  async sendVoiceNote(
    chatId: string,
    audioBuffer: Buffer | Uint8Array,
    options: { replyToMessageId?: string; simulatedRecordingDurationMs?: number } = {}
  ): Promise<{ messageId: string }> {
    if (!this.sock) {
      throw new Error('WhatsApp socket is not connected');
    }

    const targetJid = this.transportJids.get(chatId) || chatId;

    // Emit recording audio presence indicator
    try {
      await this.sock.sendPresenceUpdate('recording', targetJid);
    } catch {}

    const recordingDelay = options.simulatedRecordingDurationMs ?? 2500;
    if (recordingDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, recordingDelay));
    }

    try {
      await this.sock.sendPresenceUpdate('paused', targetJid);
    } catch {}

    // Safely resolve quoted message if available
    let quoted: proto.IWebMessageInfo | undefined = undefined;
    if (options.replyToMessageId) {
      const cached = this.rawMessages.get(options.replyToMessageId);
      if (cached && cached.message) {
        quoted = cached;
      }
    }

    const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    const sent = await this.sock.sendMessage(
      targetJid,
      {
        audio: buf,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      },
      quoted ? { quoted } : undefined
    );

    if (sent?.key?.id && sent.message) {
      this.rawMessages.set(sent.key.id, sent);
    }

    return { messageId: sent?.key?.id || `msg_${Date.now()}` };
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
   * Disconnects the socket
   */
  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.setState({ state: 'disconnected' });
  }
}
