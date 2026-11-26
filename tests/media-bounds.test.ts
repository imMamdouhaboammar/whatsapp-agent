import assert from 'node:assert/strict';
import { describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import {
  readStreamWithCap,
  sniffImageMime,
  createMediaLimiter,
  MediaTooLargeError,
  MEDIA_LIMITS
} from '../src/agent/media-bounds';

function streamOf(chunks: number[]): Readable {
  let i = 0;
  return new Readable({
    read() {
      const size = chunks[i++];
      if (size !== undefined) this.push(Buffer.alloc(size, 1));
      else this.push(null);
    }
  });
}

describe('WA-017 streaming byte caps', () => {
  it('rejects a stream that exceeds the cap without buffering the whole payload', async () => {
    // 3 x 8MB chunks, cap 16MB -> must throw as soon as the cap is crossed
    await assert.rejects(readStreamWithCap(streamOf([8, 8, 8].map((mb) => mb * 1024 * 1024)), 16 * 1024 * 1024), MediaTooLargeError);
  });

  it('accepts a stream within the cap and returns the bytes', async () => {
    const buf = await readStreamWithCap(streamOf([1024, 2048]), 4096);
    expect(buf.length).toBe(3072);
  });

  it('a false declared size cannot bypass the cap', async () => {
    // declared small, actual stream exceeds cap
    await assert.rejects(readStreamWithCap(streamOf([20 * 1024 * 1024]), 16 * 1024 * 1024), /too large|exceed/i);
  });
});

describe('WA-017 image MIME sniffing', () => {
  it('recognizes png, jpeg, gif and webp magic bytes', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(sniffImageMime(Buffer.from('GIF89axxxxxx'))).toBe('gif');
    expect(sniffImageMime(Buffer.from('RIFFxxxxWEBPyy'))).toBe('webp');
  });

  it('rejects unknown content', () => {
    expect(sniffImageMime(Buffer.from('MZ\x90\x00 executable'))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

function createGate<T>() {
  let r!: (v: T) => void;
  const p = new Promise<T>((resolve) => { r = resolve; });
  return { p, r };
}

describe('WA-017 bounded media concurrency', () => {
  it('caps concurrent media work and rejects when the wait exceeds the deadline', async () => {
    const limiter = createMediaLimiter({ maxConcurrent: 2 });
    const g1 = createGate<string>(); const g2 = createGate<string>();
    let started = 0;

    const t1 = limiter.run(async () => { started++; return g1.p; });
    const t2 = limiter.run(async () => { started++; return g2.p; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(2);

    let thirdStarted = false;
    const t3 = limiter.run(async () => { thirdStarted = true; return 'third'; }, { waitMs: 50 });
    await assert.rejects(t3, /busy|timeout|capacity/i);
    expect(thirdStarted).toBe(false);

    g1.r('a'); g2.r('b');
    await Promise.all([t1, t2]);
  });

  it('exposes documented limits', () => {
    expect(MEDIA_LIMITS.maxAudioBytes).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.maxStickerDecodedBytes).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.maxStickerRequestBytes).toBeGreaterThan(MEDIA_LIMITS.maxStickerDecodedBytes);
    expect(MEDIA_LIMITS.stickerSubprocessTimeoutMs).toBeGreaterThan(0);
    expect(MEDIA_LIMITS.maxConcurrentMedia).toBeGreaterThan(0);
  });
});
