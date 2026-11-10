# FL-038: Ponytail Forensic Audit Remediation, Transport Lifecycle & Fail-Closed Guardrails

## Context & Incident Trigger
A codebase-wide forensic audit (`/ponytail-audit`) against production invariants, SRE reliability standards, and application security guidelines discovered 14 vulnerabilities across authentication, socket transport, media transcoding, cloud fallbacks, memory lifecycles, and database access:
1. **Wildcard Dashboard Auth Interception**: `app.use('/api/*', ...)` in `dashboard-auth.ts` intercepted GitHub webhooks (`/api/webhooks/github`), Funnel API (`/api/funnel/dispatch`), and Brand Brain endpoints, returning 401 on external callers using API keys or HMAC signatures.
2. **Socket Disconnect Auto-Reconnect Loop**: `disconnect()` called `sock.end(undefined)`, firing Baileys `connection.update` with `connection: 'close'` where `statusCode === undefined`, triggering `shouldReconnect = true` and immediately scheduling a reconnection.
3. **Orphaned Reconnect Timer**: `setTimeout` for socket reconnect backoff was unmanaged and never cleared, causing concurrent connection collisions (Baileys error 440/515) upon manual reconnect.
4. **Sticker Studio 404 & Missing Endpoint**: The frontend called `POST /api/media/sticker`, but the server route was missing in `src/server/api.ts`.
5. **Hardcoded Google Cloud Project ID Leak**: `src/ai/voice-synthesizer.ts` contained a hardcoded fallback string `'project-3a53318f-795c-46b9-888'`.
6. **Vertex AI Fallback Bypass on HTML 502/503**: `res.json()` threw an uncaught `SyntaxError` when Vertex returned HTML error pages, bypassing `isFallbackEligibleError` and preventing secondary model failover.
7. **Unbounded Memory Leak in ReflectionWorker**: `activityMap` retained all past chat IDs indefinitely without eviction.
8. **Unbounded Table Scan in Brand Knowledge Retrieval**: Vector candidate retrieval queried all chunks without a SQL `LIMIT`.
9. **Fictitious Model Latency in Audio Transcriber**: Always attempted `gemini-3.5-transcribe` first (guaranteed 404) before falling back.
10. **Unchecked JSON.parse in Domain Layer**: Raw `JSON.parse` calls on `quoted_json`, `reactions_json`, `facts_json`, and `commitments_json` risked process crashes on malformed data.
11. **Corrupted Audio Delivery on FFmpeg Failure**: `transcodeWavToOpus` returned raw WAV data sent as Opus when ffmpeg failed.
12. **Permissive Funnel API Key Validation**: `validateKey()` returned `true` when `apiKeys.size === 0`, permitting unauthorized execution.

## Root Cause Analysis
- **Broad Wildcard Routing**: Applying blanket middleware without an exempt prefix list for non-session API routes.
- **Unchecked Socket Lifecycle State**: Failing to distinguish intentional user disconnects (`isExplicitlyClosed`) from transient network disconnects.
- **Unwrapped JSON Streams**: Parsing responses before checking HTTP status or catching JSON syntax errors.
- **Missing Fail-Closed Defaults**: Permitting zero-configured states to bypass access controls.

## Surgical Remediation & Invariants Enforced
1. **API Exemption Invariant**: Public webhook endpoints, Funnel engine dispatch, and brand APIs must explicitly be declared in `EXEMPT_PREFIXES`.
2. **Explicit Socket Disconnect Invariant**: Sockets must track `isExplicitlyClosed` and store the reconnect timer handle; `disconnect()` must cancel all pending timers and clear listeners before socket termination.
3. **Fail-Closed Security Policy Invariant**: When no API keys are configured in registries or limiters, access must fail closed (`return false`).
4. **Resilient Response Parsing Invariant**: HTTP clients must buffer response text first, parse JSON defensively, and attach HTTP status metadata to error instances.
5. **WhatsApp WebP Sticker Boundary**: All generated stickers must be converted via `cwebp` into WebP format strictly under 101,888 bytes (100 KB limit).
6. **Safe JSON Parsing Helper**: Database entities must parse JSON strings through `safeJsonParse<T>(raw, fallback)` with graceful default returns.

## Verification Proof
- `bun test`: 410 passed, 0 failed, 1 skipped across 106 test files (10.76s).
- `cd ui && bun test:ui`: 14 passed, 0 failed (4.53s).
- `cd ui && bun run build`: Clean Vite & TypeScript build with zero errors.
- `bun run security:audit`: Passed with 0 High/Critical vulnerabilities.
- `get-fable lint`: Passed with 0 errors.
