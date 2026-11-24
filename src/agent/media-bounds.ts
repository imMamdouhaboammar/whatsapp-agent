/**
 * WA-017: media resource boundaries. Streaming byte caps enforced DURING transfer (never
 * trust declared sizes), image MIME sniffing from magic bytes, and a bounded concurrency
 * budget shared by every media pipeline (audio download, sticker conversion, document
 * extraction) so concurrent requests cannot exhaust RAM/CPU.
 */

import { Readable } from 'node:stream';

export const MEDIA_LIMITS = {
  /** Audio attachments: hard cap enforced while streaming, independent of declared fileLength. */
  maxAudioBytes: 16 * 1024 * 1024,
  /** Decoded sticker input image cap. */
  maxStickerDecodedBytes: 10 * 1024 * 1024,
  /** Raw sticker request body cap (JSON + base64 overhead), checked before JSON parsing. */
  maxStickerRequestBytes: 16 * 1024 * 1024,
  /** cwebp subprocess deadline; killed and cleaned up past it. */
  stickerSubprocessTimeoutMs: 20_000,
  /** Global concurrent media operations across all pipelines. */
  maxConcurrentMedia: 4,
  /** How long a media operation may wait for a concurrency slot. */
  mediaWaitMs: 30_000,
  /** Untrusted webhook bodies: rejected before full buffering past this cap. */
  maxWebhookBodyBytes: 1_048_576
} as const;

export class MediaTooLargeError extends Error {
  readonly capBytes: number;
  constructor(capBytes: number) {
    super(`Media payload too large: exceeds the ${capBytes} byte cap`);
    this.name = 'MediaTooLargeError';
    this.capBytes = capBytes;
  }
}

/**
 * Reads a stream into a Buffer, aborting the moment the cap is crossed. The buffer never
 * holds more than capBytes, so a false declared size cannot cause unbounded allocation.
 */
export async function readStreamWithCap(stream: Readable, capBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > capBytes) {
      stream.destroy();
      throw new MediaTooLargeError(capBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * WA-022: reads a web Request body with a hard byte cap during streaming. Combined with
 * the Content-Length pre-check, an untrusted oversized body is rejected before full
 * buffering whether it arrives with a declared length or chunked.
 */
export async function readRequestBodyTextWithCap(req: Request, capBytes: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > capBytes) {
        throw new MediaTooLargeError(capBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    if (total > capBytes) {
      try { await reader.cancel(); } catch { /* best effort */ }
    }
    reader.releaseLock();
  }
}

/** Magic-byte image sniffing; never trust a declared mimetype or file extension. */
export function sniffImageMime(buf: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && buf.subarray(0, 6).toString('latin1') === 'GIF89a') return 'gif';
  if (buf.length >= 6 && buf.subarray(0, 6).toString('latin1') === 'GIF87a') return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export interface MediaLimiter {
  run<T>(fn: () => Promise<T>, opts?: { waitMs?: number }): Promise<T>;
  activeCount(): number;
  queuedCount(): number;
}

/**
 * Bounded FIFO concurrency for media work. Waiters past their wait deadline are rejected
 * instead of queueing unboundedly.
 */
export function createMediaLimiter(opts: { maxConcurrent?: number } = {}): MediaLimiter {
  const max = Math.max(1, opts.maxConcurrent ?? MEDIA_LIMITS.maxConcurrentMedia);
  let active = 0;
  const queue: Array<{ wake: () => void; timer: ReturnType<typeof setTimeout> }> = [];

  const acquire = async (waitMs: number): Promise<void> => {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const entry = {
        wake: () => {
          clearTimeout(entry.timer);
          resolve();
        },
        timer: setTimeout(() => {
          const i = queue.findIndex((e) => e.wake === entry.wake);
          if (i >= 0) queue.splice(i, 1);
          reject(new Error(`Media pipeline at capacity (${max}); wait exceeded the ${waitMs}ms deadline`));
        }, waitMs)
      };
      queue.push(entry);
    });
    active++;
  };

  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next.wake();
  };

  return {
    run: async (fn, o) => {
      await acquire(o?.waitMs ?? MEDIA_LIMITS.mediaWaitMs);
      try {
        return await fn();
      } finally {
        release();
      }
    },
    activeCount: () => active,
    queuedCount: () => queue.length
  };
}

/** Process-wide shared media budget: audio downloads, sticker conversion, doc extraction. */
export const sharedMediaLimiter = createMediaLimiter();
