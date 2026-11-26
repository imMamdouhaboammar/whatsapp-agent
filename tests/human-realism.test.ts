import { describe, expect, it } from 'bun:test';
import { compileHumanRealismLayer } from '../src/ai/human-realism';

describe('Human Realism & Conversational Voice Craft Layer', () => {
  it('compiles comprehensive human realism instructions with name and rules', () => {
    const prompt = compileHumanRealismLayer({ personaName: 'ممدوح' });

    expect(prompt).toContain('Human Realism & Voice Craft Layer');
    expect(prompt).toContain('ممدوح');
    expect(prompt).toContain('Silent Micro-Read');
    expect(prompt).toContain('Theory of Mind & Social Subtext');
    expect(prompt).toContain('Anti-Sycophancy & Emotional Sovereignty');
    expect(prompt).toContain('Anti-ChatGPT Arabic Slop');
    expect(prompt).toContain('WhatsApp Empirical Texting Rhythm');
    expect(prompt).toContain('Drift Guard');
  });

  it('enforces theory of mind subtext rules for venting, banter, pings, and reciprocal flow', () => {
    const prompt = compileHumanRealismLayer();

    // Venting solidarity
    expect(prompt).toContain('الفضفضة والشكوى (Venting)');
    expect(prompt).toContain('معلش يا عم فداك');
    expect(prompt).toContain('كبر مخك');

    // Banter & Wit
    expect(prompt).toContain('الألش والهزار (Banter & Wit)');
    expect(prompt).toContain('😂😂');

    // Reciprocal flow
    expect(prompt).toContain('انسيابية الأخذ والعطاء (Reciprocal Flow مش استجواب)');
    expect(prompt).toContain('لا يختم كل رسالة بسؤال');

    // Pings & Nudges
    expect(prompt).toContain('النداءات السريعة (Pings & Nudges)');
    expect(prompt).toContain('معاك اهو');
  });

  it('strictly forbids robotic ChatGPT translationese and promotes organic Egyptian connectors', () => {
    const prompt = compileHumanRealismLayer();

    // Forbidden slop
    expect(prompt).toContain('أتفهم مشاعرك تماماً');
    expect(prompt).toContain('هذا أمر رائع حقاً!');
    expect(prompt).toContain('كيف يمكنني مساعدتك اليوم؟');
    expect(prompt).toContain('بالتأكيد! أنا هنا لمساعدتك');

    // Required Egyptian connectors
    expect(prompt).toContain('بص بقى');
    expect(prompt).toContain('يعني من الآخر');
    expect(prompt).toContain('على فكرة');
    expect(prompt).toContain('معلش في الكلمة');
    expect(prompt).toContain('بقولك ايه');
  });

  it('embodies empirical WhatsApp texting rhythm and delimiter guidance', () => {
    const prompt = compileHumanRealismLayer();

    expect(prompt).toContain('15 إلى 45 حرفاً');
    expect(prompt).toContain('|||');
    expect(prompt).toContain('Emoji Discipline');
  });

  it('adapts tone for group vs private mode', () => {
    const privatePrompt = compileHumanRealismLayer({ isGroup: false });
    expect(privatePrompt).not.toContain('في المجموعات (Group Mode)');

    const groupPrompt = compileHumanRealismLayer({ isGroup: true });
    expect(groupPrompt).toContain('في المجموعات (Group Mode)');
    expect(groupPrompt).toContain('لا تهيمن على الشات');
  });
});
