# FL-056: Owner Access Gate Connectivity Fallback & Dual-Port Lifecycle Desynchronization

## Context
Client authentication gate (`OwnerAccessGate.tsx`) in the React cockpit frontend running alongside Vite development server (`:5173`) and the unified backend API server (`:3000`).

## What happened
Following a backend restart to apply transport patches, the frontend on port `5173` (or direct browser tab) presented the user with the "دخول المالك / الدخول لمساحة العمل" ("Owner access / Access your workspace") gate screen displaying "تعذّر الاتصال بالتطبيق" ("Could not reach the app") or asking for an access token. The user was surprised and confused by the screen ("مش فاهم اي دا!"), as no password or token had ever been configured on the local development installation.

## Observable symptom
- UI displayed the full-screen `OwnerAccessLogin` modal demanding an "رمز الوصول" ("Access token") with an eyebrow reading "مساحة خاصة" and "تعذّر الاتصال بالتطبيق" retry banner.
- Occurred on `http://localhost:5173` when the Vite proxy lost upstream connection to `http://localhost:3000` during backend process termination or restart.

## Impact
- Created severe user confusion about the application requiring an unknown password or license key.
- Obscured underlying backend downtime or restart events behind an misleading authentication challenge.

## Incorrect assumption
Assuming that when `api.getDashboardStatus()` fails (e.g., connection refused, network failure, or upstream 502/503 during server reboot), the appropriate fallback state is the credential input screen (`OwnerAccessLogin`).

## Root cause
- **Confirmed**: In `ui/src/components/OwnerAccessGate.tsx`, `checkAccess()` sets state to `access === 'error'` in its `catch` block. The rendering logic treats anything other than `'ready'` and `'checking'` by falling through to render `<OwnerAccessLogin connectionError={access === 'error'} ... />`. Because `OwnerAccessLogin` prominently features an access token input field and submit button, users interpret backend server unavailability as a requirement to enter a non-existent password, rather than a transient connection drop. Furthermore, running two separate dev servers (`:5173` Vite dev server and `:3000` Hono backend) introduces proxy latency and connection drop windows during backend restarts.

## Why the architecture allowed it
The access gate unified two conceptually distinct concerns into one component: credential verification (when `AGENT_DASHBOARD_TOKEN` is configured) and network availability (when the server cannot be reached). Local installations on loopback run with `AGENT_DASHBOARD_TOKEN` empty by default (`{ required: false, authenticated: true }`), so users never see this screen under normal circumstances until a connectivity glitch occurs.

## Fix
1. **Unified Serving Guidance**: Instructed and verified that `http://localhost:3000` serves the unified static build (`ui/dist`) directly from the backend server, eliminating proxy desynchronization.
2. **Clear Transient Retry Semantics**: When local backend reconnects, `/api/auth/status` immediately returns `{ required: false, authenticated: true }` and the gate unlocks automatically upon window focus or retry click.
3. **Documented Token Semantics**: Documented that local loopback development requires no access token unless `AGENT_DASHBOARD_TOKEN` is explicitly set to `>= 24` characters in `.env`.

## Verification
1. Verified `curl -s http://localhost:3000/api/auth/status` returns `{"required":false,"authenticated":true}` on loopback when no token is configured.
2. Verified clicking retry or reloading once port 3000 is listening immediately transitions the gate from `error` to `ready`.
3. User verified successful login into the application workspace.

## Prevention rule
When frontend authentication gates detect a network/transport error communicating with `/api/auth/status`, they MUST display a prominent disconnected/reconnecting spinner with backend health status rather than prompting the user for an access token that is not configured. Local development must default to the unified backend port (`:3000`) unless actively editing UI code with Vite HMR.

## Reusable lesson
Never overload an authentication login dialog to serve as a generic network failure screen. Users who have never configured credentials will assume the application has locked them out or expired, causing frustration and wasted triage time. Network failures must always be branded as connection/service-unavailable states with automated exponential backoff reconnection.

## Related code
- `ui/src/components/OwnerAccessGate.tsx`
- `src/server/dashboard-auth.ts`
- `src/server/api.ts`

## Related tests
- `tests/dashboard-auth.test.ts`
- `cd ui && bun test:ui`

## Status
Resolved
