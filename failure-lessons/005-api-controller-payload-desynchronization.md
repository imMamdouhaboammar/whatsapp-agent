# FL-005: API Controller Payload Field Desynchronization

- **Failure Class:** API / Contract Drift
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Test (`tests/reflection-learning.test.ts`) & Structure (`src/server/api.ts`)
- **Primary Source:** `src/server/api.ts`
- **Quote:** `TypeError: null is not an object (evaluating 'recordedFeedback.feedbackType')` - tool

---

## 1. Context
During integration testing of the WhatsApp supervisor cockpit, human operator approval actions in the UI `/api/drafts/:draftId/approve` allow moderators to review, edit, or reject AI-generated drafts.

## 2. What Happened
The automated integration test suite submitted operator approval with `body.replyText`, while the endpoint only extracted `body.editedText`. Because neither was unified, the backend treated the feedback as empty, leaving `recordedFeedback` null and causing the learning worker to drop the human revision event.

## 3. Observable Symptom
`TypeError: null is not an object (evaluating 'recordedFeedback.feedbackType')` during test execution in `tests/reflection-learning.test.ts`.

## 4. Impact
Human moderator corrections to AI replies were dropped without being recorded into long-term reflection queues, preventing the reflection engine from learning from operator edits.

## 5. Incorrect Assumption
Assumed incoming HTTP payloads would strictly use the internal property name `editedText`, ignoring that frontend and client components often submit `replyText` or standard form names.

## 6. Root Cause
**Confirmed**: The route handler in `src/server/api.ts` strictly looked for `body.editedText` without fallback to `body.replyText` or `draft.proposedReply`, causing `recordApprovalFeedback` to return `null` when a caller used the alternate field name.

## 7. Why the Architecture Allowed It
The request validation layer did not use a unified Zod/Pydantic-style schema normalizer to coerce payload aliases before hitting the controller logic.

## 8. Fix
Updated `src/server/api.ts` to normalize operator reply text across aliases:
```typescript
const finalReply = body.editedText || body.replyText || draft.proposedReply;
```
Ensured `recordApprovalFeedback` is invoked with `finalReply` whenever the draft is approved or modified.

## 9. Verification
- `bun test tests/reflection-learning.test.ts` passes with both `editedText` and `replyText` assertions.
- Verified that `recordedFeedback.feedbackType === 'edit'` is preserved.

## 10. Prevention Rule
Inbound REST controllers receiving operator input must support standard payload synonyms (`editedText` and `replyText`) through explicit schema normalization before business logic dispatch.

## 11. Reusable Lesson
When building human-in-the-loop workflows where UI components and test harnesses interact with the same API, accept canonical aliases at the boundary to prevent silent dropped telemetry.

## 12. Related Code
- `src/server/api.ts`
- `src/agent/reflection-worker.ts`

## 13. Related Tests
- `tests/reflection-learning.test.ts`

## 14. Related Lessons
- [002-offline-reflection-latency-decoupling.md](002-offline-reflection-latency-decoupling.md)

## 15. Status
**Resolved**
