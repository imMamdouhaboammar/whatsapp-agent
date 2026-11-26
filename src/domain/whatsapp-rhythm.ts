/**
 * WhatsApp Empirical Rhythm & Spontaneous Reaction Engine
 *
 * Inspired by Rafiq-July empirical WhatsApp texting metrics and cognitive ingestion latency.
 * Real humans take 0.6s to 2.8s to read an incoming turn before typing, and react
 * spontaneously with authentic emoji reactions for humor, shock, grief, affection, or solidarity.
 */

export interface SpontaneousReactionResult {
  shouldReact: boolean;
  emoji: string;
  delayMs: number;
}

export interface BubbleRhythmPlan {
  cognitiveReadingDelayMs: number;
  reaction?: SpontaneousReactionResult;
  bubbles: Array<{
    text: string;
    typingDelayMs: number;
  }>;
}

/**
 * Calculates human reading latency (Cognitive ingestion delay).
 * A real WhatsApp user takes 0.6s to 2.8s to digest an incoming message
 * before their hands start typing.
 */
export function calculateCognitiveReadingDelay(messageText: string, burstCount = 1): number {
  const trimmed = messageText.trim();
  const length = trimmed.length;

  let baseDelay = 700;
  if (length <= 25) {
    baseDelay = 600 + Math.floor(Math.random() * 300); // 600 - 900ms
  } else if (length <= 100) {
    baseDelay = 900 + Math.floor(length * 8) + Math.floor(Math.random() * 400); // 1100 - 2100ms
  } else {
    baseDelay = 1600 + Math.floor(Math.min(length * 5, 800)) + Math.floor(Math.random() * 400); // 2000 - 2800ms
  }

  // If user sent multiple rapid bursts, add small cognitive scanning buffer
  if (burstCount > 1) {
    baseDelay += Math.min((burstCount - 1) * 250, 600);
  }

  return Math.min(Math.max(baseDelay, 600), 3000);
}

/**
 * Evaluates whether the companion should spontaneously react with a WhatsApp emoji.
 * Real friends react spontaneously to funny jokes, affection, shocking news, or deep empathy.
 */
export function evaluateSpontaneousReaction(params: {
  text: string;
  style?: string;
}): SpontaneousReactionResult | null {
  const { text } = params;
  if (!text || !text.trim()) return null;

  const normalized = text.toLowerCase().trim();

  // 1. Humor & Laughter triggers -> 😂
  const humorPattern = /(😂|🤣|هههه|ههه|نكتة|مسخرة|ألش|القلش|يموت من الضحك|مش قادر|فطست|كركر|lol|lmao|rofl|haha)/i;
  if (humorPattern.test(normalized)) {
    return {
      shouldReact: true,
      emoji: '😂',
      delayMs: 500 + Math.floor(Math.random() * 400),
    };
  }

  // 2. Shock & Surprise triggers -> 😮
  const shockPattern = /(مش هتصدق|يا نهار ابيض|يا لهوي|كارثة|فزت ب|تخيل كدا|صدمة|معقول|بجد والله|no way|omg|unbelievable)/i;
  if (shockPattern.test(normalized)) {
    return {
      shouldReact: true,
      emoji: '😮',
      delayMs: 600 + Math.floor(Math.random() * 400),
    };
  }

  // 3. Affection & Sweet camaraderie -> ❤️
  const affectionPattern = /(بحبك|تسلملي|تسلم يا غالي|شكرا يا صاحبي|ربنا يخليك|وحشتني|يا أحسن رفيق|يا قلبي|love you|appreciate it)/i;
  if (affectionPattern.test(normalized)) {
    return {
      shouldReact: true,
      emoji: '❤️',
      delayMs: 700 + Math.floor(Math.random() * 400),
    };
  }

  // 4. Distress / Grief / Vulnerable sorrow -> 🥺 or 🙏
  const griefPattern = /(تعبان|مخنوق|زعلان|الشغل قرف|ادعيلي|وفاة|مات|في المستشفى|بموت من التعب|حزين|احباط|محبط|depressed|heartbroken)/i;
  if (griefPattern.test(normalized)) {
    const emoji = normalized.includes('ادعيلي') || normalized.includes('وفاة') || normalized.includes('مات') ? '🙏' : '🥺';
    return {
      shouldReact: true,
      emoji,
      delayMs: 750 + Math.floor(Math.random() * 450),
    };
  }

  // 5. Solid agreement / Bro-code confirmation -> 👍
  const agreementPattern = /(خلصانة|اشطا عليك|تمام كدا|اتفقنا يا عم|يا رجولة|سرك في بير|done deal|deal)/i;
  if (agreementPattern.test(normalized)) {
    return {
      shouldReact: true,
      emoji: '👍',
      delayMs: 550 + Math.floor(Math.random() * 350),
    };
  }

  return null;
}

/**
 * Calculates typing simulation delay for a single bubble.
 * Realistic texting speed is ~30-50ms per character, clamped within realistic boundaries.
 */
export function calculateBubbleTypingDelay(bubbleText: string): number {
  const chars = bubbleText.trim().length;
  const words = bubbleText.trim().split(/\s+/).length;

  const charBased = chars * 45;
  const wordBased = words * 120;
  const calculated = Math.max(charBased, wordBased);

  return Math.min(Math.max(calculated, 650), 3200);
}
