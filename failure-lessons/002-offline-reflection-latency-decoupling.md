# FL-002: Decoupling Offline Reflection from Online Turn Latency

- **Failure Class:** Concurrency / Performance Regression
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (Decoupled Background Event Loop)
- **Primary Source:** `src/agent/reflection-worker.ts`
- **Quote:** `"في بيئة Bun، لا تجعل عملية التعلم تحدث أثناء رد البوت على رسالة الواتساب حتى لا يرتفع الـ Latency للعميل"` - User

---

## 1. Problem Description & Symptoms
Evaluating long-term memory using deep reasoning models (`gemini-4-argon` with `thinking_config: { thinking_level: 'HIGH' }`) consumes 5 to 15 seconds per call. If executed synchronously when handling inbound WhatsApp messages, customer response times degrade from <2 seconds to >15 seconds, breaking the conversational experience.

## 2. Root Cause Analysis
- Synchronous Coupling: Coupling cognition distillation (which is offline and reflective) to the real-time reply pipeline.
- Latency Bottlenecks: Reasoning chains with high thinking budgets cannot coexist on the critical path of interactive chat sockets.

## 3. Smart Solution & Architectural Rectification
1. **Sleep-Time Cleanup Architecture:**
   - Inspired by `tigerless-labs/agent-memory` and Anthropic Managed Agents.
   - The online socket pipeline simply ingests messages into SQLite WAL or PostgreSQL and answers the customer using the fast path (`ModeratorAgent`).
2. **Cold-Thread Detection:**
   - `ReflectionWorker` monitors conversational idle periods.
   - A thread is swept for reflection only after resolving or going cold (default 15 minutes of inactivity).
3. **Dedicated Moderation Feedback Queue:**
   - Explicit human actions (operator edits or draft rejections) are pushed to `wa_agent.learning_feedback_events` and evaluated during the offline reflection cycle.

## 4. Verification Proof
- `tests/reflection-learning.test.ts` (cold thread detection verified at 50ms threshold).
- `tests/engine-integration.test.ts` (instant WhatsApp socket response verified without reflection latency).
