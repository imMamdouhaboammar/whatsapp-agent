# Fable Agentic WhatsApp (ZapFast Edition)

> A browserless, fully agentic WhatsApp client and AI supervisor powered by Gemini 2.5, Google Cloud CLI ADC, Baileys socket transport, and the Model Context Protocol (MCP).

---

## Capabilities

- **Zero-Browser Socket Transport**: Powered by `@whiskeysockets/baileys` directly over WebSockets and the Noise Protocol. Consumes ~80MB RAM with zero Chromium or Puppeteer overhead (unlike legacy `whatsapp-web.js`).
- **Google Cloud & Gemini 2.5 Native**: Automatically resolves credentials via `gcloud auth print-access-token` and the active `gcloud` project. Supports `gemini-2.5-flash` and `gemini-2.5-pro` with multimodal voice note comprehension.
- **Human-in-the-Loop Moderation**:
  - **Auto-Pilot Mode**: AI replies automatically with simulated typing delay and natural reactions.
  - **Co-Pilot Mode**: AI prepares response drafts with confidence scores and reasoning for 1-click human approval.
  - **Human-Only Mode**: AI remains silent; you chat manually.
- **Model Context Protocol (MCP) Server**: Exposes 7 standard tools over `stdio` and HTTP for Gemini CLI, Claude Desktop, Cursor, and Antigravity.
- **Multimodal Voice Notes**: Inbound voice notes (`audio/ogg`) are transcribed and analyzed directly using Gemini.
- **Delightful Real-Time UI**: Built with Vite, React, and Tailwind CSS. Features live QR pairing, 8-digit phone pairing codes, live chat threads, agent thoughts inspector, and a test message simulator.

---

## Quickstart

### Prerequisites
- [Bun](https://bun.sh) (v1.2+)
- [Google Cloud SDK](https://cloud.google.com/sdk) logged in (`gcloud auth login`), or a `GEMINI_API_KEY`.

### 1. Installation
```bash
bun install
bun run build # builds the React UI
```

### 2. Run Environment Doctor
```bash
bun run cli doctor
```

### 3. Launch Web UI & Agent Engine
```bash
bun run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser:
1. Click **ربط جهاز (Link Device)**.
2. Scan the live QR code with your phone or request an 8-digit phone pairing code.
3. Configure your persona or start interacting!

### 4. Test Gemini Moderator from Terminal
```bash
bun run cli simulate "السلام عليكم، هو الكورس متاح حالياً وبكام؟"
```

---

## MCP Server Integration

To connect external AI assistants (e.g. Claude Desktop, Cursor, Gemini CLI):

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

### Registered MCP Tools
1. `whatsapp_list_chats`: List recent conversations and unread messages.
2. `whatsapp_get_messages`: Read chat history and voice note transcriptions.
3. `whatsapp_send_message`: Send messages as a human moderator.
4. `whatsapp_send_reaction`: React with emojis (👍, ❤️, etc.).
5. `whatsapp_get_status`: Inspect connection state and pending drafts.
6. `whatsapp_set_chat_mode`: Switch chat between autopilot, copilot, and human modes.
7. `whatsapp_approve_draft`: 1-click approve a pending draft reply.

---

## Architecture

```
whatsapp-agent/
├── src/
│   ├── index.ts               # Core server & orchestrator
│   ├── cli.ts                 # Terminal commands (doctor, simulate, pair)
│   ├── transport/
│   │   └── whatsapp-socket.ts # Baileys browserless WebSocket connection
│   ├── ai/
│   │   ├── gemini-client.ts   # Vertex AI & Google Gen AI client with gcloud ADC
│   │   ├── moderator-agent.ts # Human moderator persona & back-and-forth loop
│   │   └── audio-transcriber.ts # Voice note transcription
│   ├── domain/
│   │   ├── permission-engine.ts # Deterministic policy evaluation
│   │   ├── rate-limiter.ts    # Human typing delays & send queue
│   │   ├── memory-store.ts    # Chat persistence & draft store
│   │   └── types.ts           # Domain models
│   ├── mcp/
│   │   ├── server.ts          # Model Context Protocol definition
│   │   └── cli.ts             # Stdio runner for external AI clients
│   └── server/
│       ├── api.ts             # REST API
│       └── sse.ts             # Real-time event streaming
├── tests/                     # Comprehensive Bun test suite (13 tests)
└── ui/                        # Vite + React + Tailwind UI
```

---

## License
MIT
