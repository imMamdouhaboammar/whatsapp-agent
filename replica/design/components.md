# Design Components Specification: Matured Capabilities

## 1. Component: `ContactMemoryPanel`
* **Purpose**: Inspect, add, and revoke stored preferences and facts for a given customer contact.
* **Location**: Integrated into the Chat Inspector drawer in `ui/src/App.tsx`.
* **States**:
  - `Empty`: "No active memories recorded for this contact."
  - `Loading`: Subtle skeleton pulse using `bg-surface`.
  - `Populated`: Numbered list of chips with creation timestamp and a 1-click delete button (trash icon).
  - `Error / Security Blocked`: Red accent banner explaining credential rejection ("Sensitive credentials cannot be stored").
* **Actions**:
  - `Add Memory`: Compact text input with `<kbd>Enter</kbd>` submission.
  - `Delete Memory`: Immediate deletion with receipt confirmation.
  - `Clear All`: Danger-themed action requiring confirmation.

---

## 2. Component: `StickerStudioModal`
* **Purpose**: Convert images to WhatsApp WebP stickers with real-time preview and size meter.
* **Layout**:
  - Left / Top: Image drag-and-drop or source preview.
  - Center: Live Sticker canvas showing 512x512 bounding box and text overlay.
  - Controls:
    - Text Caption input (max 80 chars, live character counter).
    - Centered Square Crop toggle switch.
    - Compression Gauge: Showing calculated byte size and green checkmark (`< 100 KB`).
  - Footer: "Send as WhatsApp Sticker" primary button + "Download WebP" secondary.

---

## 3. Component: `StyleSelectorBadge`
* **Purpose**: Visual indicator and fast dropdown of the conversation persona.
* **Options**:
  - `Professional` (رسمي) - Slate badge with Briefcase icon.
  - `Casual` (عادي) - Emerald badge with Coffee icon.
  - `Playful` (مرح) - Amber badge with Sparkles icon.
  - `Assertive` (حاسم) - Red badge with Shield icon.
  - `Empathetic` (متعاطف) - Blue badge with Heart icon.
