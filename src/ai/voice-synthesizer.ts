export interface VoiceSynthesizerOptions {
  languageCode?: string;
  voiceName?: string;
  ssmlGender?: 'MALE' | 'FEMALE';
  speakingRate?: number;
  /** Server-side test seam; production keeps Google Cloud credentials and global fetch. */
  authProvider?: () => Promise<{ token: string; project: string }>;
  fetcher?: typeof fetch;
}

export class VoiceSynthesizer {
  private languageCode: string;
  private voiceName?: string;
  private ssmlGender: 'MALE' | 'FEMALE';
  private speakingRate: number;
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private project?: string;
  private readonly authProvider?: () => Promise<{ token: string; project: string }>;
  private readonly fetcher: typeof fetch;

  constructor(options: VoiceSynthesizerOptions = {}) {
    this.languageCode = options.languageCode ?? 'ar-XA';
    this.voiceName = options.voiceName ?? 'kore'; // Default to Gemini 3.8 Flash TTS 'kore'
    this.ssmlGender = options.ssmlGender ?? 'MALE';
    this.speakingRate = options.speakingRate ?? 1.0;
    this.authProvider = options.authProvider;
    this.fetcher = options.fetcher ?? fetch;
  }

  setVoiceName(name: string) {
    this.voiceName = name;
  }

  private async getAuth(): Promise<{ token: string; project: string }> {
    if (this.authProvider) return this.authProvider();
    const now = Date.now();
    if (this.accessToken && this.project && now < this.tokenExpiresAt - 60_000) {
      return { token: this.accessToken, project: this.project };
    }

    try {
      if (!this.project) {
        const proc = Bun.spawn(['gcloud', 'config', 'get-value', 'project'], { stdout: 'pipe' });
        this.project = (await new Response(proc.stdout).text()).trim() || 'project-3a53318f-795c-46b9-888';
      }

      const tokenProc = Bun.spawn(['gcloud', 'auth', 'print-access-token'], { stdout: 'pipe' });
      const token = (await new Response(tokenProc.stdout).text()).trim();
      this.accessToken = token;
      this.tokenExpiresAt = Date.now() + 50 * 60 * 1000;

      return { token, project: this.project };
    } catch (err: any) {
      throw new Error(`Failed to retrieve gcloud credentials: ${err.message}`);
    }
  }

  /**
   * Transcodes a WAV buffer into OGG Opus format using ffmpeg for WhatsApp Voice Notes (PTT)
   */
  private async transcodeWavToOpus(wavBuffer: Buffer): Promise<Buffer> {
    try {
      const ffmpeg = Bun.spawn(
        ['ffmpeg', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', '-f', 'ogg', 'pipe:1'],
        {
          stdin: wavBuffer,
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );

      const arrayBuf = await new Response(ffmpeg.stdout).arrayBuffer();
      const exitCode = await ffmpeg.exited;

      if (exitCode === 0 && arrayBuf.byteLength > 0) {
        return Buffer.from(arrayBuf);
      }
    } catch (err: any) {
      console.warn('⚠️ [VoiceSynthesizer] ffmpeg transcoding warning:', err.message);
    }
    return wavBuffer;
  }

  /**
   * Synthesizes audio using Google Gemini 3.8 Flash TTS on the global Agent Platform endpoint
   */
  private async synthesizeWithGeminiTts(
    text: string,
    voiceName: string,
    token: string,
    project: string
  ): Promise<Buffer> {
    // Normalize voice name to standard Gemini voice (kore, puck, fenrir, aoede, charon)
    const normalizedVoice = voiceName.replace(/^ar-XA-Chirp3-HD-/, '').toLowerCase() || 'kore';

    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent`;
    const res = await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-goog-api-client': 'vertex-agent-studio-getcode/1'
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: normalizedVoice
              }
            }
          }
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`gemini-3.8-flash-tts failed (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const audioPart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!audioPart?.inlineData?.data) {
      throw new Error('gemini-3.8-flash-tts returned no audio inlineData');
    }

    const wavBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
    return this.transcodeWavToOpus(wavBuffer);
  }

  /**
   * Synthesizes Arabic text into native WhatsApp-compatible OGG Opus PTT audio buffer
   * Tries Gemini 3.8 Flash TTS first, and falls back gracefully to Chirp 3 HD if needed.
   */
  async synthesizeVoice(text: string, voiceNameOverride?: string): Promise<Buffer> {
    const { token, project } = await this.getAuth();

    // Clean text of emojis or markdown markers that shouldn't be pronounced literally
    const cleanedText = text
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[*_~`#]/g, '')
      .trim();

    if (!cleanedText) {
      throw new Error('No synthesizable text after cleaning');
    }

    const requestedVoice = voiceNameOverride || this.voiceName || 'kore';

    // 1. Primary: Try Gemini 3.8 Flash TTS
    try {
      console.log(`🎙️ [VoiceSynthesizer] Synthesizing via gemini-3.8-flash-tts (voice: ${requestedVoice})...`);
      return await this.synthesizeWithGeminiTts(cleanedText, requestedVoice, token, project);
    } catch (err: any) {
      console.warn(`⚠️ [VoiceSynthesizer] gemini-3.8-flash-tts attempt failed (${err.message}). Falling back to Chirp3-HD...`);
    }

    // 2. Fallback: Google Cloud Chirp 3 HD
    const chirpVoice = requestedVoice.startsWith('ar-XA') ? requestedVoice : `ar-XA-Chirp3-HD-Fenrir`;
    const requestBody: any = {
      input: { text: cleanedText },
      voice: {
        languageCode: this.languageCode,
        name: chirpVoice,
        ssmlGender: this.ssmlGender
      },
      audioConfig: {
        audioEncoding: 'OGG_OPUS',
        speakingRate: this.speakingRate
      }
    };

    const response = await this.fetcher('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Goog-User-Project': project,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Cloud Text-to-Speech fallback failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { audioContent: string };
    if (!data.audioContent) {
      throw new Error('Google Cloud Text-to-Speech returned empty audioContent');
    }

    return Buffer.from(data.audioContent, 'base64');
  }
}
