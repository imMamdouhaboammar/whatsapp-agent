# PostgreSQL / Supabase offline data migration

This is an **offline data importer** for the existing WhatsApp Agent SQLite deployment. As of this stage, the live application **still runs on SQLite**. The PostgreSQL read/write adapters and cutover remain work in progress.

For the full design and gates, see [Migration plan](./plans/2026-11-06-postgresql-supabase-migration.md).

## Prerequisites

- Bun 1.4+ and access to the seven existing SQLite files in `DATA_DIR`
- A fresh, empty PostgreSQL database, or an empty Supabase Postgres database to which your server can connect
- A backend-only PostgreSQL connection URL in `DATABASE_URL`, provided through your shell/secret store. Hosted Supabase connections should use the documented TLS configuration and a direct or supported pooled connection
- Enough free storage for a separate backup of the source data and the new database
- One explicit brand ID assigned to legacy chats, since the old SQLite conversation tables lacked this field

Do not expose the database URL to the browser. This migration creates tables only inside the `wa_agent` schema and revokes access from PUBLIC. Do not add `wa_agent` to Supabase's exposed API schemas. Deploy with a restricted database role after verifying its grants.

## Procedure

1. Stop all application processes and workers that write to the SQLite files. Record a backup and test opening it. Keep the original SQLite directory untouched
2. Confirm the brand ID that owns legacy chats, such as `my-store`
3. Check that the source directory contains the files created by the app. The importer recognizes the older `brand-knowledge.sqlite` and `agent-customer-context.sqlite` names. If both an older and newer name exist for the same store, it stops so no records are silently left behind. It also reports absent optional databases and rejects incomplete or corrupt files
4. Run a read-only inspection, with no PostgreSQL connection required:

   ```sh
   bun run db:postgres --inspect --data-dir ./data --legacy-brand my-store
   ```

5. Set `DATABASE_URL` in the terminal environment or secret manager. Apply the private database schema:

   ```sh
   bun run db:postgres --schema
   ```

6. Run the importer in dry-run mode and compare all source counts and SHA-256 fingerprints against the previous inspection:

   ```sh
   bun run db:postgres --import --data-dir ./data --legacy-brand my-store
   ```

7. With the app still stopped, import once:

   ```sh
   bun run db:postgres --import --apply --data-dir ./data --legacy-brand my-store
   ```

8. The import runs inside one PostgreSQL transaction, checks that all 16 target tables are empty, inserts every legacy row with parameterized SQL, rechecks the source fingerprints, compares row counts and fingerprints in PostgreSQL, and records its success. Any failed check aborts the transaction
9. Verify results independently on a **disposable** destination and rehearse a PostgreSQL backup/restore. Do **not** change the application to PostgreSQL or delete SQLite files until runtime work and live integration tests are completed

## Data mapping

- `chats`, `messages`, `contact_dossiers`, `drafts`: new, required `brand_id` from `--legacy-brand`
- All other rows preserve their existing `brand_id` values
- Millisecond epoch fields use `BIGINT`; old JSON strings remain text; the original chunk IDs and source versions remain unchanged
- SQLite's `knowledge_fts` is a derived search index, excluded from transfer. The target creates a PostgreSQL GIN index on knowledge content

## Refusal conditions

- No source database exists, or a present database is incomplete/corrupt
- Blank/invalid legacy brand identity
- Any target table or prior successful import is present
- SQLite changes while importing, or PostgreSQL row counts/digests do not match
- PostgreSQL connection, DDL or DML fails

## Test verification

```sh
bun test tests/pg-migration.test.ts
bun test
bun run build
```

Optional live integration tests require a dedicated disposable `TEST_DATABASE_URL`, and must not point at a production or populated Supabase project. The importer is not a replication process or an online zero-downtime cutover tool.

## Rollback

If the importer fails, PostgreSQL data inserts roll back and SQLite is unchanged. If the importer succeeds, keep SQLite frozen until the PostgreSQL runtime is validated. Reverting the app to SQLite after PostgreSQL has accepted new messages will lose those newer messages unless a separately verified reverse-export procedure is available.
