# FL-055: Baileys Post-Pairing Credential Purging Loop

## Context
WhatsApp companion device pairing via `@whiskeysockets/baileys` and `WhatsAppSocketClient` in `src/transport/whatsapp-socket.ts`.

## What happened
When a user scanned the WhatsApp companion pairing QR code displayed in the UI, the mobile phone initiated the pairing sequence, displayed "جارٍ تسجيل الدخول..." ("Logging in..."), and then immediately aborted with a failure error. Simultaneously, the server log logged `[WhatsApp] Detected stale unregistered credentials with me populated. Auto-flushing session...`, cleared the session directory on disk, generated a brand new QR code, and returned to `qr_ready`. The user was trapped in an infinite login loop where mobile pairing repeatedly failed after scanning.

## Observable symptom
- Phone screen: "جارٍ تسجيل الدخول..." followed by "تعذر تسجيل الدخول" / pairing failure.
- Backend logs: `qr_ready` -> `connecting` -> `[WhatsApp] Detected stale unregistered credentials with me populated. Auto-flushing session...` -> `qr_ready`.
- UI modal repeatedly refreshed the QR code every time the user scanned.

## Impact
- Complete denial of service for WhatsApp socket authentication; no companion device could link or pair.
- Caused false assumptions that the user's phone had reached the linked device limit or that WhatsApp servers were rate-limiting, diverting engineering diagnosis away from the true code defect.

## Incorrect assumption
Assuming that any persisted credentials where `state.creds.me` is populated but `state.creds.registered === false` represent a corrupted or stale leftover session from a past logout that must be immediately purged.

## Root cause
- **Confirmed**: In `@whiskeysockets/baileys`, when the mobile device completes QR pairing, WhatsApp sends a `CB:iq,,pair-success` stanza. Baileys invokes `configureSuccessfulPairing`, populates `authState.creds.me`, and writes credentials to disk via `creds.update`. At this stage of the handshake, `creds.registered` remains `false`; it is only set to `true` later inside `messages-recv.js` upon receiving post-login handshake stanzas (`CB:success`). WhatsApp server then immediately requests a socket reconnect to complete registration. When `WhatsAppSocketClient.start()` re-entered during reconnect, the erroneous self-heal guard saw `me && !registered` and aggressively wiped `./data/session`. This destroyed the valid negotiated key bundle mid-handshake and forced a new QR code, breaking the mobile client's connection.

## Why the architecture allowed it
The self-heal check was added in commit `ad51389` to clean up dead sessions from past logouts without verifying whether the session was an active post-pairing handshake in progress (which has full key bundles and active pairing refs). Furthermore, session clearing was conflated with startup health checks rather than being strictly restricted to explicit `401 DisconnectReason.loggedOut` events.

## Fix
1. **Removed Erroneous Auto-Flush**: Deleted the speculative `state.creds?.me && !state.creds?.registered` session purge in `src/transport/whatsapp-socket.ts`.
2. **Strict Terminal Logout Boundary**: Confined session directory clearing strictly to explicit terminal logout events (`statusCode === DisconnectReason.loggedOut` / `401`) or explicit owner requests (`POST /api/disconnect { clearSession: true }`).

## Verification
1. Created unit regression test in `tests/whatsapp-session-refresh.test.ts`:
   - `does NOT auto-flush session during start() when me is populated and registered is false (FL-055 post-pairing reconnect)`
2. Verified with `bun test tests/whatsapp-session-refresh.test.ts` (passing 6/6 tests).
3. Verified live user pairing succeeded immediately following removal of the auto-flush block.

## Prevention rule
Never infer that `creds.me && !creds.registered` constitutes a stale session during startup in Baileys transports. In-flight post-pairing handshakes legitimately hold populated `me` identities prior to registration completion; session directory purging MUST be restricted strictly to explicit `401 DisconnectReason.loggedOut` events or explicit user disconnect requests.

## Reusable lesson
When integrating third-party protocol clients or state machines (like Baileys, libsignal, WebSockets), never assume intermediate lifecycle states are invalid or corrupt simply because a flag (like `registered`) has not yet flipped to `true`. Always trace the multi-step handshake protocol to verify when flags are transitioned before adding destructive "self-healing" purges.

## Related code
- `src/transport/whatsapp-socket.ts`
- `tests/whatsapp-session-refresh.test.ts`
- `node_modules/@whiskeysockets/baileys/lib/Socket/socket.js`
- `node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js`

## Related tests
- `tests/whatsapp-session-refresh.test.ts`

## Status
Resolved
