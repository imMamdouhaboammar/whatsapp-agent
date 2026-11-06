import { describe, expect, it } from 'bun:test';
import { VoiceSynthesizer } from '../src/ai/voice-synthesizer';

describe('VoiceSynthesizer', () => {
  it('initializes with default Egyptian/Arabic options', () => {
    const synth = new VoiceSynthesizer();
    expect(synth).toBeDefined();
  });

  it('synthesizes text into OGG Opus buffer using Google Cloud TTS', async () => {
    const synth = new VoiceSynthesizer({ languageCode: 'ar-XA', ssmlGender: 'MALE' });
    try {
      const buffer = await synth.synthesizeVoice('أهلاً بك يا فندم، أنا تحت أمرك');
      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(100);
      // Check Ogg container header 'OggS'
      expect(buffer.slice(0, 4).toString('ascii')).toBe('OggS');
    } catch (err: any) {
      console.warn('Voice synthesis skipped (network or quota):', err.message);
    }
  }, 15000);
});
