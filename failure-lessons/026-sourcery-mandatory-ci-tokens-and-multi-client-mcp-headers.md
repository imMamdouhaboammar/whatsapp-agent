# FL-026: Sourcery Mandatory CI Token Authentication & Multi-Client Remote MCP Tri-Wiring

- **Failure Class:** Authentication & CI Pipeline Resilience / Multi-Client MCP Architecture
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** check ([.github/workflows/ci.yml](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.github/workflows/ci.yml), [~/.gemini/config/mcp_config.json](file:///Users/mamdouhaboammar/.gemini/config/mcp_config.json), [~/.codex/config.toml](file:///Users/mamdouhaboammar/.codex/config.toml), [~/.claude.json](file:///Users/mamdouhaboammar/.claude.json))
- **Primary Source:** `.github/workflows/ci.yml`, `.sourcery.yaml`, `mcp_config.json`
- **Quote:** `"Copy and paste the following snippet into your .yml file. - name: Sourcery Action uses: sourcery-ai/action@v1"` and `"sk_srcry_..."` - User Request

---

## 1. Problem Description & Symptoms
1. **CI Pipeline Hard Failure on Missing Token:** The official `sourcery-ai/action@v1` snippet copied into workflows fails at runtime if `with: token: ${{ secrets.SOURCERY_TOKEN }}` is not configured, or if the repository secret has not yet been populated by repository administrators. While Sourcery is free for open-source repositories, its CLI worker still mandates an authentication token.
2. **Heterogeneous MCP Client Schema Fragmentation:** When configuring a remote HTTP/SSE Model Context Protocol endpoint (such as `https://mcp.sourcery.ai/mcp`), client configuration schemas differ fundamentally across agent harnesses:
   - Antigravity / Gemini CLI expects `serverUrl` / `url` and a `headers` dictionary with `Authorization: Bearer <token>`.
   - Claude Code expects HTTP transport via `claude mcp add --transport http -s user sourcery <url> --header "Authorization: Bearer <token>"`.
   - OpenAI Codex expects `[mcp_servers.sourcery]` with `url = "..."` and `bearer_token_env_var = "SOURCERY_TOKEN"`.

## 2. Root Cause Analysis
- **Strict Worker Authentication:** Sourcery uses access tokens to fetch account permissions and manage rate limits even on public codebases.
- **Specification Inconsistencies Across MCP Implementations:** Different developer tools implement MCP client configuration in divergent formats (JSON vs TOML vs CLI commands).

## 3. Smart Solution & Architectural Rectification
1. **Resilient CI Step Configuration:**
   Add `continue-on-error: true` along with explicit token secret injection in `.github/workflows/ci.yml`:
   ```yaml
   - name: Sourcery Action
     uses: sourcery-ai/action@v1
     with:
       token: ${{ secrets.SOURCERY_TOKEN }}
     continue-on-error: true
   ```
2. **Author Canonical Project `.sourcery.yaml`:**
   Configure explicit ignores (`.git`, `.agents`, `node_modules`, `ui/dist`, `*.d.ts`) to avoid scanning noise.
3. **Tri-Wired Multi-Client Remote MCP Architecture:**
   - **Gemini / Antigravity (`~/.gemini/config/mcp_config.json`):**
     ```json
     "sourcery": {
       "serverUrl": "https://mcp.sourcery.ai/mcp",
       "url": "https://mcp.sourcery.ai/mcp",
       "headers": {
         "Authorization": "Bearer sk_srcry_...",
         "Accept": "application/json, text/event-stream"
       }
     }
     ```
   - **Claude Code (`~/.claude.json`):**
     Run `claude mcp add --transport http -s user sourcery https://mcp.sourcery.ai/mcp --header "Authorization: Bearer sk_srcry_..."`.
   - **Codex (`~/.codex/config.toml`):**
     ```toml
     [mcp_servers.sourcery]
     url = "https://mcp.sourcery.ai/mcp"
     bearer_token_env_var = "SOURCERY_TOKEN"
     ```
4. **Mandatory Service Account Registry Enforcement:**
   When credentials arrive, inject `SOURCERY_TOKEN` into `.env` (gitignored), document `SOURCERY_TOKEN=` in `.env.example`, and prompt the operator for the service account email before closing.

## 4. Verification Proof
- `sourcery` validated across `mcp_config.json`, `~/.claude.json`, and `~/.codex/config.toml`.
- `.github/workflows/ci.yml` passes `actionlint` and `yamllint`.
