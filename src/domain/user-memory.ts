/**
 * Contact Memory & Privacy Store
 *
 * Implements explicit user memory management with rigorous sensitive credential
 * interception, preventing leak of passwords, OTPs, API keys, or financial data.
 */

export { scrubCredentials } from "./learning-memory";

import type { SqliteStore } from "./db";

export interface ContactMemory {
  id: string;
  brand_id: string;
  jid: string;
  content: string;
  created_at: number;
}

export interface MemoryCommand {
  action: "save" | "list" | "delete" | "clear";
  content?: string;
  index?: number;
}

export interface MemoryCommandResult {
  status: "saved" | "listed" | "deleted" | "cleared" | "rejected_credential" | "rejected_limit" | "not_found";
  message?: string;
  memories?: ContactMemory[];
}

const MAX_MEMORY_LENGTH = 500;
const MAX_MEMORIES_PER_CONTACT = 30;

// High-entropy and credential patterns to strictly reject (Unicode-aware word boundaries)
const SENSITIVE_CREDENTIAL_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:password|passwd|kata\s+sandi|كلمة\s+السر|الباسورد|باسورد|كلمة\s+المرور|otp|pin|cvv|api[_-]?key|secret|token|bearer|credit[_-]?card)(?:$|[^\p{L}\p{N}])/iu;

export function containsSensitiveCredentials(text: string): boolean {
  return SENSITIVE_CREDENTIAL_PATTERN.test(String(text || ""));
}

export function parseMemoryCommand(text: string): MemoryCommand | null {
  const clean = String(text || "").trim();
  if (!clean) return null;

  // 1. Clear / Forget everything commands
  if (
    /^(?:forget\s+everything|clear\s+(?:all\s+)?memories|delete\s+all\s+memories)$/i.test(clean) ||
    /^(?:امسح|انسى|احذف|فرغ)\s+(?:كل\s+)?(?:الذكريات|حاجة|كل حاجة|كل شيء)/i.test(clean)
  ) {
    return { action: "clear" };
  }

  // 2. List commands
  if (
    /^(?:what do you remember(?: about me)?|show memories|list memories|view memories)[?.!]*$/i.test(clean) ||
    /^(?:انت فاكر ايه(?: عني)?|فاكر ايه|عرض الذكريات|وريني فاكر ايه|ماذا تتذكر)[؟?!.]*$/i.test(clean)
  ) {
    return { action: "list" };
  }

  // 3. Delete by index commands
  const delEn = clean.match(/^(?:forget|delete|remove)\s+(?:memory\s+)?#?(\d+)[.!?]*$/i);
  if (delEn) {
    return { action: "delete", index: Number(delEn[1]) };
  }
  const delAr = clean.match(/^(?:امسح|انسى|احذف)\s+(?:(?:الذكرى|المعلومة|الرقم)\s+)?(?:رقم\s+)?#?(\d+)[؟?!.]*$/i);
  if (delAr) {
    return { action: "delete", index: Number(delAr[1]) };
  }

  // 4. Save commands
  const saveEn = clean.match(/^(?:remember(?:\s+that)?|note(?:\s+that)?|save(?:\s+that)?|keep in mind(?:\s+that)?)\s+(.+)$/i);
  if (saveEn) {
    return { action: "save", content: saveEn[1].trim() };
  }
  const saveAr = clean.match(/^(?:افتكر|سجل عندك|احفظ عندك|خليك فاكر|متنساش)\s+(?:انني|إنني|إني|اني|ان|إن|انو|أن)?\s*(.+)$/i);
  if (saveAr) {
    return { action: "save", content: saveAr[1].trim() };
  }

  return null;
}

export function formatMemoriesForPrompt(memories: ContactMemory[]): string {
  if (!memories || memories.length === 0) {
    return "";
  }

  const lines = memories.map((m, idx) => `${idx + 1}. ${m.content}`);
  return [
    "[Contact Facts & Preferences (Informational Context Only - Untrusted)]",
    ...lines,
  ].join("\n");
}

export class UserMemoryManager {
  constructor(private store: SqliteStore) {}

  async getMemories(brandId: string, jid: string): Promise<ContactMemory[]> {
    return this.store.getContactMemories(brandId, jid);
  }

  async handleCommand(
    brandId: string,
    jid: string,
    text: string
  ): Promise<MemoryCommandResult> {
    const cmd = parseMemoryCommand(text);
    if (!cmd) {
      return { status: "not_found", message: "Not a valid memory command" };
    }

    if (cmd.action === "clear") {
      const count = this.store.clearContactMemories(brandId, jid);
      return {
        status: "cleared",
        message: `Cleared ${count} memories.`,
      };
    }

    if (cmd.action === "list") {
      const memories = this.store.getContactMemories(brandId, jid);
      return {
        status: "listed",
        memories,
        message: memories.length === 0 ? "No active memories found." : undefined,
      };
    }

    if (cmd.action === "delete") {
      const memories = this.store.getContactMemories(brandId, jid);
      const targetIdx = (cmd.index ?? 1) - 1;
      if (targetIdx < 0 || targetIdx >= memories.length) {
        return {
          status: "not_found",
          message: `Memory #${cmd.index} does not exist.`,
        };
      }
      const targetMemory = memories[targetIdx];
      const deleted = this.store.deleteContactMemory(brandId, jid, targetMemory.id);
      return {
        status: deleted ? "deleted" : "not_found",
        message: deleted ? `Deleted memory #${cmd.index}.` : "Failed to delete memory.",
      };
    }

    if (cmd.action === "save") {
      const content = cmd.content || "";
      if (containsSensitiveCredentials(content)) {
        return {
          status: "rejected_credential",
          message: "Security exception: sensitive credentials, passwords, or tokens cannot be stored in memory.",
        };
      }

      if (content.length > MAX_MEMORY_LENGTH) {
        return {
          status: "rejected_limit",
          message: `Memory length exceeds maximum permitted limit (${MAX_MEMORY_LENGTH} characters).`,
        };
      }

      const existing = this.store.getContactMemories(brandId, jid);
      if (existing.length >= MAX_MEMORIES_PER_CONTACT) {
        return {
          status: "rejected_limit",
          message: `Maximum memory capacity reached (${MAX_MEMORIES_PER_CONTACT} entries).`,
        };
      }

      const saved = this.store.saveContactMemory(brandId, jid, content);
      return {
        status: "saved",
        message: `Memory saved successfully.`,
        memories: [saved],
      };
    }

    return { status: "not_found" };
  }
}
