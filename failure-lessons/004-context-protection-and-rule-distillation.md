# FL-004: Context Window Protection via Rule Compaction

- **Failure Class:** LLM / Context Limits & Latency Degradation
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (Threshold Monitoring & Automatic Distillation)
- **Primary Source:** `src/domain/learning-memory.ts` and `src/ai/reflection-engine.ts`
- **Quote:** `"حماية الـ Context: لأن التفاعل مستمر، ملف workbook.md قد ينمو. وجّه الـ Agent دائماً لعمل مختصرات وتكثيف (Distillation/Compression) للقواعد القديمة"` - User

---

## 1. Problem Description & Symptoms
In continuous self-correcting agents, each detected failure can generate a new counter-rule. Over weeks of production interactions, `workbook.md` can swell to hundreds of fragmented, overlapping, or obsolete rules. Injecting this growing block into every inbound WhatsApp prompt consumes context budget, inflates inference cost, slows token generation, and confuses the model.

## 2. Root Cause Analysis
- Unbounded Additive Growth: Adding rules without an automatic garbage collection or consolidation mechanism.
- Context Contamination: Redundant and conflicting micro-rules dilute primary system instructions.

## 3. Smart Solution & Architectural Rectification
1. **Compaction Guard (`needsCompaction`):**
   - Monitors two safety thresholds: rule count (default max: 15) and estimated token volume (default max: 2,500 tokens).
2. **LLM Distillation Engine (`performCompaction`):**
   - When thresholds are breached, the Reflection Engine invokes `gemini-4-argon` to synthesize all accumulated rules into 5 to 8 non-redundant, high-density imperatives (starting with `ALWAYS` or `NEVER`).
3. **Atomic Replacement & Archival:**
   - Consolidated rules replace verbose logs in `workbook.md`, and are updated in PostgreSQL with incremented version numbers.

## 4. Verification Proof
- `tests/reflection-learning.test.ts` test case `"flags context compaction when rules exceed safety threshold"`.
