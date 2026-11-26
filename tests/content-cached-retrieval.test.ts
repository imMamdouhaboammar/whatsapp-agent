import { describe, expect, test } from 'bun:test';
import {
  crushMessageForPrompt,
  isCcrPlaceholder,
  makeCcrRef,
  CCR_THRESHOLD_CHARS,
  CCR_MARKER
} from '../src/domain/content-cached-retrieval';
import type { ChatMessage } from '../src/domain/types';

describe('Content-Cached Retrieval (CCR) for oversized payloads', () => {
  test('generates deterministic ref hashes based on content and type', () => {
    const ref1 = makeCcrRef('some audio transcription content', 'audio');
    const ref2 = makeCcrRef('some audio transcription content', 'audio');
    const ref3 = makeCcrRef('different content', 'audio');

    expect(ref1).toBe(ref2);
    expect(ref1).toStartWith('ccr:');
    expect(ref1).not.toBe(ref3);
  });

  test('detects CCR placeholders accurately', () => {
    expect(isCcrPlaceholder(null)).toBe(false);
    expect(isCcrPlaceholder('')).toBe(false);
    expect(isCcrPlaceholder('عادي كلام عادي')).toBe(false);
    expect(isCcrPlaceholder(`${CCR_MARKER} ref="ccr:123" ]`)).toBe(true);
  });

  test('crushes oversized audio transcriptions into compact CCR placeholder for prompts', () => {
    const longTranscription = 'أهلاً يا فندم أنا بكلمك بخصوص العرض اللي شفته على الصفحة ومحتاج تفاصيل أكتر عن طريقة السداد ومواعيد التسليم '.repeat(10);
    expect(longTranscription.length).toBeGreaterThan(CCR_THRESHOLD_CHARS);

    const message: ChatMessage = {
      id: 'audio-msg-1',
      chatId: 'user@s.whatsapp.net',
      sender: 'user',
      text: '',
      transcription: longTranscription,
      timestamp: Date.now(),
      isFromMe: false,
      type: 'audio'
    };

    const crushed = crushMessageForPrompt(message);
    expect(crushed.wasCrushed).toBe(true);
    expect(crushed.transcription).toBeDefined();
    expect(crushed.transcription).toStartWith(CCR_MARKER);
    expect(crushed.transcription).toContain('type="audio_transcription"');
    expect(crushed.transcription).toContain(`size=${longTranscription.length}`);
    expect(crushed.transcription?.length).toBeLessThan(longTranscription.length);
    expect(crushed.ref).toStartWith('ccr:');
  });

  test('crushes oversized text message into compact CCR placeholder', () => {
    const longText = 'تفاصيل العقد والبنود الكاملة المرفقة في الاتفاقية تنص على الآتي: '.repeat(15);
    expect(longText.length).toBeGreaterThan(CCR_THRESHOLD_CHARS);

    const message: ChatMessage = {
      id: 'doc-msg-1',
      chatId: 'user@s.whatsapp.net',
      sender: 'user',
      text: longText,
      timestamp: Date.now(),
      isFromMe: false,
      type: 'document'
    };

    const crushed = crushMessageForPrompt(message);
    expect(crushed.wasCrushed).toBe(true);
    expect(crushed.text).toStartWith(CCR_MARKER);
    expect(crushed.text).toContain('type="document"');
    expect(crushed.text.length).toBeLessThan(longText.length);
  });

  test('leaves normal short messages intact without placeholder transformation', () => {
    const shortText = 'تمام، أنا موافق على العرض وهحول المبلغ دلوقتي';
    const message: ChatMessage = {
      id: 'short-msg-1',
      chatId: 'user@s.whatsapp.net',
      sender: 'user',
      text: shortText,
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };

    const result = crushMessageForPrompt(message);
    expect(result.wasCrushed).toBe(false);
    expect(result.text).toBe(shortText);
    expect(result.ref).toBeUndefined();
  });
});
