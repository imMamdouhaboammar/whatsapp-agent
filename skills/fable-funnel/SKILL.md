---
name: fable-funnel
description: >
  High-throughput Scatter-Gather and Hedged Race API Funnel Engine for AI Agents and WhatsApp fleets.
  Dispatches concurrent requests across multi-target external APIs, ERPs, CRM webhooks, and LLM endpoints
  with bounded timeouts, automatic circuit breaking, and deterministic execution receipts.
version: "1.0.0"
author: "Mamdouh Aboammar"
license: "MIT"
metadata:
  runtime: "Bun / TypeScript"
  modes:
    - ALL_SETTLED
    - FIRST_SUCCESS
    - QUORUM
---

# Fable Funnel: Agentic Scatter-Gather & Hedged Race Engine

High-performance, fault-tolerant concurrent API gateway and tool dispatcher engineered for autonomous agents, WhatsApp multi-session fleets, and multi-provider LLM failover.

## Core Invariants

1. **Isolation Invariant**: An individual target timeout or HTTP error never fails sibling targets or the parent agent loop.
2. **Fast-Fail Circuit Breaker**: Tripped targets in `OPEN` state are bypassed immediately (0ms network delay), returning HTTP 503 fast-fail receipts.
3. **Hedged Race Invariant**: In `FIRST_SUCCESS` mode, the engine returns upon receiving the first 2xx response and immediately cancels pending sibling requests via `AbortController`.
4. **Deterministic Telemetry Receipt**: Every dispatch returns a structured receipt with millisecond durations, per-target status codes, data payloads, and error classifications.

## Available Execution Modes

| Mode | Behavior | Best Used For |
|:---|:---|:---|
| `ALL_SETTLED` | Concurrent scatter-gather across all enabled targets. Collects all responses. | Multi-warehouse inventory sync, multi-channel webhook broadcasts, CRM fan-out. |
| `FIRST_SUCCESS` | Concurrent hedged race. Cancels siblings on first success. | LLM latency optimization, redundant DNS/API lookup, primary vs fallback failover. |
| `QUORUM` | Requires at least $M$ of $N$ targets to succeed. | Consensus validation, multi-agent agreement, distributed approvals. |

## MCP Tool Invocation

The engine exposes the `whatsapp_funnel_scatter_gather` tool via Model Context Protocol:

```json
{
  "name": "whatsapp_funnel_scatter_gather",
  "arguments": {
    "method": "INVENTORY_DISPATCH",
    "payload": { "sku": "SKU-42" },
    "timeoutMs": 2000
  }
}
```

## REST API Endpoints

- `GET /api/funnel/methods` — List registered funnel methods and targets.
- `POST /api/funnel/methods` — Register or update a method configuration (requires API Key).
- `POST /api/funnel/dispatch` — Execute a scatter-gather or hedged race dispatch.
- `GET /api/funnel/stats` — Retrieve active circuit breaker states and call telemetry.
- `POST /api/funnel/circuit-breaker/reset` — Manually reset a tripped target breaker.
