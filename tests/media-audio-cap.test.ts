import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { WhatsAppSocketClient } from '../src/transport/whatsapp-socket';

class FakeSocket {
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  user = { id: '201000000000:5@s.whatsapp.net', name: 'Test' };
  authState: any;
  ev: any;
  constructor(creds: any) {
    this.authState = { creds };
    this.ev = {
      on: (e: string, cb: (...args: any[]) => void) => {
        const list = this.handlers.get(e) ?? [];
        list.push(cb);
        this.handlers.set(e, list);
      },
      removeAllListeners: (e: string) => { this.handlers.delete(e); }
    };
  }
  emit(event: string, payload: any) {
    for (const cb of this.handlers.get(event) ?? []) void cb(payload);
  }
  end() {}
}

const registeredCreds = { registered: true, me: { id: '201000000000:5@s.whatsapp.net' } };

function bigStream(totalBytes: number, chunk = 1024 * 1024): Readable {
  let sentBytes = 0;
  return new Readable({
    read() {
      if (sentBytes >= totalBytes) return this.push(null);
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
    const received: any[] = [];
    const client = new WhatsAppSocketClient({
      sessionDir,
      socketFactory: () => {
        const sock = new FakeSocket(registeredCreds);
        sockets.push(sock);
        return sock as any;
      },
      authStateFactory: async () => ({ state: { creds: registeredCreds }, saveCreds: async () => {} }),
      versionProvider: async () => ({ version: [2, 3000, 0] as any }),
      reconnectDelays: { baseMs: 5, maxMs: 20 },
      onMessage: (m) => received.push(m),
      // WA-017 test seam: downloader returns a stream LARGER than the declared fileLength
      mediaDownloader: async () => bigStream(64 * 1024 * 1024)
    });
    try {
      await client.start();
      const sock = sockets[0];
      await sock.emit('connection.update', { connection: 'open' });

      sock.emit('messages.upsert', {
        type: 'notify',
        messages: [{
          key: { id: 'audio-1', remoteJid: '201000000001@s.whatsapp.net', fromMe: false },
          message: {
            audioMessage: {
              mimetype: 'audio/ogg; codecs=opus',
              fileLength: '1024', // declared 1KB, actual 64MB
              seconds: 1
            }
          },
          messageTimestamp: 1_700_000_000
        }]
      });
      await new Promise((r) => setTimeout(r, 50));

      // message still arrives, but without an unbounded media buffer
      expect(received.length).toBe(1);
      const buf = received[0].mediaBuffer;
      expect(buf === undefined || buf.length <= 16 * 1024 * 1024 + 1024 * 1024).toBe(true);
    } finally {
      await client.disconnect();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
