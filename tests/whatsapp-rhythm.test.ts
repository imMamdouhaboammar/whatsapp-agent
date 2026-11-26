import { describe, expect, it } from 'bun:test';
import {
  calculateCognitiveReadingDelay,
  evaluateSpontaneousReaction,
  calculateBubbleTypingDelay,
} from '../src/domain/whatsapp-rhythm';

describe('WhatsApp Empirical Rhythm & Spontaneous Reaction Engine', () => {
  it('calculates cognitive reading delay within human psychological boundaries (600 - 3000ms)', () => {
    const delayShort = calculateCognitiveReadingDelay('تمام');
    const delayMedium = calculateCognitiveReadingDelay('أنا راجع من الشغل ومحتاج نتكلم بخصوص الشحنة اللي بعتناها الأسبوع اللي فات');
    const delayBurst = calculateCognitiveReadingDelay('رسالة سريعة', 3);

    expect(delayShort).toBeGreaterThanOrEqual(600);
    expect(delayShort).toBeLessThanOrEqual(3000);

    expect(delayMedium).toBeGreaterThanOrEqual(900);
    expect(delayMedium).toBeLessThanOrEqual(3000);

    expect(delayBurst).toBeGreaterThanOrEqual(delayShort);
  });

  it('triggers spontaneous humor reaction for jokes and laughter', () => {
    const res = evaluateSpontaneousReaction({ text: 'هههههههه مسخرة بجد مش قادر 😂' });
    expect(res).not.toBeNull();
    expect(res?.emoji).toBe('😂');
    expect(res?.shouldReact).toBe(true);
  });

  it('triggers spontaneous shock reaction for big surprises', () => {
    const res = evaluateSpontaneousReaction({ text: 'مش هتصدق يا نهار ابيض حصلت معجزة' });
    expect(res).not.toBeNull();
    expect(res?.emoji).toBe('😮');
  });

  it('triggers spontaneous affection reaction for warm camaraderie', () => {
    const res = evaluateSpontaneousReaction({ text: 'تسلملي يا غالي ربنا يخليك ليا يا صاحبي' });
    expect(res).not.toBeNull();
    expect(res?.emoji).toBe('❤️');
  });

  it('triggers spontaneous empathy/prayer reaction for grief or hardship', () => {
    const res = evaluateSpontaneousReaction({ text: 'أنا تعبان اوي وفي المستشفى ادعيلي بالله عليك' });
    expect(res).not.toBeNull();
    expect(res?.emoji).toBe('🙏');
  });

  it('triggers spontaneous solid agreement reaction for confirmation', () => {
    const res = evaluateSpontaneousReaction({ text: 'خلصانة اشطا عليك يا رجولة سرك في بير' });
    expect(res).not.toBeNull();
    expect(res?.emoji).toBe('👍');
  });

  it('returns null for generic messages with no emotional reaction trigger', () => {
    const res = evaluateSpontaneousReaction({ text: 'الساعة دلوقتي 4 العصر والجو عادي' });
    expect(res).toBeNull();
  });

  it('calculates realistic bubble typing latency', () => {
    const delay = calculateBubbleTypingDelay('معلش يا صاحبي كل حاجة هتتظبط');
    expect(delay).toBeGreaterThanOrEqual(650);
    expect(delay).toBeLessThanOrEqual(3200);
  });
});
