/**
 * Bilingual Adaptive Conversation Style & Persona Engine
 *
 * Classifies conversational sentiment and explicit persona requests (Arabic & English),
 * handling negations cleanly and generating crisp, actionable prompt directives.
 */

export type ConversationStyle = "professional" | "casual" | "playful" | "assertive" | "empathetic";

interface StyleDefinition {
  style: ConversationStyle;
  explicitPatterns: RegExp[];
  sentimentPatterns: RegExp[];
  negationPatterns: RegExp[];
  directive: string;
}

const STYLE_DEFINITIONS: StyleDefinition[] = [
  {
    style: "playful",
    explicitPatterns: [
      /\b(?:playful|funny|joke|humorous|humor|roast|witty)\b/i,
      /(?:مرح|هزار|فكاهي|دمك خفيف|انكت|فرفوش|نكت)/i,
    ],
    sentimentPatterns: [
      /\b(?:haha+|hehe+|lol|lmao|rofl)\b/i,
      /(?:هههه+|هاها+|يا عيني|يا سلام|عاش)/i,
    ],
    negationPatterns: [
      /\b(?:don'?t|do not|never|stop|without|no\s+need\s+to|not)\s+(?:\w+\s+){0,3}(?:playful|funny|joke|joking|roast)\b/i,
      /(?:بلاش|متكنش|مش|بدون|لا|مفيش\s+داعي)\s+(?:[\p{L}]+\s+){0,3}(?:هزار|ضحك|استظراف)/iu,
    ],
    directive:
      "Style: playful. Use cheerful, witty, and humorous language. Include playful emojis and a warm, lighthearted spirit without sacrificing factual truth.",
  },
  {
    style: "professional",
    explicitPatterns: [
      /\b(?:professional|formal|business-like|official|corporate)\b/i,
      /(?:رسمي|مهني|أعمال|جدية|برسمية|بدون هزار)/i,
    ],
    sentimentPatterns: [
      /\b(?:inquiry|contract|invoice|procurement|sla|specifications)\b/i,
      /(?:استفسار رسمي|تعاقد|فاتورة|شروط|مواصفات)/i,
    ],
    negationPatterns: [
      /\b(?:don'?t|do not|never|without|no\s+need\s+to|not)\s+(?:\w+\s+){0,3}(?:formal|professional)\b/i,
      /(?:بلاش|متكنش|مش|بدون|لا|مفيش\s+داعي)\s+(?:[\p{L}]+\s+){0,3}(?:رسمي|رسميات|تكلف)/iu,
    ],
    directive:
      "Style: professional. Maintain an authoritative, polite, structured, and formal tone. Avoid slang and colloquialisms. Be concise and precise.",
  },
  {
    style: "assertive",
    explicitPatterns: [
      /\b(?:assertive|firm|direct|straight to the point|strict|no fluff)\b/i,
      /(?:حاسم|مباشر|صلب الموضوع|بدون لف ودوران|جاد|صارم)/i,
    ],
    sentimentPatterns: [
      /\b(?:urgent|immediately|asap|critical|fix now)\b/i,
      /(?:ضروري|حالاً|فوري|مهم جداً|بسرعة)/i,
    ],
    negationPatterns: [
      /\b(?:don'?t|do not|never)\s+(?:be\s+)?(?:aggressive|harsh|assertive|strict)\b/i,
      /(?:بلاش|متكنش|لا)\s+(?:قاسي|عنيف|صارم)/i,
    ],
    directive:
      "Style: assertive. Deliver direct, decisive, and actionable answers immediately with zero introductory fluff or pleasantries.",
  },
  {
    style: "empathetic",
    explicitPatterns: [
      /\b(?:empathetic|gentle|supportive|kind|listen to me|compassionate)\b/i,
      /(?:متعاطف|داعم|اسمعني|طبطب|حنون|لطيف|أنا متضايق|محبط|حزين)/i,
    ],
    sentimentPatterns: [
      /\b(?:depressed|exhausted|sad|grief|lonely|heartbroken|rough day|overwhelmed)\b/i,
      /(?:تعبان|مخنوق|يومي صعب|زعلان|مكتئب|حاسس بالوحدة)/i,
    ],
    negationPatterns: [
      /\b(?:don'?t|do not)\s+(?:pity|patronize|baby)\b/i,
      /(?:بلاش|لا)\s+(?:شفقة|دراما)/i,
    ],
    directive:
      "Style: empathetic. Listen actively and communicate with genuine compassion, validation, and emotional warmth. Offer gentle, supportive reassurance.",
  },
  {
    style: "casual",
    explicitPatterns: [
      /\b(?:casual|friendly|relax|informal|like a friend|buddy)\b/i,
      /(?:عادي|عامي|ودود|صاحب|صحاب|بلاش رسميات|بين الصحاب)/i,
    ],
    sentimentPatterns: [
      /\b(?:cool|bro|mate|dude|sup|hey)\b/i,
      /(?:يا باشا|يا غالي|حبيبي|يا صاحبي|ازيك)/i,
    ],
    negationPatterns: [
      /\b(?:don'?t|do not)\s+(?:be\s+)?(?:casual|overfamiliar)\b/i,
      /(?:بلاش|لا)\s+(?:عامية|استخفاف)/i,
    ],
    directive:
      "Style: casual. Speak naturally in friendly, colloquial terms like a trusted peer, keeping the dialogue warm, accessible, and grounded.",
  },
];

export function isExplicitStyleRequest(text: string): boolean {
  const clean = String(text || "").trim();
  if (!clean) return false;

  for (const def of STYLE_DEFINITIONS) {
    if (def.explicitPatterns.some((p) => p.test(clean))) {
      return true;
    }
  }
  return false;
}

export function detectConversationStyle(
  text: string,
  defaultStyle: ConversationStyle = "casual"
): ConversationStyle {
  const clean = String(text || "").trim();
  if (!clean) return defaultStyle;

  // 1. Check for explicit style requests first (checking that they are not negated)
  for (const def of STYLE_DEFINITIONS) {
    // If negated, skip this style
    const isNegated = def.negationPatterns.some((np) => np.test(clean));
    if (isNegated) continue;

    const isExplicit = def.explicitPatterns.some((ep) => ep.test(clean));
    if (isExplicit) {
      return def.style;
    }
  }

  // 2. Check for sentiment cues if no explicit style requested
  for (const def of STYLE_DEFINITIONS) {
    const isNegated = def.negationPatterns.some((np) => np.test(clean));
    if (isNegated) continue;

    const hasSentiment = def.sentimentPatterns.some((sp) => sp.test(clean));
    if (hasSentiment) {
      return def.style;
    }
  }

  return defaultStyle;
}

export function getStylePromptDirective(style: ConversationStyle): string {
  const match = STYLE_DEFINITIONS.find((d) => d.style === style);
  return match
    ? match.directive
    : `Style: ${style}. Respond naturally and appropriately.`;
}
