# S08: Health and Diagnostics

Priority P2 | Bun instrumentation; OpenTelemetry optional

## User problem

When a reply is slow, missing or awaiting approval, users need to see which stage stalled without opening raw logs or exposing personal chat content

## Trace stages

received -> persisted -> grouped -> evaluated -> policy_decided -> intent_created -> sending -> accepted -> receipt_updated

Media inspection and memory retrieval are optional child stages. Each trace uses an opaque correlation ID and event IDs, not message text, phone number or full media bytes

## Metrics to define

- Time from inbound persistence to policy decision
- Time from send intent creation to attempted call
- Number and age of uncertain send intents
- Receipt state distribution by version (aggregated, never fabricated read counts)
- Media worker timeouts and rejection counts
- Approval wait time and rejected/edited draft counts
- Reconnect frequency
- Evaluation case regressions by release

Collect baseline values before choosing alerts or hard performance SLOs. A dashboard without documented metric meanings is not acceptance evidence

## UI

- Compact status item in the relevant conversation's AI inspector
- Dedicated diagnostics page for recent failures and worker health
- RTL/LTR strings with accessible timestamps and severity labels
- Raw identifying values remain hidden by default; disclose only with user confirmation

## Acceptance tests

- Every outgoing intent maps to one trace ID across Bun and optional workers
- Raw message text and credentials never appear in telemetry
- Worker crash appears as degraded service with the core still responsive
- Correlation IDs remain stable during retries
- A disabled optional worker does not appear as an incident
- Clearing a conversation also cleans up user-identifying trace metadata according to configured retention
