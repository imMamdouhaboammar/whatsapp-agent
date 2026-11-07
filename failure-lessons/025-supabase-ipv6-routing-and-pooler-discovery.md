# FL-025: Supabase IPv6-Only Direct Host vs. IPv4 Supavisor Pooler Cluster Discovery

- **Failure Class:** Networking / Protocol & Infrastructure Mismatch
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`.env` Dual-URL Topology & `src/server/supabase.ts`)
- **Primary Source:** `.env`, `src/server/supabase.ts`, `tests/supabase-connection.test.ts`
- **Quote:** `"عايزك تتصل بقاعدة البيانات"` - User Request

---

## 1. Problem Description & Symptoms
When instructing the agent to connect to the Supabase database, executing connection attempts directly against `db.<project-ref>.supabase.co:5432` failed completely with:
```text
psql: error: could not translate host name "db.<project-ref>.supabase.co" to address: nodename nor servname provided, or not known
socket.gaierror: [Errno 8] nodename nor servname provided, or not known
nc: connectx to 2a05:d014:415:501::dc19 port 5432 (tcp) failed: No route to host
```
Furthermore, attempting an initial connection to the conventional default connection pooler hostname (`aws-0-eu-central-1.pooler.supabase.com:6543`) failed with:
```text
FATAL: (ENOTFOUND) tenant/user postgres.<project-ref> not found
```

## 2. Root Cause Analysis
- **Supabase Free/Standard Tier IPv6-Only Direct DNS:** Supabase allocates direct database hostnames (`db.<project-ref>.supabase.co`) with an exclusively `AAAA` record (`2a05:d014:415:501::dc19`). On typical consumer, office, or local development networks where IPv6 is not actively routed or where the OS DNS resolver defaults strictly to IPv4 `A` records (`flags: Request A records` in macOS `scutil --dns`), the direct hostname cannot be resolved or routed.
- **Dynamic Cluster Index Allocation in Supavisor:** Supabase distributes connection poolers across multiple regional cluster indices (`aws-0-`, `aws-1-`, `aws-2-`, etc.). Assuming index `0` for all projects causes tenant lookup failures because project `<project-ref>` is hosted on cluster index `1`.
- **Tenant Username Namespacing Requirement:** Connecting through the shared Supavisor pooler requires identifying the database tenant via the username format `postgres.<project-ref>`, not merely `postgres`.
- **URI Encoding of Special Characters:** Passwords containing delimiters like `?` break standard URI parsing unless percent-encoded as `%3F`.

## 3. Smart Solution & Architectural Rectification
1. **Dynamic Cluster Discovery:**
   - Evaluated IPv6 address geolocation to isolate AWS region (`Frankfurt / eu-central-1`).
   - Swept cluster indices `0` through `3` on `eu-central-1` to discover the exact live pooler endpoint: `aws-1-eu-central-1.pooler.supabase.com`.
2. **Dual-URL Connection Architecture in `.env`:**
   - Configured `DATABASE_URL` pointing to the IPv4 Session Pooler (Port `5432`):
     `postgresql://postgres.[PROJECT_REF]:[REDACTED_PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`
   - Configured `DATABASE_TRANSACTION_URL` for serverless runtimes (Port `6543`).
   - Configured `DATABASE_DIRECT_URL` preserving the direct IPv6 endpoint for environments with native IPv6 routing.
3. **Multi-Protocol Client Abstraction in `src/server/supabase.ts`:**
   - Exported `getSupabaseClient()` / `supabase` for PostgREST & Auth operations.
   - Exported `getPostgresClient()` / `sql` utilizing Bun's native `SQL` client over PostgreSQL wire protocol.
   - Authored `testDatabaseConnection()` performing dual-protocol health checks.

## 4. Verification Proof
- `Bun.sql` connected and executed `SELECT version(), current_database(), current_user` returning PostgreSQL 17.11.
- `tests/supabase-connection.test.ts` passed 2/2 tests asserting both REST API health and PostgreSQL wire protocol query execution.
- All repository tests remained green with zero regressions.
