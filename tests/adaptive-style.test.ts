import { describe, expect, it } from "bun:test";
import {
  detectConversationStyle,
  getStylePromptDirective,
  isExplicitStyleRequest,
  type ConversationStyle,
} from "../src/ai/adaptive-style";

describe("Adaptive Conversation Style Engine", () => {
  it("detects explicit style requests in English", () => {
    expect(detectConversationStyle("Please speak in a playful and funny tone")).toBe("playful");
    expect(detectConversationStyle("Let's keep this conversation strictly professional")).toBe("professional");
    expect(detectConversationStyle("Be casual and friendly, no need to be formal")).toBe("casual");
    expect(detectConversationStyle("Be assertive, firm and get straight to the point")).toBe("assertive");
    expect(detectConversationStyle("I feel so depressed and exhausted today, please be gentle")).toBe("empathetic");
  });

  it("detects explicit style requests in Arabic (Egyptian & Modern Standard)", () => {
    expect(detectConversationStyle("خليك مرح وهزر معايا شوية")).toBe("playful");
    expect(detectConversationStyle("عايز الكلام يكون رسمي جداً ومحدد")).toBe("professional");
    expect(detectConversationStyle("اتكلم عادي وبلاش رسميات")).toBe("casual");
    expect(detectConversationStyle("خليك حاسم وادخل في صلب الموضوع")).toBe("assertive");
    expect(detectConversationStyle("أنا متضايق ومحبط جداً، محتاجك تسمعني")).toBe("empathetic");
  });

  it("strictly handles negations and does NOT trigger negated styles", () => {
    expect(detectConversationStyle("بلاش هزار لو سمحت وخلينا جادين")).not.toBe("playful");
    expect(detectConversationStyle("Don't joke with me, this is serious")).not.toBe("playful");
    expect(detectConversationStyle("متكنش رسمي، اتكلم عادي")).toBe("casual");
    expect(detectConversationStyle("Don't be formal, just talk like a buddy")).toBe("casual");
  });

  it("gives explicit requests precedence over technical keywords", () => {
    const input = "Even though we are discussing an API database error, make it playful and funny";
    expect(detectConversationStyle(input)).toBe("playful");
  });

  it("produces crisp, non-tautological prompt directives for each style", () => {
    const styles: ConversationStyle[] = ["professional", "casual", "playful", "assertive", "empathetic"];
    for (const style of styles) {
      const directive = getStylePromptDirective(style);
      expect(directive).toBeString();
      expect(directive.length).toBeGreaterThan(20);
      expect(directive).toContain(style);
    }
  });

  it("correctly identifies whether an utterance is an explicit style change request", () => {
    expect(isExplicitStyleRequest("من فضلك اتكلم برسمية")).toBe(true);
    expect(isExplicitStyleRequest("switch to playful mode")).toBe(true);
    expect(isExplicitStyleRequest("كم سعر المنتج؟")).toBe(false);
    expect(isExplicitStyleRequest("What are your working hours?")).toBe(false);
  });
});
