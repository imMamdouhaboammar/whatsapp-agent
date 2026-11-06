# Replica Recon: KraytonOG/funnel-script

## 1. Provenance & Cryptographic Evidence Ledger
* **Source Repository**: `https://github.com/KraytonOG/funnel-script`
* **Commit Analyzed**: `master` (`47101c402120e2ef59c991b1faae98b2555aa88a`)
* **Files Inspected**:
  * `README.md` (SHA-256: `6eef40d425c277bf27a05da26b0a7c41eb47b85e054ba0db628a55e2d6b359dc`)
  * `api.php` (SHA-256: `d3b1e36fa78e1c66dfceea287413cfbfcb47eef090d85ef4dc08e8b0fbbe1f4c`)
* **Core Technology**: PHP 7/8 with `php-curl` (`curl_multi_*` APIs).

---

## 2. Inferred Behavioral Contract & Mechanics

### Ingress Parameters (HTTP GET)
| Parameter | Type | Required | Description |
|:---|:---|:---|:---|
| `key` | string | Yes | Pre-shared API key matching `$ray` array (`APIKEY`). |
| `host` | string | Yes | Target host/IP for upstream API query. |
| `port` | integer | Yes | Target destination port. |
| `time` | integer | Yes | Duration/timeout in seconds. Hard cap: `<= 1000`. |
| `method` | string | Yes | Funnel method key (`NTP-FNL`, `LDAP-FNL`). |

### Method Resolution & URL Expansion
```text
method == "NTP-FNL"  --> [ http://serverip1/api.php?key=apikey&host=...&port=...&time=...&method=NTP ]
method == "LDAP-FNL" --> [ http://serverip1/...&method=LDAP, http://serverip2/...&method=LDAP ]
```

### Execution Loop
1. Initialized via `curl_multi_init()`.
2. Adds $N$ individual cURL handles with `CURLOPT_CONNECTTIMEOUT=1` and `CURLOPT_TIMEOUT=1`.
3. Non-blocking execution loop via `curl_multi_exec($mh, $stillRunning)` until all requests finish.
4. Extracts response body (`curl_multi_getcontent`) and HTTP status (`CURLINFO_HTTP_CODE`).
5. Handles are detached, closed, and multi handle is closed.
6. Returns plaintext execution confirmation string.

---

## 3. Structural Vulnerabilities & Slop in Original Code
1. **Security Vulnerability**: SQL/Command/Parameter injection via unsanitized `$_GET` parameters concatenated directly into outbound URLs without URL encoding.
2. **Hardcoded Credentials & Config**: Hardcoded keys in source array (`$ray = array("APIKEY")`), hardcoded server IPs (`serverip1`).
3. **Fragile Concurrency**: Tight polling loop `do { curl_multi_exec(...) } while ($stillRunning)` without `curl_multi_select()` burns CPU 100% on high-load servers.
4. **Poor Error Handling**: `die()` halts the entire script on invalid input; zero granular failure logging or per-target retry logic.
5. **No Circuit Breaking**: Outages on `serverip1` block and timeout every caller, leading to cascading failures.

---

## 4. Re-imagining for Fable Agentic WhatsApp
Transforming this basic PHP booter/stresser scatter-gather script into an enterprise **Agentic Multi-Target Scatter-Gather API Funnel**:
* **Runtime**: Bun + TypeScript (Native async/await, non-blocking fetch, Web Standards).
* **Architecture**: High-Performance Scatter-Gather Engine with:
  * Hedged requests / LLM race mode.
  * Multi-target webhook / tool execution.
  * Per-target Circuit Breakers (`CLOSED`, `OPEN`, `HALF_OPEN`).
  * Structured telemetry receipts with precise latency, bytes, and error taxonomy.
  * REST API + MCP Tool integration.
