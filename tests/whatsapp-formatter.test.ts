import { describe, expect, it } from "bun:test";
import { formatWhatsAppMessage } from "../src/domain/whatsapp-formatter";

describe("WhatsApp Message Formatter", () => {
  it("converts markdown headings into bold text", () => {
    const input = "# Welcome to Store\n\n## Categories\n\n### Best Sellers";
    const result = formatWhatsAppMessage(input);
    expect(result).toBe("*Welcome to Store*\n\n*Categories*\n\n*Best Sellers*");
  });

  it("normalizes markdown bold, italic, and strikethrough", () => {
    const input = "Here is **bold** text and ~~deleted~~ text and _italic_ text.";
    const result = formatWhatsAppMessage(input);
    expect(result).toBe("Here is *bold* text and ~deleted~ text and _italic_ text.");
  });

  it("converts markdown links to label and URL format", () => {
    const input = "Check out our catalog at [Our Website](https://example.com/store).";
    const result = formatWhatsAppMessage(input);
    expect(result).toBe("Check out our catalog at Our Website (https://example.com/store).");
  });

  it("converts markdown tables into mobile-friendly bullet points", () => {
    const table = [
      "| Product | SKU | Price |",
      "| :--- | :---: | ---: |",
      "| Sneaker A | SNK-01 | $85 |",
      "| Hoodie B | HOD-02 | $45 |",
    ].join("\n");

    const result = formatWhatsAppMessage(table);
    expect(result).toContain("• Product: Sneaker A | SKU: SNK-01 | Price: $85");
    expect(result).toContain("• Product: Hoodie B | SKU: HOD-02 | Price: $45");
  });

  it("strips decorative horizontal rules and blockquotes", () => {
    const input = "---\n> Note: Delivery takes 2 days.\n***";
    const result = formatWhatsAppMessage(input);
    expect(result).not.toContain("---");
    expect(result).not.toContain("***");
    expect(result).toBe("Note: Delivery takes 2 days.");
  });

  it("preserves fenced code blocks and inline code intact", () => {
    const input = "Use the command `npm install` or run:\n```bash\nbun run dev\n```";
    const result = formatWhatsAppMessage(input);
    expect(result).toContain("`npm install`");
    expect(result).toContain("```bash\nbun run dev\n```");
  });

  it("handles Arabic text with mixed formatting seamlessly", () => {
    const input = "# عروض اليوم\nاشتري **المنتج رقم 1** بسعر خاص!\n[اضغط هنا](https://store.eg/offer)";
    const result = formatWhatsAppMessage(input);
    expect(result).toContain("*عروض اليوم*");
    expect(result).toContain("*المنتج رقم 1*");
    expect(result).toContain("اضغط هنا (https://store.eg/offer)");
  });
});
