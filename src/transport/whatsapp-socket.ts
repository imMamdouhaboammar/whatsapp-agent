import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  type WASocket,
  type proto
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import type { AudioTranscriber } from '../ai/audio-transcriber';
import type { ChatMessage, ConnectionState, PairingState } from '../domain/types';

export interface WhatsAppSocketOptions {
  sessionDir?: string;
  audioTranscriber?: AudioTranscriber;
  onStateChange?: (state: PairingState) => void;
  onMessage?: (message: ChatMessage) => void;
}

export class WhatsAppSocketClient {
  private sock: WASocket | null = null;
  private sessionDir: string;
  private audioTranscriber?: AudioTranscriber;
  private onStateChange?: (state: PairingState) => void;
  private onMessageCallback?: (message: ChatMessage) => void;
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

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const raw of messages) {
          if (!raw.message) continue;
          // Ignore status broadcasts
          if (raw.key.remoteJid === 'status@broadcast') continue;

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
    } catch (err: any) {
      this.isConnecting = false;
      this.setState({ state: 'failed', error: err.message });
    }
  }

  /**
   * Parses raw Baileys proto.IWebMessageInfo into clean ChatMessage
   */
  private async parseIncomingMessage(raw: proto.IWebMessageInfo): Promise<ChatMessage | null> {
    const key = raw.key;
    const chatId = key.remoteJid;
    if (!chatId) return null;

    const message = raw.message;
    if (!message) return null;

    const isFromMe = Boolean(key.fromMe);
    const sender = isFromMe
      ? this.sock?.user?.id || 'me'
      : (key.participant || chatId);

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
      text = `📄 [ملف: ${message.documentMessage.fileName || 'مستند'}]`;
    } else {
      type = 'other';
      text = '[رسالة]';
    }

    const replyToId = message.extendedTextMessage?.contextInfo?.stanzaId;

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

    // Emit composing presence indicator
    try {
      await this.sock.sendPresenceUpdate('composing', chatId);
    } catch {}

    if (options.simulatedDelayMs && options.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.simulatedDelayMs));
    }

    try {
      await this.sock.sendPresenceUpdate('paused', chatId);
    } catch {}

    const quoted = options.replyToMessageId
      ? ({ key: { remoteJid: chatId, id: options.replyToMessageId } } as any)
      : undefined;

    const sent = await this.sock.sendMessage(chatId, { text }, { quoted });
    return { messageId: sent?.key.id || `msg_${Date.now()}` };
  }

  /**
   * Reacts to a message with an emoji (e.g. 👍, ❤️, 🙏)
   */
  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp socket is not connected');
    await this.sock.sendMessage(chatId, {
      react: {
        text: emoji,
        key: {
          remoteJid: chatId,
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
