# FL-017: React Doctor Transport & SSE Event Stream Hardening

- **Failure Class:** Frontend Architecture / Resilience & Performance
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Structure
- **Primary Source:** `ui/src/api/client.ts`, `ui/src/App.tsx`, `ui/src/components/ChatList.tsx`
- **Quote:** `"47 issues found across 16 files (30 Bugs, 6 Performance, 6 Maintainability, 5 Accessibility)"` - React Doctor CLI

---

## 1. Problem Description & Symptoms
Running `react-doctor` on `ui/` revealed 47 latent defects. The most critical defects were:
1. Direct, unchecked JSON parsing on `fetch()` responses without validating `res.ok`, which causes unhandled JSON parse or property read exceptions when the backend returns 4xx/5xx HTML or text error pages.
2. Naked `JSON.parse(e.data)` in real-time Server-Sent Event (SSE) event handlers (`message_status`, `agent_thought`, `draft_updated`), causing immediate frontend crashes if a malformed payload or keepalive ping arrives.
3. Unnecessary $O(N)$ lookup algorithms inside hot list rendering paths (`pendingDraftChatIds.includes(chat.id)`).
4. Handler-only state triggers causing redundant render cycles.

## 2. Root Cause Analysis
- **Implicit Happy-Path Transport Calls:** Developers often assume `fetch()` throws on HTTP error status codes (400, 401, 500). In reality, `fetch()` resolves successfully on any HTTP response; only network failures reject the promise. Consuming `await res.json()` unconditionally causes cryptic errors.
- **Unshielded Event Stream Handlers:** SSE listeners execute outside React error boundaries. An unhandled exception inside an `addEventListener` handler can break the listener or crash the host tab.
- **Render-Loop Performance Overhead:** Using arrays for frequent membership checks inside `.map()` runs in $O(N \times M)$ time.

## 3. Smart Solution & Architectural Rectification
1. **Centralized Safe Transport Helper:**
   - Implemented `handleResponse<T>(res: Response): Promise<T>` in `ui/src/api/client.ts` that explicitly asserts `if (!res.ok) throw new Error(...)` before reading JSON across all 23 API methods.
2. **Resilient SSE Stream Parsers:**
   - Wrapped all SSE event payload decoders in `try/catch` blocks in `ui/src/App.tsx`, discarding or logging malformed frames without crashing UI state.
3. **$O(1)$ Membership Sets:**
   - In `ChatList.tsx`, memoized `pendingDraftChatIds` as a `Set<string>` via `useMemo(() => new Set(pendingDraftChatIds), [pendingDraftChatIds])`, reducing membership checks to $O(1)$.
4. **State to Ref Conversion:**
   - Converted `policy` state (used only inside event handlers and never rendered in JSX) into a React `useRef`, preventing unnecessary component rerenders on policy updates.

## 4. Verification Proof
- `react-doctor` re-run confirmed all 30 bugs, 6 performance warnings, and 5 accessibility issues were resolved (0 bugs, 0 performance warnings).
- `cd ui && bun test:ui` passed 13/13 SSR tests across Arabic RTL and English LTR without regressions.
- `cd ui && bun run build` built the Vite client cleanly in 642ms.
