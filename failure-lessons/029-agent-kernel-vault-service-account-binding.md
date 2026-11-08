# FL-029: Agent Kernel Vault Service Account Binding & Permission Drift Hygiene

- **Failure Class:** Tooling / CLI Router Subcommand Discrepancy & File Permissions
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`~/.agent-kernel/service-accounts.json` & `agent-kernel env push`)
- **Primary Source:** `~/.agent-kernel/service-accounts.json`, `.agent-kernel/skills/agent-kernel-ops/SKILL.md`
- **Quote:** `"بعد ما تخلص اربطه ب agent-kernel vault ب الايميل : user@example.com"` - User Prompt

---

## 1. Problem Description & Symptoms
When attempting to execute the documented constitutional instruction to register a third-party service account email using `agent-kernel env set-account supabase user@example.com`, the command immediately exited with error:
```text
Unknown Environment Vault command: set-account
```
Subsequent vault status inspections via `agent-kernel env status` also reported permission anomalies:
```text
- .env: PERMISSION_DRIFT
- ui/.env: PERMISSION_DRIFT
```

## 2. Root Cause Analysis
- **CLI Router Delegation Boundary:** The `agent-kernel` CLI routes top-level `env` invocations to `agent-kernel-env-vault.mjs`, which specifically implements vault lifecycle subcommands (`link`, `push`, `pull`, `status`, `doctor`, `history`, `restore`, `purge`). The `set-account` command was documented in agent skill instructions as a conceptual shorthand, but was not registered in the underlying vault argument parser.
- **Service Account Storage Substrate:** Agent Kernel persists third-party service account email bindings directly inside `~/.agent-kernel/service-accounts.json`.
- **Octal File Permission Drift (0644 vs 0600):** Newly authored or edited `.env` files inherit the default user `umask` (yielding `0644`), which conflicts with Agent Kernel's strict cryptographic requirement that environment files containing sensitive secrets must declare `0600` (`-rw-------`).

## 3. Smart Solution & Architectural Rectification
1. **Canonical Registry Commitment:**
   - Updated `~/.agent-kernel/service-accounts.json` directly with both service-level and project-namespaced keys:
     ```json
     {
       "supabase:whatsapp-agent": "user@example.com",
       "supabase:fqnuoomndmjdoqqkeugd": "user@example.com"
     }
     ```
2. **Project Vault Linking:**
   - Linked repository environment files via `agent-kernel env link .`, binding `.env` and `ui/.env` under the canonical identity `remote:github.com/immamdouhaboammar/whatsapp-agent`.
3. **Automated Permission Remediation:**
   - Applied `chmod 600 .env ui/.env` prior to pushing revisions, eliminating permission drift.
   - Executed `agent-kernel env push .` to commit cryptographic snapshots to the vault.

## 4. Verification Proof
- `agent-kernel env status` returned:
  ```text
  Environment Vault status
  Linked: YES
  Healthy: YES
  - .env: IN_SYNC
  - ui/.env: IN_SYNC
  ```
- Verified `~/.agent-kernel/service-accounts.json` accurately reflects the user's provided Supabase account email without guessing.
