import { createHmac, randomBytes, randomUUID } from "node:crypto";

/**
 * Bounded, in-memory S08 instrumentation. This module accepts only controlled
 * status values and keeps no message bodies, phone numbers or arbitrary labels.
 * A durable storage adapter and live send hooks are a separate integration step.
 */
export const DIAGNOSTIC_STAGES = [
  "received",
  "persisted",
  "grouped",
  "evaluated",
  "policy_decided",
  "intent_created",
  "sending",
  "accepted",
  "receipt_updated",
  "media_inspection",
  "memory_retrieval",
  "approval_requested",
  "approval_resolved",
] as const;

export type DiagnosticStage = (typeof DIAGNOSTIC_STAGES)[number];
export type DiagnosticOutcome = "ok" | "failed" | "timeout" | "rejected" | "uncertain" | "skipped";
export type WorkerKind = "media" | "reflection" | "evaluation" | "scheduler";
export type WorkerState = "healthy" | "degraded" | "crashed";
export type ReceiptState = "accepted" | "delivered" | "read";

export interface DiagnosticEvent {
  eventId: string;
  traceId: string;
  stage: DiagnosticStage;
  outcome: DiagnosticOutcome;
  at: number;
  receiptState?: ReceiptState;
}

export interface DiagnosticIncident {
  at: number;
  traceId?: string;
  stage?: DiagnosticStage;
  worker?: WorkerKind;
  outcome: "failed" | "timeout" | "rejected" | "uncertain" | "crashed" | "degraded";
}

export interface DiagnosticsSnapshot {
  health: "healthy" | "degraded";
  traceCount: number;
  eventCount: number;
  workers: Array<{ kind: WorkerKind; state: WorkerState | "disabled"; at: number }>;
  incidents: DiagnosticIncident[];
  metrics: {
    inboundDecisionLatencyMs: LatencySummary;
    sendQueueLatencyMs: LatencySummary;
    uncertainSends: { count: number; oldestAgeMs: number };
    receiptStates: Record<ReceiptState, number>;
  };
}

interface LatencySummary {
  samples: number;
  averageMs: number;
  maxMs: number;
}

interface TraceRecord {
  updatedAt: number;
  conversationDigest?: string;
  events: DiagnosticEvent[];
  firstSuccessfulStageAt: Partial<Record<DiagnosticStage, number>>;
  uncertainAt?: number;
  receipt?: ReceiptState;
}

const OUTCOMES: readonly DiagnosticOutcome[] = ["ok", "failed", "timeout", "rejected", "uncertain", "skipped"];
const WORKERS: readonly WorkerKind[] = ["media", "reflection", "evaluation", "scheduler"];
const WORKER_STATES: readonly WorkerState[] = ["healthy", "degraded", "crashed"];
const RECEIPTS: readonly ReceiptState[] = ["accepted", "delivered", "read"];
const RECEIPT_RANK: Record<ReceiptState, number> = { accepted: 1, delivered: 2, read: 3 };
const TRACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INCIDENT_OUTCOMES = new Set<DiagnosticOutcome>(["failed", "timeout", "rejected", "uncertain"]);

function permitted<T extends string>(value: T, values: readonly T[], label: string): void {
  if (!values.includes(value)) throw new TypeError(`Unsupported ${label}`);
}

function latencySummary(values: number[]): LatencySummary {
  if (values.length === 0) return { samples: 0, averageMs: 0, maxMs: 0 };
  return {
    samples: values.length,
    averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    maxMs: Math.max(...values),
  };
}

export class DiagnosticsCore {
  private readonly traces = new Map<string, TraceRecord>();
  private readonly workers = new Map<WorkerKind, { state: WorkerState | "disabled"; at: number }>();
  private readonly digestSecret = randomBytes(32);
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxTraces: number;
  private readonly maxIncidents: number;
  private readonly maxEventsPerTrace: number;

  constructor(options: {
    now?: () => number;
    retentionMs?: number;
    maxTraces?: number;
    maxIncidents?: number;
    maxEventsPerTrace?: number;
  } = {}) {
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    this.maxTraces = options.maxTraces ?? 1_000;
    this.maxIncidents = options.maxIncidents ?? 50;
    this.maxEventsPerTrace = options.maxEventsPerTrace ?? 256;
    for (const [label, value] of [
      ["retentionMs", this.retentionMs],
      ["maxTraces", this.maxTraces],
      ["maxIncidents", this.maxIncidents],
      ["maxEventsPerTrace", this.maxEventsPerTrace],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid ${label}`);
    }
  }

  /** Call once per inbound turn or send intent; reuse the same ID on retries. */
  startTrace(input: { traceId?: string; conversationId?: string } = {}): string {
    this.purgeExpired();
    const traceId = input.traceId ?? randomUUID();
    this.assertTraceId(traceId);
    const conversationDigest = input.conversationId === undefined
      ? undefined
      : this.conversationDigest(input.conversationId);

    const existing = this.traces.get(traceId);
    if (existing) {
      if (conversationDigest && existing.conversationDigest !== conversationDigest) {
        throw new Error("Trace belongs to another conversation");
      }
      return traceId;
    }

    while (this.traces.size >= this.maxTraces) {
      const oldest = this.traces.keys().next().value;
      if (!oldest) break;
      this.traces.delete(oldest);
    }
    this.traces.set(traceId, {
      updatedAt: this.timestamp(),
      conversationDigest,
      events: [],
      firstSuccessfulStageAt: {},
    });
    return traceId;
  }

  /** Projects known fields only, so untrusted input never becomes log metadata. */
  recordStage(input: {
    traceId: string;
    stage: DiagnosticStage;
    outcome?: DiagnosticOutcome;
  }): DiagnosticEvent {
    permitted(input.stage, DIAGNOSTIC_STAGES, "stage");
    const outcome = input.outcome ?? "ok";
    permitted(outcome, OUTCOMES, "outcome");
    return this.appendEvent(input.traceId, input.stage, outcome);
  }

  /** Receipt evidence is per trace, with no assumed aggregate group-read state. */
  recordReceipt(input: { traceId: string; state: ReceiptState }): DiagnosticEvent | undefined {
    permitted(input.state, RECEIPTS, "receipt state");
    const trace = this.requireTrace(input.traceId);
    if (trace.receipt && RECEIPT_RANK[trace.receipt] >= RECEIPT_RANK[input.state]) return undefined;
    const event = this.appendEvent(input.traceId, "receipt_updated", "ok", input.state);
    trace.receipt = input.state;
    trace.uncertainAt = undefined;
    return event;
  }

  /** Tracks optional worker health without retaining exception messages. */
  setWorker(input: { kind: WorkerKind; enabled: boolean; state: WorkerState }): void {
    permitted(input.kind, WORKERS, "worker");
    permitted(input.state, WORKER_STATES, "worker state");
    if (typeof input.enabled !== "boolean") throw new TypeError("Invalid worker enabled flag");
    this.workers.set(input.kind, {
      state: input.enabled ? input.state : "disabled",
      at: this.timestamp(),
    });
  }

  getTrace(traceId: string): DiagnosticEvent[] {
    this.assertTraceId(traceId);
    this.purgeExpired();
    return (this.traces.get(traceId)?.events ?? []).map((event) => ({ ...event }));
  }

  /** A conversation deletion is reflected in trace metadata immediately. */
  forgetConversation(conversationId: string): number {
    const digest = this.conversationDigest(conversationId);
    let removed = 0;
    for (const [traceId, trace] of this.traces) {
      if (trace.conversationDigest === digest) {
        this.traces.delete(traceId);
        removed++;
      }
    }
    return removed;
  }

  purgeExpired(): number {
    const now = this.timestamp();
    let removed = 0;
    for (const [traceId, trace] of this.traces) {
      if (now - trace.updatedAt > this.retentionMs) {
        this.traces.delete(traceId);
        removed++;
      }
    }
    return removed;
  }

  snapshot(): DiagnosticsSnapshot {
    this.purgeExpired();
    const now = this.timestamp();
    const decisionLatencies: number[] = [];
    const sendLatencies: number[] = [];
    const receiptStates: Record<ReceiptState, number> = { accepted: 0, delivered: 0, read: 0 };
    const incidents: DiagnosticIncident[] = [];
    let uncertainCount = 0;
    let oldestAgeMs = 0;
    let eventCount = 0;

    for (const [traceId, trace] of this.traces) {
      eventCount += trace.events.length;
      const firstTimestamp = (stage: DiagnosticStage) => trace.firstSuccessfulStageAt[stage];
      const persistedAt = firstTimestamp("persisted");
      const decisionAt = firstTimestamp("policy_decided");
      if (persistedAt !== undefined && decisionAt !== undefined && decisionAt >= persistedAt) {
        decisionLatencies.push(decisionAt - persistedAt);
      }
      const intentAt = firstTimestamp("intent_created");
      const sendingAt = firstTimestamp("sending");
      if (intentAt !== undefined && sendingAt !== undefined && sendingAt >= intentAt) {
        sendLatencies.push(sendingAt - intentAt);
      }

      if (trace.receipt) receiptStates[trace.receipt]++;
      for (const event of trace.events) {
        if (INCIDENT_OUTCOMES.has(event.outcome)) {
          incidents.push({
            at: event.at,
            traceId,
            stage: event.stage,
            outcome: event.outcome as DiagnosticIncident["outcome"],
          });
        }
      }
      if (trace.uncertainAt !== undefined) {
        uncertainCount++;
        oldestAgeMs = Math.max(oldestAgeMs, Math.max(0, now - trace.uncertainAt));
      }
    }

    const workers: DiagnosticsSnapshot["workers"] = [];
    let degraded = false;
    for (const [kind, worker] of this.workers) {
      workers.push({ kind, state: worker.state, at: worker.at });
      if (worker.state === "disabled" || worker.state === "healthy") continue;
      degraded = true;
      incidents.push({
        worker: kind,
        at: worker.at,
        outcome: worker.state,
      });
    }

    incidents.sort((a, b) => a.at - b.at);
    return {
      health: degraded ? "degraded" : "healthy",
      traceCount: this.traces.size,
      eventCount,
      workers,
      incidents: incidents.slice(-this.maxIncidents),
      metrics: {
        inboundDecisionLatencyMs: latencySummary(decisionLatencies),
        sendQueueLatencyMs: latencySummary(sendLatencies),
        uncertainSends: { count: uncertainCount, oldestAgeMs },
        receiptStates,
      },
    };
  }

  private appendEvent(
    traceId: string,
    stage: DiagnosticStage,
    outcome: DiagnosticOutcome,
    receiptState?: ReceiptState,
  ): DiagnosticEvent {
    const trace = this.requireTrace(traceId);
    const at = this.timestamp();
    const event: DiagnosticEvent = {
      eventId: randomUUID(),
      traceId,
      stage,
      outcome,
      at,
    };
    if (receiptState) event.receiptState = receiptState;
    trace.events.push(event);
    if (outcome === "ok" && trace.firstSuccessfulStageAt[stage] === undefined) {
      trace.firstSuccessfulStageAt[stage] = at;
    }
    // An ambiguous network attempt remains unresolved until affirmative evidence.
    if (stage === "sending" && outcome === "uncertain" && trace.uncertainAt === undefined) {
      trace.uncertainAt = at;
    }
    if (stage === "accepted" && outcome === "ok") {
      trace.uncertainAt = undefined;
      if (!trace.receipt) trace.receipt = "accepted";
    }
    if (trace.events.length > this.maxEventsPerTrace) {
      trace.events.splice(0, trace.events.length - this.maxEventsPerTrace);
    }
    trace.updatedAt = at;
    return { ...event };
  }

  private requireTrace(traceId: string): TraceRecord {
    this.assertTraceId(traceId);
    this.purgeExpired();
    const trace = this.traces.get(traceId);
    if (!trace) throw new Error("Unknown or expired trace");
    return trace;
  }

  private conversationDigest(conversationId: string): string {
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      throw new TypeError("Invalid conversation ID");
    }
    return createHmac("sha256", this.digestSecret).update(conversationId).digest("hex");
  }

  private assertTraceId(traceId: string): void {
    if (typeof traceId !== "string" || !TRACE_ID.test(traceId)) {
      throw new TypeError("Trace IDs must be opaque UUIDs");
    }
  }

  private timestamp(): number {
    const now = this.now();
    if (!Number.isFinite(now) || now < 0) throw new RangeError("Invalid diagnostics clock");
    return now;
  }
}
