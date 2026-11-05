import type { GeminiClient } from './gemini-client';

export class AudioTranscriber {
  constructor(private gemini: GeminiClient) {}

  /**
   * Transcribes a WhatsApp audio message buffer using Gemini multimodal inference
   */
  async transcribeAudio(audioBuffer: Buffer | Uint8Array, mimeType = 'audio/ogg; codecs=opus'): Promise<{
    transcription: string;
    summary?: string;
    languageDetected?: string;
  }> {
    const base64Audio = Buffer.isBuffer(audioBuffer)
      ? audioBuffer.toString('base64')
      : Buffer.from(audioBuffer).toString('base64');

    const prompt = `أنت مساعد خبير وموديرتور ذكي. مهمتك هي تفريغ هذا المقطع الصوتي الوارد من تطبيق واتساب بدقة شديدة باللغة العربية (سواء كانت لهجة عامية مصرية أو خليجية أو فصحى أو إنجليزية).
قم بإرجاع النتيجة بتنسيق JSON التالي فقط بدون أي علامات ماركداون إضافية:
{
  "transcription": "النص الحرفي الدقيق لما قيل في الرسالة الصوتية",
  "summary": "ملخص سريع للنقطة الأساسية في جملة واحدة",
  "language": "اللهجة أو اللغة المكتشفة"
}`;

    const response = await this.gemini.generateContent([
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio
            }
          },
          { text: prompt }
        ]
      }
    ], {
      model: 'gemini-2.5-flash',
      responseMimeType: 'application/json'
    });

    try {
      const parsed = JSON.parse(response.text);
      return {
        transcription: parsed.transcription || response.text,
        summary: parsed.summary,
        languageDetected: parsed.language
      };
    } catch {
      return { transcription: response.text.trim() };
    }
  }
}
