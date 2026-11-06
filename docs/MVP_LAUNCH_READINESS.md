# WhatsApp Agent: MVP launch readiness

Updated: 2026-11-06

## Product contract

A business can run its own WhatsApp assistant, retain its business data in an instance it controls, answer customers autonomously, and step in where human judgment is needed. The core repository is available under MPL-2.0. Optional paid extensions are a later commercial offering.

This document distinguishes implemented features, verified tests, and work still needed for an external pilot. Do not present an unverified integration as working.

## Current verified slice

| Area | Current evidence | Pilot decision |
| --- | --- | --- |
| Dashboard access | Owner token, HttpOnly SameSite cookie, logout, API and SSE auth tests | Implemented for single-owner self-hosted deployments |
| Network exposure | Loopback works without a token, non-loopback bind rejects weak/missing owner token | Implemented, HTTPS reverse proxy still needs live deployment validation |
| Assistant preview | Random isolated simulator identity, dry-run on contact facts, commitments, style and drafts; no message send or event broadcast | Implemented in unit/integration tests, requires real configured-model check |
| Owner UX | Arabic/English login, responsive settings shell, bilingual preview, explicit sign-out | SSR, build, and browser smoke verified |
| Live dashboard events | SSE heartbeat every 5 seconds; functional stream test and 19-second browser observation without reconnect | Verified locally; confirm through the production reverse proxy |
| Customer memory | Contact dossier, explicit memory, conversational style, MCP/API methods | Core tests verified; tenant and privacy review is ongoing |
| Agent behavior | Autonomous reply, drafts, human handoff, permissions, contact context | Tests verified; live business account acceptance is pending |
| Business knowledge | Brand knowledge and retrieval paths exist | Evaluate against actual product catalogs and conflicting data |
| Hosting data | SQLite runtime; PostgreSQL schema and offline import implemented with mocked DB contract tests | PostgreSQL runtime, live database verification and cutover are pending |
| Messaging transport | Existing WhatsApp socket integration | Live compatibility, recovery, and account-policy risks need pilot validation |

### Verified checks

- Bun backend tests and UI SSR tests run from the independent sprint branch
- Production UI build runs with Bun
- Real local browser smoke checks owner login, protected settings, sign-out and re-login
- Tests are model-stubbed except where explicitly stated; they do not prove live WhatsApp delivery or live model quality

## Pilot acceptance criteria

- [ ] Fresh installation on a clean host without developer intervention beyond published setup steps
- [ ] Choose PostgreSQL connection or Supabase project, run migrations and verify isolated business data
- [ ] Upload/maintain business knowledge with source date, priority and conflict review
- [ ] Connect a permitted WhatsApp business channel, recover from disconnect and verify inbound/outbound messages
- [ ] Prove autonomous customer replies, escalation and owner takeover with real business scenarios
- [ ] Preview realistic customer cases and confirm zero contact-data side effects
- [ ] Verify backups, restore, export/delete of customer data and clear retention settings
- [ ] Check HTTPS, token rotation, rate controls, audit logs and multi-user roles before exposing publicly
- [ ] Run Arabic RTL, English LTR, keyboard accessibility, mobile viewport and slow-network checks
- [ ] Write installation, troubleshooting and upgrade guides for early business pilots

## Platform boundaries

Meta's native ad-origin targeting, catalog enrichment and other first-party integration data cannot be assumed available to a self-hosted third-party implementation. Any equivalent feature must be tied to an actually supported, permissioned integration. Marketing materials should say which channel and data sources were tested.

## Business rollout

Offer the base application free under MPL-2.0. Pilot businesses pay their own host, database and AI API costs. The seller can provide one-time assisted setup and training during the limited beta. Extensions and skills may be sold later with separate licensing and clear compatibility terms.

## Current release call

**Engineering preview, not yet external-pilot ready.** The core direction is tangible and the new owner-security/privacy slice is verified. Production hosting, PostgreSQL/Supabase and a live channel pilot remain launch gates.
