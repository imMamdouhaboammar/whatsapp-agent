import { describe, expect, test } from "bun:test";
import { DIAGNOSTIC_STAGES, DiagnosticsCore } from "../src/observability/diagnostics-core";

describe("S08 diagnostics core", () => {
  test("creates opaque trace and event IDs without persisting raw conversation identifiers or supplied metadata", () => {
    const core = new DiagnosticsCore({ now: () => 1_000 });
    const conversationId = ["client", "private", "identifier"].join(":");
    const traceId = core.startTrace({ conversationId });
    const input = {
      traceId,
      stage: "received" as const,
      outcome: "ok" as const,
      message: "private message content",
      credentials: ["private", "bearer"].join(" "),
      phoneNumber: "1234567890",
    };

    const event = core.recordStage(input);
    expect(traceId).toMatch(/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i);
    expect(event.eventId).not.toBe(traceId);
    expect(event).toEqual({
      eventId: expect.any(String),
      traceId,
      stage: "received",
      outcome: "ok",
      at: 1_000,
    });

    const serialized = JSON.stringify({ trace: core.getTrace(traceId), snapshot: core.snapshot() });
    for (const sensitive of [conversationId, input.message, input.credentials, input.phoneNumber]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  test("keeps correlation stable across repeated attempts and refuses mismatched chat ownership", () => {
    const core = new DiagnosticsCore();
    const traceId = core.startTrace({ conversationId: "chat:A" });
    expect(core.startTrace({ traceId, conversationId: "chat:A" })).toBe(traceId);
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    core.recordStage({ traceId, stage: "sending", outcome: "ok" });
    const events = core.getTrace(traceId);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.traceId === traceId)).toBe(true);
    expect(() => core.startTrace({ traceId, conversationId: "chat:B" })).toThrow();
  });

  test("requires registered trace IDs and a strict vocabulary even for runtime JavaScript callers", () => {
    const core = new DiagnosticsCore();
    const traceId = core.startTrace();
    expect(() => core.recordStage({ traceId: crypto.randomUUID(), stage: "received" })).toThrow();
    expect(() => core.recordStage({ traceId, stage: "raw-chat-text" as "received" })).toThrow();
    expect(() => core.recordStage({ traceId, stage: "received", outcome: "private failure string" as "ok" })).toThrow();
    expect(() => core.startTrace({ traceId: "customer-phone-number" })).toThrow();
    expect(() => core.setWorker({ kind: "arbitrary caller name" as "media", enabled: true, state: "healthy" })).toThrow();
  });

  test("calculates documented latencies from stage timestamps without storing user content", () => {
    let current = 1_000;
    const core = new DiagnosticsCore({ now: () => current });
    const traceId = core.startTrace();
    core.recordStage({ traceId, stage: "persisted" });
    current = 1_140;
    core.recordStage({ traceId, stage: "policy_decided" });
    current = 1_200;
    core.recordStage({ traceId, stage: "intent_created" });
    current = 1_260;
    core.recordStage({ traceId, stage: "sending" });
    const { metrics } = core.snapshot();
    expect(metrics.inboundDecisionLatencyMs).toEqual({ samples: 1, averageMs: 140, maxMs: 140 });
    expect(metrics.sendQueueLatencyMs).toEqual({ samples: 1, averageMs: 60, maxMs: 60 });
  });

  test("reports uncertain sends and their age until acceptance without automatic replay", () => {
    let current = 4_000;
    const core = new DiagnosticsCore({ now: () => current });
    const traceId = core.startTrace();
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    current = 6_000;
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 1, oldestAgeMs: 2_000 });
    core.recordStage({ traceId, stage: "accepted" });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 0, oldestAgeMs: 0 });
  });

  test("keeps receipt state monotonic and counts distinct traces once", () => {
    const core = new DiagnosticsCore();
    const traceId = core.startTrace();
    core.recordReceipt({ traceId, state: "read" });
    core.recordReceipt({ traceId, state: "delivered" });
    core.recordReceipt({ traceId, state: "delivered" });
    expect(core.snapshot().metrics.receiptStates).toEqual({ accepted: 0, delivered: 0, read: 1 });
    expect(core.getTrace(traceId).filter((event) => event.stage === "receipt_updated")).toHaveLength(1);
  });

  test("marks crashed enabled workers as degraded but never treats a disabled optional worker as an incident", () => {
    const core = new DiagnosticsCore({ now: () => 9_000 });
    core.setWorker({ kind: "media", enabled: false, state: "crashed" });
    core.setWorker({ kind: "reflection", enabled: true, state: "healthy" });
    core.setWorker({ kind: "evaluation", enabled: true, state: "crashed" });
    const snapshot = core.snapshot();
    expect(snapshot.health).toBe("degraded");
    expect(snapshot.workers).toContainEqual({ kind: "media", state: "disabled", at: 9_000 });
    expect(snapshot.workers).toContainEqual({ kind: "evaluation", state: "crashed", at: 9_000 });
    expect(snapshot.incidents.filter((event) => event.worker === "media")).toHaveLength(0);
    expect(snapshot.incidents.some((event) => event.worker === "evaluation")).toBe(true);
  });

  test("forgets conversation-linked trace data and expires traces after retention", () => {
    let current = 1_000;
    const core = new DiagnosticsCore({ now: () => current, retentionMs: 5_000 });
    const first = core.startTrace({ conversationId: "chat:sensitive" });
    const second = core.startTrace({ conversationId: "chat:other" });
    core.recordStage({ traceId: first, stage: "received" });
    core.recordStage({ traceId: second, stage: "received" });
    expect(core.forgetConversation("chat:sensitive")).toBe(1);
    expect(core.getTrace(first)).toEqual([]);
    expect(core.getTrace(second)).toHaveLength(1);
    current = 6_001;
    expect(core.purgeExpired()).toBe(1);
    expect(core.snapshot().traceCount).toBe(0);
  });

  test("bounds in-memory traces and incident visibility", () => {
    let current = 100;
    const core = new DiagnosticsCore({ now: () => current, maxTraces: 2, maxIncidents: 1 });
    const first = core.startTrace();
    core.recordStage({ traceId: first, stage: "evaluated", outcome: "failed" });
    current += 10;
    const second = core.startTrace();
    core.recordStage({ traceId: second, stage: "sending", outcome: "uncertain" });
    current += 10;
    const third = core.startTrace();
    core.recordStage({ traceId: third, stage: "media_inspection", outcome: "timeout" });
    const snapshot = core.snapshot();
    expect(snapshot.traceCount).toBe(2);
    expect(core.getTrace(first)).toEqual([]);
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]?.stage).toBe("media_inspection");
  });

  test("caps high-volume per-trace events without losing latency or uncertain-send accounting", () => {
    let current = 100;
    const core = new DiagnosticsCore({ now: () => current, maxEventsPerTrace: 2 });
    const traceId = core.startTrace({ conversationId: "chat:busy" });
    core.recordStage({ traceId, stage: "persisted" });
    current = 120;
    core.recordStage({ traceId, stage: "policy_decided" });
    current = 130;
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    current = 200;
    core.recordStage({ traceId, stage: "memory_retrieval" });
    expect(core.getTrace(traceId)).toHaveLength(2);
    expect(core.snapshot().metrics.inboundDecisionLatencyMs).toEqual({
      samples: 1,
      averageMs: 20,
      maxMs: 20,
    });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 1, oldestAgeMs: 70 });
  });

  test("rejects unbounded or invalid retention and capacity settings", () => {
    expect(() => new DiagnosticsCore({ retentionMs: 0 })).toThrow();
    expect(() => new DiagnosticsCore({ maxTraces: 0 })).toThrow();
    expect(() => new DiagnosticsCore({ maxEventsPerTrace: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => new DiagnosticsCore({ maxIncidents: -1 })).toThrow();
  });

  test("counts actual adapter acceptance as a receipt state without downgrading later evidence", () => {
    const core = new DiagnosticsCore();
    const traceId = core.startTrace();
    core.recordStage({ traceId, stage: "accepted" });
    expect(core.snapshot().metrics.receiptStates).toEqual({ accepted: 1, delivered: 0, read: 0 });
    core.recordReceipt({ traceId, state: "read" });
    core.recordStage({ traceId, stage: "accepted" });
    expect(core.snapshot().metrics.receiptStates).toEqual({ accepted: 0, delivered: 0, read: 1 });
  });

  test("keeps an earlier uncertain attempt unresolved through later sending or failed acceptance", () => {
    let current = 1_000;
    const core = new DiagnosticsCore({ now: () => current });
    const traceId = core.startTrace();
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });

    current = 2_000;
    core.recordStage({ traceId, stage: "sending", outcome: "ok" });
    current = 3_000;
    core.recordStage({ traceId, stage: "sending", outcome: "failed" });
    core.recordStage({ traceId, stage: "accepted", outcome: "failed" });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 1, oldestAgeMs: 2_000 });
    expect(core.snapshot().metrics.receiptStates).toEqual({ accepted: 0, delivered: 0, read: 0 });

    current = 3_500;
    core.recordReceipt({ traceId, state: "delivered" });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 0, oldestAgeMs: 0 });
    expect(core.snapshot().metrics.receiptStates).toEqual({ accepted: 0, delivered: 1, read: 0 });
  });

  test("does not reset age when duplicate uncertain attempts arrive", () => {
    let current = 1_000;
    const core = new DiagnosticsCore({ now: () => current });
    const traceId = core.startTrace();
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    current = 2_000;
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    current = 4_000;
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 1, oldestAgeMs: 3_000 });
    core.recordStage({ traceId, stage: "accepted", outcome: "ok" });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 0, oldestAgeMs: 0 });
    expect(core.snapshot().metrics.receiptStates.accepted).toBe(1);
  });

  test("ignores delayed uncertain send reports after acceptance and positive receipts", () => {
    let current = 1_000;
    const core = new DiagnosticsCore({ now: () => current });
    const traceId = core.startTrace();
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    current = 2_000;
    core.recordStage({ traceId, stage: "accepted", outcome: "ok" });
    current = 3_000;
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 0, oldestAgeMs: 0 });
    core.recordReceipt({ traceId, state: "read" });
    current = 4_000;
    core.recordStage({ traceId, stage: "sending", outcome: "uncertain" });
    expect(core.snapshot().metrics.uncertainSends).toEqual({ count: 0, oldestAgeMs: 0 });
    expect(core.snapshot().metrics.receiptStates.read).toBe(1);
  });

  test("canonicalizes the same UUID regardless of caller casing across all operations", () => {
    const core = new DiagnosticsCore();
    const upperCaseId = crypto.randomUUID().toUpperCase();
    const canonicalId = upperCaseId.toLowerCase();
    expect(core.startTrace({ traceId: upperCaseId })).toBe(canonicalId);
    expect(core.startTrace({ traceId: canonicalId })).toBe(canonicalId);
    const event = core.recordStage({ traceId: upperCaseId, stage: "received" });
    expect(event.traceId).toBe(canonicalId);
    core.recordReceipt({ traceId: upperCaseId, state: "delivered" });
    expect(core.getTrace(canonicalId)).toHaveLength(2);
    expect(core.getTrace(upperCaseId)).toHaveLength(2);
    expect(core.snapshot().traceCount).toBe(1);
  });

  test("evicts least-recently-active traces rather than the first created", () => {
    let current = 100;
    const core = new DiagnosticsCore({ now: () => current, maxTraces: 2 });
    const active = core.startTrace();
    current = 200;
    const dormant = core.startTrace();
    current = 300;
    core.recordStage({ traceId: active, stage: "persisted" });
    current = 400;
    const newest = core.startTrace();
    expect(core.getTrace(active)).toHaveLength(1);
    expect(core.getTrace(dormant)).toEqual([]);
    expect(core.getTrace(newest)).toEqual([]);
    expect(core.snapshot().historyTruncated.tracesEvicted).toBe(1);
  });

  test("preserves incidents after bounded trace/event eviction and discloses truncated history", () => {
    let current = 100;
    const core = new DiagnosticsCore({
      now: () => current,
      maxTraces: 1,
      maxEventsPerTrace: 1,
      maxIncidents: 2,
    });
    const original = core.startTrace({ conversationId: "chat:private" });
    core.recordStage({ traceId: original, stage: "evaluated", outcome: "failed" });
    current = 200;
    core.recordStage({ traceId: original, stage: "media_inspection" });
    current = 300;
    const next = core.startTrace({ conversationId: "chat:other" });

    expect(core.getTrace(original)).toEqual([]);
    const snapshot = core.snapshot();
    expect(snapshot.incidents).toContainEqual({
      at: 100,
      traceId: original,
      stage: "evaluated",
      outcome: "failed",
    });
    expect(snapshot.historyTruncated).toMatchObject({
      incomplete: true,
      tracesEvicted: 1,
      eventsEvicted: 1,
      incidentsEvicted: 0,
    });

    core.recordStage({ traceId: next, stage: "sending", outcome: "uncertain" });
    current = 400;
    core.recordStage({ traceId: next, stage: "sending", outcome: "failed" });
    const bounded = core.snapshot();
    expect(bounded.incidents).toHaveLength(2);
    expect(bounded.incidents.some((incident) => incident.traceId === original)).toBe(false);
    expect(bounded.historyTruncated.incidentsEvicted).toBe(1);
  });

  test("erases old conversation incidents even after their trace was evicted", () => {
    let current = 100;
    const core = new DiagnosticsCore({ now: () => current, maxTraces: 1 });
    const traceId = core.startTrace({ conversationId: "chat:private" });
    core.recordStage({ traceId, stage: "evaluated", outcome: "failed" });
    current = 200;
    core.startTrace({ conversationId: "chat:other" });
    expect(core.snapshot().incidents.some((incident) => incident.traceId === traceId)).toBe(true);
    core.forgetConversation("chat:private");
    expect(core.snapshot().incidents.some((incident) => incident.traceId === traceId)).toBe(false);
  });

  test("does not allow downstream JavaScript callers to mutate the stage vocabulary", () => {
    const stages = DIAGNOSTIC_STAGES as unknown as string[];
    expect(() => stages.push("raw-private-message")).toThrow();
    const core = new DiagnosticsCore();
    const traceId = core.startTrace();
    expect(() => core.recordStage({ traceId, stage: "raw-private-message" as "received" })).toThrow();
  });
});
