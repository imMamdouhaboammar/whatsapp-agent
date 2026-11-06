import { describe, expect, it } from 'bun:test';
import { MessageSplitter } from '../src/domain/message-splitter';

describe('MessageSplitter', () => {
  const splitter = new MessageSplitter();

  it('preserves short replies as a single bubble', () => {
    const text = 'أهلاً يا صديقي، تمام الحمد لله!';
    const bubbles = splitter.split(text);
    expect(bubbles.length).toBe(1);
    expect(bubbles[0]).toBe(text);
  });

  it('splits multi-thought long messages into natural conversational bubbles', () => {
    const text = `أهلاً بحضرتك يا أستاذ أحمد، تشرفنا جداً!

بخصوص باقات الذكاء الاصطناعي للأتمتة، عندنا باقة مخصصة للشركات الصغيرة وباقة متقدمة للمؤسسات.

تحب نرتب مكالمة توضيحية سريعة بكرة نوضحلك التفاصيل العملية؟`;

    const bubbles = splitter.split(text);
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    expect(bubbles[0]).toContain('أهلاً بحضرتك يا أستاذ أحمد');
    expect(bubbles.some((b) => b.includes('بخصوص باقات'))).toBe(true);
  });

  it('calculates human typing delays bounded within realistic limits', () => {
    const delay1 = splitter.calculateDelay('صباح الفل', true);
    const delay2 = splitter.calculateDelay('بخصوص الطلب هجهزهولك وأبعتهولك في خلال ساعة إن شاء الله.', false);

    expect(delay1).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeLessThanOrEqual(4000);
    expect(delay2).toBeGreaterThanOrEqual(1000);
    expect(delay2).toBeLessThanOrEqual(4000);
  });
});
