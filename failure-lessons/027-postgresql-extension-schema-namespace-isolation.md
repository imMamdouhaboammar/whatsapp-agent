# FL-027: PostgreSQL Extension Schema Namespace Isolation (The `pgmq` Schema Invariant)

- **Failure Class:** Database / Schema Namespace Enforcement
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Migration (`supabase/migrations/20261107000000_enable_agent_extensions.sql`)
- **Primary Source:** `supabase/migrations/20261107000000_enable_agent_extensions.sql`
- **Quote:** `"FAILED - extension "pgmq" must be installed in schema "pgmq""` - PostgreSQL Error

---

## 1. Problem Description & Symptoms
When activating the suite of database extensions required for agentic operation in Supabase (`vector`, `pg_trgm`, `unaccent`, `pg_net`, `pg_graphql`, `pg_jsonschema`, `pgmq`, etc.), applying the standard Supabase convention of targeting the `extensions` schema (`CREATE EXTENSION IF NOT EXISTS "pgmq" WITH SCHEMA "extensions";`) abruptly failed:
```text
pgmq: FAILED - extension "pgmq" must be installed in schema "pgmq"
```
While other extensions cleanly installed into `extensions`, `pgmq` failed to activate.

## 2. Root Cause Analysis
- **Hardcoded Schema Namespace Constraints in Extension Control Files:** Most standard PostgreSQL extensions are relocatable or default to the caller's target schema. However, certain extensions—notably `pgmq`—explicitly declare `schema = 'pgmq'` in their `.control` file to maintain internal queue isolation and avoid collision with public user tables.
- **Flawed Monolithic Assumption:** Automated setup scripts often assume that because Supabase provides an `extensions` schema, all extensions should be blindly forced into `WITH SCHEMA extensions`.

## 3. Smart Solution & Architectural Rectification
1. **Explicit Dedicated Schema Creation:**
   - Execute an explicit schema creation before installing namespace-bound extensions:
     ```sql
     CREATE SCHEMA IF NOT EXISTS pgmq;
     CREATE EXTENSION IF NOT EXISTS pgmq WITH SCHEMA pgmq;
     ```
2. **Schema-Aware Migration Definition in [`supabase/migrations/20261107000000_enable_agent_extensions.sql`](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/supabase/migrations/20261107000000_enable_agent_extensions.sql):**
   - Partition extensions into their proper architectural namespaces:
     - `extensions`: `vector`, `pg_trgm`, `unaccent`, `btree_gist`, `btree_gin`, `pgcrypto`, `uuid-ossp`, `pg_net`, `pg_jsonschema`, `pg_stat_statements`.
     - `graphql`: `pg_graphql`.
     - `pgmq`: `pgmq`.
     - `pg_catalog`: `pg_cron`, `plpgsql`.
     - `vault`: `supabase_vault`.

## 4. Verification Proof
- Queried `pg_extension` and `pg_namespace` catalogs verifying all 15 extensions active and mapped to their compliant schemas.
- Verified `tests/supabase-connection.test.ts` passed 100%.
