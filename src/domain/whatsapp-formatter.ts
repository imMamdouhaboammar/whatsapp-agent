/**
 * WhatsApp Native Markdown Formatter
 *
 * Converts standard Markdown syntax (headings, bold, links, tables, blockquotes)
 * into clean, mobile-optimized WhatsApp formatting with zero rendering defects.
 */

export function formatWhatsAppMessage(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  // 1. Protect code blocks by extracting them temporarily
  const codeBlocks: string[] = [];
  let formatted = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Protect inline code
  const inlineCodes: string[] = [];
  formatted = formatted.replace(/`[^`\n]+`/g, (match) => {
    inlineCodes.push(match);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // 2. Remove horizontal rules
  formatted = formatted.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");

  // 3. Remove blockquote markers (> Quote -> Quote)
  formatted = formatted.replace(/^[ \t]*>[ \t]?(.*)$/gm, "$1");

  // 4. Convert Markdown Headings (# Header -> *Header*)
  formatted = formatted.replace(/^[ \t]*#{1,6}[ \t]+([^\n]+)$/gm, "*$1*");

  // 5. Convert Markdown Tables into mobile bullet lists
  formatted = convertMarkdownTables(formatted);

  // 6. Convert Links: [Label](url) -> Label (url)
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");

  // 7. Convert Strikethrough: ~~text~~ -> ~text~
  formatted = formatted.replace(/~~([^~]+)~~/g, "~$1~");

  // 8. Convert Bold: **text** -> *text*
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "*$1*");

  // 9. Clean up multiple empty lines
  formatted = formatted.replace(/\n{3,}/g, "\n\n").trim();

  // 10. Restore code blocks
  formatted = formatted.replace(/__INLINE_CODE_(\d+)__/g, (_, idx) => inlineCodes[Number(idx)] || "");
  formatted = formatted.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] || "");

  return formatted;
}

function convertMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect if this line looks like a table row: starts and ends with | or contains multiple |
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }

      // Check if table has a header and separator
      if (tableLines.length >= 2) {
        const headerRow = parseCells(tableLines[0]);
        const separatorCells = parseCells(tableLines[1]);
        const isSeparator = separatorCells.length > 0 && separatorCells.every((c) => /^:?-+:?$/.test(c.trim()));
        const startRow = isSeparator ? 2 : 1;

        for (let r = startRow; r < tableLines.length; r++) {
          const cells = parseCells(tableLines[r]);
          if (cells.length > 0 && cells.some((c) => c.length > 0)) {
            const rowParts: string[] = [];
            for (let c = 0; c < cells.length; c++) {
              const header = headerRow[c] || `Col ${c + 1}`;
              const val = cells[c];
              if (val) {
                rowParts.push(`${header}: ${val}`);
              }
            }
            if (rowParts.length > 0) {
              result.push(`• ${rowParts.join(" | ")}`);
            }
          }
        }
      } else {
        result.push(...tableLines);
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

function parseCells(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}
