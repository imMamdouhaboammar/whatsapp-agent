export interface MessageSplitterOptions {
  minLengthToSplit?: number;
  maxBubbleLength?: number;
  minBubbleLength?: number;
  charsPerSecond?: number;
  minBubbleDelayMs?: number;
  maxBubbleDelayMs?: number;
}

export class MessageSplitter {
  private minLengthToSplit: number;
  private maxBubbleLength: number;
  private minBubbleLength: number;
  private charsPerSecond: number;
  private minBubbleDelayMs: number;
  private maxBubbleDelayMs: number;

  constructor(options: MessageSplitterOptions = {}) {
    this.minLengthToSplit = options.minLengthToSplit ?? 75;
    this.maxBubbleLength = options.maxBubbleLength ?? 260;
    this.minBubbleLength = options.minBubbleLength ?? 20;
    this.charsPerSecond = options.charsPerSecond ?? 28;
    this.minBubbleDelayMs = options.minBubbleDelayMs ?? 1000;
    this.maxBubbleDelayMs = options.maxBubbleDelayMs ?? 4000;
  }

  /**
   * Splits a long model reply into 1 to 3 natural conversational bubbles
   */
  split(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // If text is brief, keep it as a single natural bubble
    if (trimmed.length < this.minLengthToSplit) {
      return [trimmed];
    }

    // If text has explicit paragraph breaks (\n\n), treat paragraphs as distinct bubbles
    if (trimmed.includes('\n\n')) {
      const paragraphs = trimmed
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      if (paragraphs.length > 1) {
        return paragraphs.slice(0, 3);
      }
    }

    // Split candidate segments by explicit newlines
    let segments = trimmed.split(/\n/).map((s) => s.trim()).filter(Boolean);

    // If only one segment, attempt sentence-boundary split (period, question mark, exclamation)
    if (segments.length === 1) {
      const sentenceRegex = /([^.؟!?!]+[.؟!?!]+(?:\s+|$))/g;
      const matches = trimmed.match(sentenceRegex);
      if (matches && matches.length > 1) {
        segments = matches.map((m) => m.trim()).filter(Boolean);
      }
    }

    // Merge segments that are too tiny with their neighbor
    const merged: string[] = [];
    let current = '';

    for (const seg of segments) {
      if (!current) {
        current = seg;
      } else if (current.length + seg.length + 1 <= 140) {
        current = `${current} ${seg}`;
      } else {
        merged.push(current);
        current = seg;
      }
    }

    if (current) {
      merged.push(current);
    }

    // Cap at 3 bubbles max so we don't spam the recipient
    if (merged.length > 3) {
      const firstTwo = merged.slice(0, 2);
      const rest = merged.slice(2).join(' ');
      return [...firstTwo, rest];
    }

    return merged.length > 0 ? merged : [trimmed];
  }

  /**
   * Computes human typing delay in milliseconds for an individual bubble
   */
  calculateDelay(bubbleText: string, isFirstBubble = true): number {
    const chars = bubbleText.trim().length;
    const baseTime = (chars / this.charsPerSecond) * 1000;
    // First bubble includes reading/cognitive time, subsequent bubbles have typing cadence
    const pause = isFirstBubble ? Math.random() * 800 + 700 : Math.random() * 500 + 400;
    const total = Math.round(baseTime + pause);
    return Math.min(Math.max(total, this.minBubbleDelayMs), this.maxBubbleDelayMs);
  }
}
