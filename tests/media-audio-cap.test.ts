import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import type { ChatMessage } from '../src/domain/types';
import { WhatsAppSocketClient, type WhatsAppSocketPort } from '../src/transport/whatsapp-socket';
import { makeEventBuffer } from '@whiskeysockets/baileys';
import pino from 'pino';

class FakeSocket implements WhatsAppSocketPort {
  user = { id: '201000000000:5@s.whatsapp.net', name: 'Test' };
  readonly ev = makeEventBuffer(pino({ level: 'silent' }));
  readonly authState: WhatsAppSocketPort['authState'];

  constructor(creds: WhatsAppSocketPort['authState']['creds']) {
    this.authState = { creds };
  }

  async requestPairingCode(): Promise<string> { throw new Error('Unexpected pairing request'); }
  async sendPresenceUpdate(): Promise<void> { throw new Error('Unexpected presence update'); }
  async sendMessage(): Promise<never> { throw new Error('Unexpected message send'); }
  async end(): Promise<void> { this.ev.removeAllListeners('messages.upsert'); }
}

const registeredCreds = { registered: true, me: { id: '201000000000:5@s.whatsapp.net' } };

function bigStream(totalBytes: number, chunk = 1024 * 1024): Readable {
  let sentBytes = 0;
  return new Readable({
    read() {
      if (sentBytes >= totalBytes) {
        this.push(null);
        return;
      }
      const n = Math.min(chunk, totalBytes - sentBytes);
      sentBytes += n;
      this.push(Buffer.alloc(n, 7));
    }
  });
}

describe('WA-017 audio download enforces the byte cap during transfer', () => {
  it('a false declared fileLength cannot cause an unbounded download', async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'wa-media-'));
    const sockets: FakeSocket[] = [];
    const received: ChatMessage[] = [];
    const client = new WhatsAppSocketClient({
      sessionDir,
      socketFactory: () => {
        const sock = new FakeSocket(registeredCreds);
        sockets.push(sock);
        return sock;
      },
      authStateFactory: async () => ({ state: { creds: registeredCreds }, saveCreds: async () => {} }),
      versionProvider: async () => ({ version: [2, 3000, 0] }),
      reconnectDelays: { baseMs: 5, maxMs: 20 },
      onMessage: (m) => received.push(m),
      // WA-017 test seam: downloader returns a stream LARGER than the declared fileLength
      mediaDownloader: async () => bigStream(64 * 1024 * 1024)
    });
    try {
      await client.start();
      const sock = sockets[0];
      if (!sock) throw new Error('Expected socket');
      sock.ev.emit('connection.update', { connection: 'open' });

      sock.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { id: 'audio-1', remoteJid: '201000000001@s.whatsapp.net', fromMe: false },
          message: {
            audioMessage: {
              mimetype: 'audio/ogg; codecs=opus',
              fileLength: 1024, // declared 1KB, actual 64MB
              seconds: 1
            }
          },
          messageTimestamp: 1_700_000_000
        }]
      });
      await new Promise((_resolve) => setTimeout(_resolve, 50));

      // message still arrives, but without an unbounded media buffer
      expect(received.length).toBe(1);
      const buf = received[0]?.mediaBuffer;
      expect(buf === undefined || buf.length <= 16 * 1024 * 1024 + 1024 * 1024).toBe(true);
    } finally {
      await client.disconnect();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
