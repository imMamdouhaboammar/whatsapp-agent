import { describe, expect, it } from 'bun:test';
import { MessageSplitter } from '../src/domain/message-splitter';
import { readFileSync } from 'node:fs';

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

  it('exposes the typing delay call used by the WhatsApp send path', () => {
    const handler = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(handler).toContain('messageSplitter.calculateDelay(bubbleText, isFirstBubble)');
  });

  it('never silently drops content when replying in more than three paragraphs', () => {
    const text=['الجزء الأول طويل ويصف الطلب بشكل واضح','المعلومات الثانية متاحة في السجل','التفاصيل الثالثة مهمة','تفاصيل رابعة لا يجب فقدانها'].join('\n\n');
    const bubbles=splitter.split(text);
    expect(bubbles.length).toBeLessThanOrEqual(3);
    for(const paragraph of text.split('\n\n'))expect(bubbles.join('\n')).toContain(paragraph);
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
