import { describe, expect, it } from "bun:test";
import { SqliteStore } from "../src/domain/db";
import {
  containsSensitiveCredentials,
  formatMemoriesForPrompt,
  parseMemoryCommand,
  UserMemoryManager,
} from "../src/domain/user-memory";

describe("User Memory & Privacy Store", () => {
  it("parses explicit save commands in English and Arabic", () => {
    const en = parseMemoryCommand("Remember that I prefer morning delivery between 9am and 12pm");
    expect(en).toEqual({
      action: "save",
      content: "I prefer morning delivery between 9am and 12pm",
    });

    const ar = parseMemoryCommand("افتكر اني بفضل الاستلام في المعادي يوم السبت");
    expect(ar).toEqual({
      action: "save",
      content: "بفضل الاستلام في المعادي يوم السبت",
    });
  });

  it("parses list, delete, and clear commands in English and Arabic", () => {
    expect(parseMemoryCommand("What do you remember about me?")).toEqual({ action: "list" });
    expect(parseMemoryCommand("انت فاكر ايه عني؟")).toEqual({ action: "list" });

    expect(parseMemoryCommand("Forget memory #2")).toEqual({ action: "delete", index: 2 });
    expect(parseMemoryCommand("امسح المعلومة رقم 3")).toEqual({ action: "delete", index: 3 });

    expect(parseMemoryCommand("Forget everything")).toEqual({ action: "clear" });
    expect(parseMemoryCommand("امسح كل الذكريات")).toEqual({ action: "clear" });
  });

  it("strictly intercepts and blocks sensitive credentials from being stored", () => {
    expect(containsSensitiveCredentials("my password is Password123!")).toBe(true);
    expect(containsSensitiveCredentials("الباسورد هو 123456")).toBe(true);
    expect(containsSensitiveCredentials("here is my api_key: sk-proj-123")).toBe(true);
    expect(containsSensitiveCredentials("my OTP code is 987654")).toBe(true);
    expect(containsSensitiveCredentials("I like black shoes and coffee")).toBe(false);
  });

  it("stores, lists, deletes, and clears memories per contact in SQLite", async () => {
    const store = new SqliteStore({ dbPath: ":memory:" });
    const manager = new UserMemoryManager(store);

    const brandId = "brand_1";
    const jid = "201011112222@s.whatsapp.net";

    // 1. Save memory
    const saveRes = await manager.handleCommand(brandId, jid, "Remember that my shoe size is 43");
    expect(saveRes.status).toBe("saved");

    // 2. Try saving sensitive credential
    const credRes = await manager.handleCommand(brandId, jid, "Remember my secret password is 9999");
    expect(credRes.status).toBe("rejected_credential");

    // 3. List memories
    const listRes = await manager.handleCommand(brandId, jid, "What do you remember about me?");
    expect(listRes.status).toBe("listed");
    expect(listRes.memories?.length).toBe(1);
    expect(listRes.memories?.[0].content).toBe("my shoe size is 43");

    // 4. Save second memory
    await manager.handleCommand(brandId, jid, "Remember that I speak Arabic");
    const list2 = await manager.getMemories(brandId, jid);
    expect(list2.length).toBe(2);

    // 5. Delete by index 1
    const delRes = await manager.handleCommand(brandId, jid, "Forget memory #1");
    expect(delRes.status).toBe("deleted");
    const remaining = await manager.getMemories(brandId, jid);
    expect(remaining.length).toBe(1);
    expect(remaining[0].content).toBe("I speak Arabic");

    // 6. Clear all
    const clearRes = await manager.handleCommand(brandId, jid, "Clear all memories");
    expect(clearRes.status).toBe("cleared");
    expect((await manager.getMemories(brandId, jid)).length).toBe(0);
  });

  it("formats memories as untrusted passive context for the LLM prompt", () => {
    const memories = [
      { id: "1", brand_id: "b1", jid: "user1", content: "Prefers morning delivery", created_at: Date.now() },
      { id: "2", brand_id: "b1", jid: "user1", content: "VIP customer", created_at: Date.now() },
    ];

    const promptContext = formatMemoriesForPrompt(memories);
    expect(promptContext).toContain("Contact Facts & Preferences");
    expect(promptContext).toContain("1. Prefers morning delivery");
    expect(promptContext).toContain("2. VIP customer");
  });
});
