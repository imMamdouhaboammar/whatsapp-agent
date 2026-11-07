# Fable Agentic WhatsApp

> Browserless WhatsApp copilot and autonomous moderator with real-time SSE streaming, multi-model fallback, SQLite WAL and Supabase persistence, and Model Context Protocol (MCP) support.

## Core capabilities

- **Socket transport**: Browserless WebSocket engine powered by `@whiskeysockets/baileys` directly over the Noise Protocol (~80 MB RAM vs Chromium or Puppeteer). Supports QR and 8-digit phone pairing.
- **Multi-model fallback**: Google Gemini (`gemini-4-argon`, `gemini-3.1-pro`, `gemini-3.8-flash`) via `gcloud` Application Default Credentials (ADC) or `GEMINI_API_KEY`. Fails closed on authentication errors (401/403); falls back automatically on rate limits (429) and upstream server errors (5xx).
- **Human cadence simulation**: Inbound burst accumulator fuses rapid sequential messages into a single turn. Multi-bubble message splitting and randomized typing delays (1500 to 4500 ms) reflect natural conversational pacing.
- **Push-to-talk voice notes**: Inbound audio notes (`audio/ogg`) are transcribed directly via Gemini. Outbound voice synthesis generates authentic WhatsApp voice notes (`ptt: true`) using Google Cloud Text-to-Speech.
- **Continuous learning engine**: Background reflection worker runs structured synthesis after 15 minutes of thread inactivity, extracting procedural rules and semantic contact preferences into durable memory with automatic distillation and fail-closed credential scrubbing.
- **Tri-mode operational moderation**:
  - *Autopilot*: Automatic responses with simulated typing delay.
  - *Copilot*: Draft preparation with confidence scores and reasoning traces for one-click human approval.
  - *Human*: Silent observation with manual operator control.
- **Model Context Protocol (MCP)**: Native stdio and HTTP MCP server exposing 10 tools for Claude Desktop, Gemini CLI, Cursor, and custom agent integrations.
- **Dual persistence tiers**: Authoritative production persistence in Supabase PostgreSQL (with dual IPv4 session and transaction pooling, 15 active extensions including pgvector and pgmq); standalone offline caching and test fixtures in SQLite WAL.
- **Web cockpit**: React 19 interface with Tailwind CSS, bilingual layout (Arabic RTL and English LTR), real-time Server-Sent Events (SSE), Brand Brain manager, and token-gated access.

## Quick start

### Prerequisites

- [Bun](https://bun.sh) (v1.2.0 or later)
- Google Cloud SDK authenticated (`gcloud auth login`) or a `GEMINI_API_KEY`
- Supabase PostgreSQL database URL for production persistence (or local SQLite for standalone offline development)
- Optional: Python 3.9+ for bounded document extraction (`workers/media-python`)

### Installation

```bash
bun install
bun run build
```

### Environment diagnostics

```bash
bun run cli doctor
```

### Starting the application

```bash
# Start in development mode with hot reloading
bun run dev

# Or start the production server
bun run start
```

The web cockpit runs at `http://localhost:3000`.

### Terminal testing

```bash
# Test the Gemini moderator decision pipeline without sending a message
bun run cli simulate "السلام عليكم، هو الكورس متاح حالياً وبكام؟"

# Pair a WhatsApp companion client from the command line
bun run cli pair
```

## Configuration

Set environment variables in `.env`. See [`.env.example`](.env.example) for default values.

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | `3000` | HTTP port for REST API and web UI |
| `HOST` | string | `127.0.0.1` | Network interface to bind |
| `DATA_DIR` | string | `./data` | Directory for SQLite database and local state |
| `GEMINI_API_KEY` | string | | Google Gemini Developer API key (optional if using `gcloud` ADC) |
| `GOOGLE_CLOUD_PROJECT` | string | | Google Cloud project ID for Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | string | `us-central1` | Regional location for Vertex AI endpoints |
| `GEMINI_MODEL` | string | `gemini-4-argon` | Primary model identifier |
| `AGENT_DASHBOARD_TOKEN` | string | | Secret token (24+ characters) required to access web cockpit |
| `AGENT_ALLOWED_ORIGINS` | string | | Comma-separated allowed origins when running behind a reverse proxy |
| `DATABASE_URL` | string | | PostgreSQL connection string (Supavisor pooler port 5432) |
| `DATABASE_TRANSACTION_URL` | string | | Supabase transaction pooler connection string (port 6543) |
| `AGENT_CAPABILITIES_OWNER_TOKEN` | string | | Secret token protecting Brand Brain capability endpoints |
| `AGENT_AUTOPILOT_BRAND_ID` | string | `default` | Tenant identifier for multi-brand memory isolation |
| `MIN_TYPING_DELAY_MS` | number | `2000` | Minimum simulated typing delay |
| `MAX_TYPING_DELAY_MS` | number | `5000` | Maximum simulated typing delay |

## Web cockpit access and security

The web cockpit listens on `127.0.0.1` by default. When deployed on a remote host:

1. Configure `HOST=0.0.0.0` and set `AGENT_DASHBOARD_TOKEN` to a secret of at least 24 characters.
2. Route traffic through an HTTPS reverse proxy (such as Cloudflare or Nginx).
3. Set `AGENT_ALLOWED_ORIGINS` to the public HTTPS domain.
4. The web application authenticates using `AGENT_DASHBOARD_TOKEN` and issues an `HttpOnly`, `SameSite=Strict` session cookie.

Brand Brain management APIs are separately protected by `AGENT_CAPABILITIES_OWNER_TOKEN`.

## MCP server integration

To use WhatsApp Agent tools inside Claude Desktop, Cursor, or Gemini CLI, register the stdio runner:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/whatsapp-agent/src/mcp/cli.ts"]
    }
  }
}
```

### Available MCP tools

| Tool | Parameters | Description |
|---|---|---|
| `whatsapp_list_chats` | `limit?: number, unreadOnly?: boolean` | List active conversations, contact names, unread message counts, and current agent modes. |
| `whatsapp_get_messages` | `chatId: string, limit?: number` | Retrieve message history, timestamps, sender IDs, and voice note transcriptions. |
| `whatsapp_send_message` | `chatId: string, text: string, replyToMessageId?: string` | Send a WhatsApp message with simulated human typing cadence. |
| `whatsapp_send_reaction` | `chatId: string, messageId: string, emoji: string` | Send an emoji reaction to a specific message. |
| `whatsapp_get_status` | *(none)* | Inspect companion socket connection status, phone number, and pending drafts. |
| `whatsapp_set_chat_mode` | `chatId: string, mode: "autopilot" \| "copilot" \| "human"` | Set agent operation mode for a specific conversation. |
| `whatsapp_approve_draft` | `draftId: string, editedText?: string` | Approve and dispatch a pending copilot draft reply. |
| `whatsapp_manage_memory` | `chatId: string, action: string, content?: string, index?: number` | Inspect, save, or delete long-term contact preferences with credential filtering. |
| `whatsapp_set_chat_style` | `chatId: string, style: string` | Configure tone: `professional`, `casual`, `playful`, `assertive`, or `empathetic`. |
| `whatsapp_funnel_scatter_gather` | `method: string, payload?: object, queryParams?: object` | Execute concurrent scatter-gather dispatch across external systems with circuit-breaking. |

## Command-line interface

```bash
# Verify environment, storage paths, and gcloud ADC credentials
bun run cli doctor

# Simulate inbound message processing and print reasoning traces
bun run cli simulate "Can I get pricing for the enterprise tier?"

# Pair a WhatsApp companion client via QR code or phone pairing code
bun run cli pair

# Run PostgreSQL schema migrations
bun run db:postgres migrate

# Import existing SQLite chat records into PostgreSQL offline
bun run db:postgres import

# Execute polyglot dependency vulnerability audit
bun run security:audit
```

## Architecture

```
whatsapp-agent/
├── src/
│   ├── index.ts                 # Server setup, Hono routes, SSE streaming, turn loop
│   ├── cli.ts                   # CLI entry point (doctor, simulate, pair)
│   ├── agent/                   # Autonomous workflows and background services
│   │   ├── autonomous-operator.ts # Capability execution and goal planning
│   │   ├── brand-knowledge.ts     # Document and policy management
│   │   ├── capabilities-api.ts    # Protected brand data and configuration endpoints
│   │   ├── reflection-worker.ts   # Background thread reflection for cold conversations
│   │   └── turn-coordinator.ts    # Orchestration between moderator and capabilities
│   ├── ai/                      # Model integration and generation
│   │   ├── adaptive-style.ts      # Conversational tone adaptation
│   │   ├── audio-transcriber.ts   # Audio transcription via Gemini
│   │   ├── gemini-client.ts       # Vertex AI and Google Gen AI client with ADC
│   │   ├── model-fallback.ts      # Fail-closed auth and zero-downtime retry fallback
│   │   ├── moderator-agent.ts     # Persona and moderation decision engine
│   │   ├── reflection-engine.ts   # Distillation and rule extraction
│   │   └── voice-synthesizer.ts   # Text-to-speech voice note synthesis
│   ├── domain/                  # Business logic and local persistence
│   │   ├── burst-accumulator.ts   # Rapid sequential message fuser
│   │   ├── learning-memory.ts     # Dual markdown and database learning store
│   │   ├── memory-store.ts        # SQLite storage for messages, chats, and drafts
│   │   ├── message-splitter.ts    # Multi-bubble message segmenter
│   │   ├── permission-engine.ts   # Deterministic intent-to-action policy rules
│   │   ├── rate-limiter.ts        # Human typing cadence delays and dispatch queue
│   │   ├── types.ts               # Core domain models and interfaces
│   │   └── user-memory.ts         # Contact facts with credential screening
│   ├── funnel/                  # External system fan-out
│   │   ├── circuit-breaker.ts     # Per-target failure tracking and recovery
│   │   ├── engine.ts              # Scatter-gather and hedged race executor
│   │   └── registry.ts            # External integration endpoints
│   ├── mcp/                     # Model Context Protocol
│   │   ├── cli.ts                 # Stdio runner for external AI assistants
│   │   └── server.ts              # MCP tool registrations and handlers
│   ├── persistence/             # Database access
│   │   └── postgres/              # PostgreSQL schema migrations and learning store
│   └── server/                  # HTTP transport
│       ├── api.ts                 # REST endpoints
│       ├── dashboard-auth.ts      # Token authentication and session cookies
│       └── sse.ts                 # Server-Sent Events broadcaster
├── ui/                          # Web cockpit (Vite, React 19, Tailwind CSS, Astryx)
│   └── src/
│       ├── components/            # ChatThread, ModeratorDrawer, BrandBrain, etc.
│       └── i18n.tsx               # Bilingual layout (Arabic RTL and English LTR)
├── workers/                     # Bounded microservices
│   └── media-python/            # Document extraction worker (CSV, Excel, PDF)
└── tests/                       # Automated test suites
```

## Verification and testing

Execute automated verification before submitting pull requests:

```bash
# Run backend test suite
bun test

# Run UI SSR component tests
cd ui && bun test:ui

# Verify frontend build and type checking
cd ui && bun run build

# Run vulnerability scan across all package lockfiles
bun run security:audit

# Run design and anti-slop governance audit
bun .agents/skills/unslop-preflight/bin/cli.js audit
```

## Migration and enterprise storage

The application uses Supabase PostgreSQL as its production persistence tier and SQLite with write-ahead logging for standalone developer caching:

- Run schema migrations: `bun run db:postgres --schema`
- Perform offline migration from SQLite: `bun run db:postgres --import --apply --data-dir ./data --legacy-brand <brand-id>`
- See [PostgreSQL migration guide](docs/POSTGRES_MIGRATION.md) for details on IPv4 pooler setup, schema namespaces, and rollback steps.

## License

Source code authored in this repository is licensed under the [Mozilla Public License 2.0](LICENSE) (`MPL-2.0`).

- Free to run, modify, and self-host for commercial and private use.
- Modifications to MPL-covered files must be made available under the same license when distributed.
- Separately developed extensions, plugins, and custom skills may maintain their own licensing terms.
- See [Licensing and Extensions](docs/LICENSING.md) for details. WhatsApp and Meta trademarks belong to their respective owners.
