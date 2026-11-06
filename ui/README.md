# WhatsApp Agent UI

React 19, TypeScript, Vite 8 and Tailwind 4 frontend for WhatsApp Agent. The workspace includes live chats, message replies, per-chat automation mode, pending AI drafts, contact memory, device pairing, assistant settings and a reply simulator.

## Languages and layout

- **العربية (RTL)** is the default language. The navigation and three work areas mirror to the right-to-left layout.
- **English (LTR)** is available from the `عربي / EN` switch in the header. The navigation and work areas follow left-to-right layout.
- The selected language persists in `localStorage`, with matching document `lang` and `dir` attributes.
- Content from WhatsApp contacts, AI draft replies and user messages is preserved as received, with automatic direction for mixed-language text.
- Responsive layouts support desktop, tablet and phone widths. The assistant becomes a dismissible panel on smaller screens.
- The assistant inspector collapses on desktop and opens as a drawer on smaller screens.
- Assistant settings live on the standalone `/settings/assistant` route.
- Outgoing receipt status comes from Baileys events, is stored in SQLite and appears as pending, sent, delivered or read indicators.

## Run

From the repository root, run the backend according to the root README, then in this directory:

```bash
bun install
bun run dev
```

The frontend calls the backend through the existing `/api` endpoints and server-sent events. It does not invent local demo data.

## Verify

```bash
bun run test:ui
bun run lint
bun run build
```

The UI test suite uses Node's built-in test runner and server-side React rendering to check the Arabic and English interfaces and real component contracts. Test browser interactions against a running backend before shipping.
