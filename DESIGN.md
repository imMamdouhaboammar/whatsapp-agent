# DESIGN.md

## Overview

### Creative North Star
An intentional, distraction-free messaging operations cockpit designed for rapid human-in-the-loop triage, multi-modal review, and high-trust conversational oversight. It blends WhatsApp's familiar chat layout with enterprise observability tools, prioritizing quiet utility, typography contrast, and mathematical accessibility over ornamental fluff.

### Design Read
Reading this as: enterprise AI messaging operations cockpit for high-volume WhatsApp business communications with bilingual Arabic/English support, built on @lobehub/ui and Tailwind.

### Taste Controls
- DESIGN_VARIANCE: 4
- MOTION_INTENSITY: 4
- VISUAL_DENSITY: 5

### Design System Baseline
Design System Baseline: custom-hybrid combining @lobehub/ui components, @lobehub/icons, and Tailwind CSS.
- Why this baseline fits: Provides battle-tested accessible primitives (Avatar, Tag, Badge, ActionIcon, Segmented, AgentAvatar) while preserving bespoke WhatsApp chat patterns.
- What to borrow: Grounded component token contracts from Atlassian Design System, Shopify Polaris, Material Design, and Apple Human Interface Guidelines for data density and state feedback.
- What not to copy: Generic AI gradient cards, purple mesh backgrounds, decorative blur blobs, or slow framer transitions that impede real-time operator throughput.

### Unslop Setup & Standards Gates
- Unslop setup command: Run npx unslop skills install or bunx unslop-preflight autopilot --report --strict before any frontend modifications.
- Unslop setup gate: Installation gate must verify that all required skills are installed before implementation starts.
- Intake Session Gate: Reference INTAKE.session.md for recorded decisions, user requirements, and constraints.
- 2026 Standards Gate: Reference STANDARDS.search-notes.md conforming to WCAG 2.2 Level AA, W3C accessibility specs, MDN Baseline, Core Web Vitals, container queries, and native dialog semantics.
- Rules Engine Gate: Automated regression verification executed via run-gates.mjs.

## Colors

### Canonical Color Palette
- Primary Brand Green: #008b70 (WCAG AAA on white for text, primary actions)
- Dark Accent Green: #006b57 (Active interactive states, header highlights)
- Strong Brand Green: #00a884 (Badges, brand mark accents, online presence)
- Soft Brand Green Tint: #e2f5eb (Agent chip backgrounds, active row fills)
- Shell Background: #f8faf9 (Workspace frame and navigation rails)
- Canvas Background: #efeae2 (WhatsApp chat thread message canvas)
- Surface Pure: #ffffff (Card containers, list panes, dropdown surfaces)
- Ink Text Primary: #111b21 (High-contrast typography, headings, sender titles)
- Muted Slate: #667781 (Secondary labels, timestamps, read receipt ticks)
- Border / Line: #e6e9e9 (Dividers, card strokes, structural boundaries)
- Outgoing Chat Bubble: #d9fdd3 (Outbound agent and operator messages)
- Warning Yellow: #fff1d6 (Review alert background)
- Warning Text: #9b6000 (Review required indicators)
- Destructive Red: #e02424 (Error feedback, draft rejection, sign-out actions)

### Contrast Rules
- Normal body copy must strictly achieve a minimum contrast ratio of 4.5:1 against its background.
- Large titles (at least 18px bold or at least 24px regular) and UI boundary strokes must achieve at least 3:1 contrast ratio.
- In dark surfaces (#0f172a), text must use lightness 50 to 200 (#f8fafc).
- On light surfaces (#ffffff / #f8faf9), text must use lightness 800 to 950 (#111b21).

### Security & Masking
- Secrets, passwords, session tokens, and API keys must be masked in UI displays using bullet masking and never displayed in plain text.
- Auth state handling: The workspace verifies logged in operator session state. If unauthenticated, access is gated to the owner login screen.

## Typography

### Type Scale & Hierarchy
- Display / H1: clamp(1.5rem, 2.5vw, 1.875rem) (24px - 30px), line-height: 1.25, font-weight: 800, letter-spacing: -0.03em. Used for primary workspace section headings.
- Headline / H2: 1.125rem (18px), line-height: 1.35, font-weight: 750. Used for drawer titles and modal headers.
- Title / H3: 0.9375rem (15px), line-height: 1.4, font-weight: 700. Used for card headers and contact names.
- Body Text: 0.875rem (14px), line-height: 1.55, font-weight: 400. Used for chat messages, incoming context, and notes. Max 75 characters per line for optimal readability.
- Label / Meta: 0.75rem (12px), line-height: 1.4, font-weight: 650. Used for status tags, filter chips, and timestamps.
- Helper Text & Error: 0.6875rem (11px), line-height: 1.35, font-weight: 600. Used for field microcopy and validation errors.

### Arabic Typography & Directionality
- Font stack: "IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", system-ui, sans-serif.
- Directionality rules: Native bidirectional support (dir="rtl" for Arabic, dir="ltr" for English).
- Always use logical CSS properties (margin-inline-start, padding-inline-end, border-inline-start, text-align: start).
- Arabic line-height is bumped by +15% over Latin equivalents to accommodate extended vertical diacritics and calligraphic glyph heights.

## Elevation

### Stacking Plan & Layer Scale
The application enforces a disciplined z-index stacking plan with zero blind z-index escalation:
- Layer 0 (Canvas Base): z-index: 1 (Chat stream, inbox list, surface cards)
- Layer 10 (Sticky Headers & Rails): z-index: 10 (Main navigation rail, chat header, action toolbars)
- Layer 20 (Drawers & Inspectors): z-index: 20 (ModeratorDrawer side panel, mobile navigation drawer)
- Layer 30 (Scrims & Backdrops): z-index: 30 (Modal scrim, drawer overlay backdrop)
- Layer 40 (Modals & Dialogs): z-index: 40 (PairingModal, SimulatorModal, StickerStudioModal)
- Layer 50 (Popovers & Dropdowns): z-index: 50 (Context menus, slash commands, select dropdowns)
- Layer 60 (Toasts & Floating Alerts): z-index: 60 (Global alerts, notification banners, tooltips)

### Layer Conflict Matrix
- Header vs Drawer: On desktop, the drawer slides into a dedicated grid column. On mobile/compact screens (< 1160px), the drawer renders above the header with Layer 20 over a Layer 30 scrim.
- Drawer vs Modal: Modals (Layer 40) always cover the drawer (Layer 20) and trap focus inside their own dialog shell.
- Toast vs Modal: Toasts (Layer 60) render at top-center/top-end above all active modal shells.

### Overlay Portal Policy & Context Audit
- All floating popovers, drawers, and modal dialogs render through the portal root (#lobe-ui-theme-app / document.body) using native HTML dialog or React portals.
- Stacking context audit: Ancestor elements on parent wrappers avoid rogue transform, opacity < 1, filter, isolation, or contain values that would trap child overlays inside clipped stacking contexts.

### Modal Viewport Contract
- Explicit viewport contract: All modals, dialogs, drawers, and popups must strictly fit inside the visual viewport across mobile (320px, 360px, 390px, 414px), tablet, desktop, landscape orientations, and soft virtual keyboard open states.
- Width constraint: Responsive width: min(100% - 32px, 560px) with dynamic padding guards.
- Height constraint: max-height: min(90dvh, 720px) with overscroll-contain on overlay shells.
- Internal scroll behavior: Long content scrolls internally via overflow-y-auto on the body container; header and footer actions stay pinned and accessible.
- Scrollbar aesthetic: Overlays enforce a thin scrollbar and subtle scroll shadow affordance instead of a heavy shell scrollbar.
- Viewport QA verified: Tested on 320x568, 375x667, and 390x844 viewports without horizontal clipping.

## Components

### Component Inventory & States
- Button / ActionIcon:
  - States: Default, Hover (filter: brightness(0.95)), Focus (outline: 3px solid #52b9a1; outline-offset: 2px), Active (transform: scale(0.98)), Disabled (opacity: 0.48; cursor: not-allowed).
- Tag / Badge:
  - Variants: Filled, Outlined, Borderless.
  - States: Default, Active filter, Closable.
- Input & SearchBar:
  - States: Default, Focus-within (border-color: #84cbb7; box-shadow: 0 0 0 1px #84cbb7), Disabled, Error (border-color: #e02424).
- Segmented Control:
  - States: Idle option, Selected option with sliding pill indicator, Hover, Focus-visible.
- Chat Bubble:
  - Variants: Inbound (#ffffff), Outbound (#d9fdd3), Highlighted swipe animation.
- Modal Dialog:
  - Accessibility: role="dialog", aria-modal="true", focus trap active, dismiss on Escape key and scrim click.

### Responsive Mobile & Tablet Rules
- Viewports under 768px: Single-column split view (switching between inbox list and active chat thread). Explicitly use flex-col and w-full containers.
- Tablet viewports: Use md:flex and md:grid layout containers with md:grid-cols-2.
- Touch target minimum: Interactive buttons and action icons must measure at least 44x44px bounding area on touch devices (@media (pointer: coarse)).
- Prevent viewport bounce and clipping: Use min-height: 100dvh rather than 100vh.

### Motion & Transitions
- Transition duration: 160ms for hover, 240ms for drawer slides, 280ms for modal scale-in.
- Timing curve: cubic-bezier(0.16, 1, 0.3, 1) (snappy ease-out).
- Accessibility requirement: Respect prefers-reduced-motion: reduce by zeroing transition durations and swapping slide transforms for instant opacity crossfades.

## Do's and Don'ts

### Icon System Rules
- DO NOT use decorative magic wands, starbursts, or arbitrary floating glyphs as lazy signifiers for AI functionality. Use precise domain icons (Bot, Settings, Zap, Sliders, Layers, MessageSquare).
- DO NOT use casual pictograms as structural UI controls. Always use official vector SVGs from @lobehub/icons, @lobehub/ui/icons, or lucide-react.
- DO use official brand provider icons (Gemini.Color, Google.Color, WhatsApp.Color, ModelIcon) for model badges and verified integrations.

### Anti-Patterns
- DO NOT apply blanket overflow: hidden on root containers that clip responsive viewports or break mobile scrolling.
- DO NOT use arbitrary hex colors scattered in inline styles; reference named tokens in index.css and Tailwind variables.
- DO NOT escalate z-indexes blindly (z-9999 is prohibited; adhere strictly to the 7-tier named layer scale).
- DO NOT hide focus rings (outline: none without focus-visible replacement is strictly forbidden).
- DO NOT use native browser dialogs (alert(), confirm(), prompt()); use in-app modal and drawer components.

### UX-CRX Decisions & Progressive Disclosure
- Every destructive operation (rejecting drafts, deleting contact memory, disconnecting device) must provide an immediate recovery path or clear confirmation.
- Primary action vs secondary action: "Approve & Send" is high-emphasis filled primary green; "Edit" and "Voice" are quiet outlined secondary actions.
- Progressive disclosure: Advanced reasoning logs, raw model prompt tokens, and multi-tenant funnel statistics are placed behind disclosure drawers and tabs to keep the primary messaging cockpit focused.

### Pre-flight Check
- Creative North Star and brief-inferred Design Read validated.
- Taste dials (VARIANCE: 4, MOTION: 4, DENSITY: 5) calibrated.
- Custom-hybrid baseline established with official @lobehub/ui and @lobehub/icons packages.
- Stacking plan and 7-tier layer scale committed.
- Viewport contract and internal scroll defined for all overlays.
- Mathematical contrast rules (4.5:1 body, 3:1 headings) enforced.
- Directionality and logical properties verified for Arabic RTL and English LTR.
- Anti-slop icon system rules confirmed.
