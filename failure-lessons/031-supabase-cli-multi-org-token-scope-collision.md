# FL-031: Supabase CLI Multi-Organization Token Scope Collision

- **Failure Class:** Authentication / Multi-Tenant Toolchain Isolation
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`supabase/.temp/project-ref` & Decoupled Configuration)
- **Primary Source:** `supabase/config.toml`, `supabase/.temp/project-ref`
- **Quote:** `"Your account does not have the necessary privileges to access this endpoint. For more details, refer to our documentation https://supabase.com/docs/guides/platform/access-control"` - Supabase CLI Error

---

## 1. Problem Description & Symptoms
When attempting to link the newly initialized Supabase project using the official CLI command:
```bash
supabase link --project-ref fqnuoomndmjdoqqkeugd
```
The command abruptly terminated with exit code 1:
```text
Target: project fqnuoomndmjdoqqkeugd
{"target":{"kind":"linked","project_ref":"fqnuoomndmjdoqqkeugd","environment":"unverified"},"_tag":"Error","error":{"code":"LinkProjectStatusError","message":"Unexpected error retrieving remote project status: {\"message\":\"Your account does not have the necessary privileges to access this endpoint...\"}"}}
```

## 2. Root Cause Analysis
- **Stored Global CLI Token Mismatch:** The developer machine's Supabase CLI held a cached personal access token from an earlier session associated with a different organization (`mdvdmjpzbcngrutngcre` owning `Oh-my-x-tweet` and `TEOLA`).
- **Authorization Boundary Failure:** When `supabase link` queried the Supabase Management API using the globally cached token to inspect project `fqnuoomndmjdoqqkeugd` (which belongs to user `user@example.com`), the API rejected the request with HTTP 403 Forbidden.
- **Fragile Coupling:** Tying local repository database configuration directly to external interactive CLI session tokens creates fragile workflows in multi-account environments.

## 3. Smart Solution & Architectural Rectification
1. **Direct On-Disk Project Reference Binding:**
   - Established the project ref in the canonical local file: [`supabase/.temp/project-ref`](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/supabase/.temp/project-ref), specifying `fqnuoomndmjdoqqkeugd`.
2. **Explicit Decoupling of Automation from CLI Login:**
   - Database migrations, schema inspection, and backend runtime code must utilize direct connection parameters (`DATABASE_URL` via the IPv4 pooler and `SUPABASE_SECRET_KEY`) rather than depending on global developer CLI session state.
3. **Actionable Developer Guidance:**
   - Documented that for interactive CLI migrations (`supabase db push`), the developer must run `supabase login` in an interactive terminal to switch tokens to the account owning `fqnuoomndmjdoqqkeugd`.

## 4. Verification Proof
- Backend runtime operations and integration tests in `tests/supabase-connection.test.ts` execute cleanly and authenticate against Supabase completely decoupled from the local CLI token state.
