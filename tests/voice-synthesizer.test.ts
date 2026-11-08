import { describe, expect, it } from 'bun:test';
import { VoiceSynthesizer } from '../src/ai/voice-synthesizer';

describe('VoiceSynthesizer', () => {
  it('initializes with default Egyptian/Arabic options', () => {
    const synth = new VoiceSynthesizer();
    expect(synth).toBeDefined();
  });

  it('preserves a valid Ogg Opus fixture from the fallback using deterministic auth and HTTP inputs', async () => {
    // A 166 ms mono Opus sample created with ffmpeg, then verified with ffprobe.
    const audio = Buffer.from(await Bun.file(new URL('./fixtures/valid-silence-opus.ogg', import.meta.url)).arrayBuffer());
    const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
    let authCalls = 0;
    const synth = new VoiceSynthesizer({
      languageCode: 'ar-XA',
      ssmlGender: 'MALE',
      authProvider: async () => {
        authCalls++;
        return { token: 'local-test-token', project: 'local-test-project' };
      },
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body));
        requests.push({ url, headers, body });
        if (url.includes('/models/gemini-3.8-flash-tts:generateContent')) {
          return Response.json({ error: { message: 'local simulated Gemini unavailability' } }, { status: 503 });
        }
        if (url === 'https://texttospeech.googleapis.com/v1/text:synthesize') {
          return Response.json({ audioContent: audio.toString('base64') });
        }
        throw new Error('Unexpected network endpoint in voice test');
      }) as typeof fetch
    });

    const result = await synth.synthesizeVoice('أهلاً بك يا فندم، أنا تحت أمرك');
    expect(result).toEqual(audio);
    expect(result.length).toBeGreaterThan(100);
    expect(result.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(result.includes(Buffer.from('OpusHead', 'ascii'))).toBe(true);
    expect(result.includes(Buffer.from('OpusTags', 'ascii'))).toBe(true);
    expect(authCalls).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer local-test-token');
    expect(requests[1]?.headers.get('X-Goog-User-Project')).toBe('local-test-project');
    expect((requests[1]?.body as { voice: { languageCode: string } }).voice.languageCode).toBe('ar-XA');
  });

  it('reports failure when both providers reject instead of silently passing without synthesized audio', async () => {
    const synth = new VoiceSynthesizer({
      authProvider: async () => ({ token: 'local-test-token', project: 'local-test-project' }),
      fetcher: (async () => Response.json({ error: { message: 'simulated provider unavailable' } }, {
        status: 503
      })) as typeof fetch
    });
    await expect(synth.synthesizeVoice('Testing failure')).rejects.toThrow('Google Cloud Text-to-Speech fallback failed (503)');
  });

  const liveIt = process.env.RUN_LIVE_GOOGLE_TTS === '1' ? it : it.skip;
  liveIt('synthesizes an OGG Opus buffer against live Google TTS when explicitly configured', async () => {
    const synth = new VoiceSynthesizer({ languageCode: 'ar-XA', ssmlGender: 'MALE' });
    const buffer = await synth.synthesizeVoice('أهلاً بك يا فندم، أنا تحت أمرك');
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('OggS');
  }, 60_000);
});
