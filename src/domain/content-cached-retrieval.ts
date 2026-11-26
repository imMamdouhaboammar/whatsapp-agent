import { createHash } from 'node:crypto';
import type { ChatMessage } from './types';

export const CCR_THRESHOLD_CHARS = 600;
export const CCR_PREVIEW_CHARS = 120;
export const CCR_MARKER = '[acp-stored:';

export interface CcrCrushResult {
  text: string;
  transcription?: string;
  wasCrushed: boolean;
  originalLength: number;
  ref?: string;
}

/**
 * Creates a deterministic, collision-resistant reference identifier for CCR content.
 */
export function makeCcrRef(content: string, type: string): string {
  const hash = createHash('sha256').update(`${type}:${content}`).digest('hex').slice(0, 12);
  return `ccr:${hash}`;
}

/**
 * Checks if a string is an ACP content-cached placeholder.
 */
export function isCcrPlaceholder(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.startsWith(CCR_MARKER);
}

/**
 * Evaluates a ChatMessage and returns a cache-friendly prompt representation.
 * If the transcription or text is oversized, crushes it into an ACP placeholder
 * while preserving the original message in storage.
 */
export function crushMessageForPrompt(message: ChatMessage): CcrCrushResult {
  const rawText = message.text || '';
  const rawTranscription = message.transcription || '';

  // Check transcription first
  if (rawTranscription && rawTranscription.length > CCR_THRESHOLD_CHARS) {
    const ref = makeCcrRef(rawTranscription, 'audio');
    const preview = rawTranscription.slice(0, CCR_PREVIEW_CHARS).replace(/\s+/g, ' ').trim();
    const placeholder = `${CCR_MARKER} ref="${ref}" type="audio_transcription" size=${rawTranscription.length} chars | preview="${preview}..." ]`;
    return {
      text: rawText,
      transcription: placeholder,
      wasCrushed: true,
      originalLength: rawTranscription.length,
      ref
    };
  }

  // Check long text payload (e.g. document paste, large raw message)
  if (rawText.length > CCR_THRESHOLD_CHARS) {
    const ref = makeCcrRef(rawText, message.type || 'text');
    const preview = rawText.slice(0, CCR_PREVIEW_CHARS).replace(/\s+/g, ' ').trim();
    const placeholder = `${CCR_MARKER} ref="${ref}" type="${message.type}" size=${rawText.length} chars | preview="${preview}..." ]`;
    return {
      text: placeholder,
      transcription: rawTranscription,
      wasCrushed: true,
      originalLength: rawText.length,
      ref
    };
  }

  return {
    text: rawText,
    transcription: rawTranscription,
    wasCrushed: false,
    originalLength: rawText.length + rawTranscription.length
  };
}
