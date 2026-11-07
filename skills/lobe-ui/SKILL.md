---
name: lobe-ui
description: "A modern React component library for building LobeHub products. Use when choosing a component, looking up its props and API, or implementing UI with it."
---

# Lobe UI

> A modern React component library for building LobeHub products.

## Setup

- Repository: https://github.com/lobehub/lobe-ui
- Docs: https://ui.lobehub.com/

## Workflow

1. Pick candidates from the index below. Groups follow the source folder, which usually maps to the import entry.
2. Fetch the linked reference page before writing code. It holds the documented usage, props and API tables.
3. Only use props, variants and imports that the reference page documents. Follow its Docs link to see live demos.

The page index with outlines is at https://ui.lobehub.com/llms.txt.

## Index

### Guides

- [Migrating to v6](https://ui.lobehub.com/skills/migration-v6.md) — Upgrade from @lobehub/ui 5.x to 6.x — no antd, CSS-variable theming, one component set.
- [Design Tokens](https://ui.lobehub.com/skills/design-tokens.md) — Every theme token a Lobe UI component reads, grouped by role, with live light and dark values.
- [Styling Overrides](https://ui.lobehub.com/skills/styling-overrides.md) — Stable class names and data attributes for overriding Lobe UI component styles with plain CSS.

### src

#### Data Display

- [Accordion](https://ui.lobehub.com/skills/components/accordion.md) — Base UI-powered Accordion with borderless, filled-header and outlined variants.
- [AgentAvatar](https://ui.lobehub.com/skills/components/agent-avatar.md) — AgentAvatar draws a deterministic character for an AI agent from a seed, a flat silhouette with big logo-style eyes.
- [Avatar](https://ui.lobehub.com/skills/components/avatar.md) — Avatar and AvatarGroup with emoji, image, text fallback and loading overlay support, built on Base UI-era primitives.
- [Carousel](https://ui.lobehub.com/skills/components/carousel.md) — Slide carousel with autoplay, loop, adaptive height, pill dots and an imperative ref.
- [CodeDiff](https://ui.lobehub.com/skills/components/code-diff.md) — The CodeDiff component is used to display code differences with syntax highlighting.
- [Collapsible](https://ui.lobehub.com/skills/components/collapsible.md) — Controlled show / hide with the same height and fade motion as Accordion panels, for sections that render their own header.
- [Descriptions](https://ui.lobehub.com/skills/components/descriptions.md) — Label and value pairs laid out in one or more columns, with an optional header and bordered style.
- [Empty](https://ui.lobehub.com/skills/components/empty.md) — Empty component displays an empty state with customizable icon, emoji, image, title, description, and action buttons, in default and dashed…
- [FileTypeIcon](https://ui.lobehub.com/skills/components/file-type-icon.md) — FileTypeIcon is a component that displays icons based on file types.
- [FluentEmoji](https://ui.lobehub.com/skills/components/fluent-emoji.md) — The FluentEmoji component is used to display an emoji with the Fluent design style.
- [GroupAvatar](https://ui.lobehub.com/skills/components/group-avatar.md) — GroupAvatar is a component that displays multiple user avatars in a grid layout with smooth corner styling.
- [GuideCard](https://ui.lobehub.com/skills/components/guide-card.md) — GuideCard is a component used to display visual guides, introductory content, or instructional information with an optional cover image, ti…
- [Highlighter](https://ui.lobehub.com/skills/components/highlighter.md) — The Highlighter component is used to display syntax-highlighted code blocks with powerful features like code copying, language selection, a…
- [Hotkey](https://ui.lobehub.com/skills/components/hotkey.md) — Hotkey component displays keyboard shortcuts or key combinations in a visually appealing way, supporting both standard and Mac keyboard sty…
- [HtmlPreview](https://ui.lobehub.com/skills/components/html-preview.md) — HtmlPreview renders LLM-generated HTML inline using a hardened iframe sandbox.
- [Image](https://ui.lobehub.com/skills/components/image.md) — Image is an enhanced image component with a self-contained zoom-and-pan preview viewer, custom actions, and various display styles.
- [Markdown](https://ui.lobehub.com/skills/components/markdown.md) — Markdown is a React component used to render markdown text.
- [MaterialFileTypeIcon](https://ui.lobehub.com/skills/components/material-file-type-icon.md) — MaterialFileTypeIcon displays file and folder icons in Material Design style based on file extensions or folder names.
- [Mermaid](https://ui.lobehub.com/skills/components/mermaid.md) — Mermaid is a component for rendering Mermaid diagrams in React.
- [Popover](https://ui.lobehub.com/skills/components/popover.md) — A floating card that displays additional content when triggered by hover or click.
- [ProTable](https://ui.lobehub.com/skills/components/pro-table.md) — Advanced data table on top of Table, shaped like ProComponents ProTable — request / params driven data, value types and value enums, a gene…
- [QRCode](https://ui.lobehub.com/skills/components/qr-code.md) — SVG QR code, dark on white in both themes, with an optional centre icon and loading / expired states.
- [Skeleton](https://ui.lobehub.com/skills/components/skeleton.md) — Placeholder blocks that stand in for content while it loads.
- [Snippet](https://ui.lobehub.com/skills/components/snippet.md) — The Snippet component is used to display a code snippet with syntax highlighting.
- [SortableList](https://ui.lobehub.com/skills/components/sortable-list.md) — SortableList is a component for creating drag-and-drop sortable lists.
- [Statistic](https://ui.lobehub.com/skills/components/statistic.md) — A labeled number with thousands separators, fixed precision, prefix and suffix.
- [Table](https://ui.lobehub.com/skills/components/table.md) — Data table with antd-shaped columns, local or server sorting, header filters, pagination, row selection, expandable rows, tree data, summar…
- [Tag](https://ui.lobehub.com/skills/components/tag.md) — Standalone colored tag for statuses and categorization, with preset and hex colors, sizes, shapes, variants, and a closable affordance.
- [Tooltip](https://ui.lobehub.com/skills/components/tooltip.md) — The Tooltip component is used to provide additional information to the user when they hover over a specific element.
- [Tree](https://ui.lobehub.com/skills/components/tree.md) — Data-driven tree with expand, single/multiple selection, linked checkboxes, keyboard navigation and rounded SVG guide lines.
- [Video](https://ui.lobehub.com/skills/components/video.md) — A video player with sections and markers on a segmented timeline, marker captions, hover frame preview, frame stepping, speed and mute cont…

#### Data Entry

- [AutoComplete](https://ui.lobehub.com/skills/components/auto-complete.md) — Base UI-powered AutoComplete input that filters its own suggestion list as you type.
- [Checkbox](https://ui.lobehub.com/skills/components/checkbox.md) — Base UI-powered Checkbox and CheckboxGroup with the lobe visual style.
- [CodeEditor](https://ui.lobehub.com/skills/components/code-editor.md) — Edits code with syntax highlighting for multiple programming languages.
- [ColorPicker](https://ui.lobehub.com/skills/components/color-picker.md) — Hex colour picking with a saturation area, hue and alpha sliders, HEX / RGB / HSL inputs, presets, recent colours and the EyeDropper API.
- [ColorSwatches](https://ui.lobehub.com/skills/components/color-swatches.md) — Displays selectable color swatches with an optional picker for custom colors.
- [CopyButton](https://ui.lobehub.com/skills/components/copy-button.md) — CopyButton is a React component used to copy text content to the clipboard.
- [DatePicker](https://ui.lobehub.com/skills/components/date-picker.md) — Date, week, month, quarter, year and time picking with native Date (or Dayjs) values and a typeable input, plus a two-panel range picker.
- [DownloadButton](https://ui.lobehub.com/skills/components/download-button.md) — DownloadButton is a React component used to download content from a Blob URL.
- [EditableText](https://ui.lobehub.com/skills/components/editable-text.md) — EditableText is a component that allows users to edit text inline.
- [EditorSlashMenu](https://ui.lobehub.com/skills/components/editor-slash-menu.md) — EditorSlashMenu is a slash-command menu built on Base UI Autocomplete primitives, styled consistently with DropdownMenu.
- [EmojiPicker](https://ui.lobehub.com/skills/components/emoji-picker.md) — EmojiPicker is a component that allows users to select emoji icons or upload custom avatars.
- [Form](https://ui.lobehub.com/skills/components/form-kit.md) — Controlled form from @lobehub/ui/form — a form instance, schema-first validation and field-level render granularity, with the engine kept b…
- [Form (Legacy)](https://ui.lobehub.com/skills/components/form.md) — Configuration-driven Form from the root export, with settings-style groups, fields and a submit footer.
- [HotkeyInput](https://ui.lobehub.com/skills/components/hotkey-input.md) — HotkeyInput is a specialized input component for capturing keyboard shortcuts.
- [ImageSelect](https://ui.lobehub.com/skills/components/image-select.md) — ImageSelect allows users to choose an option from a list of images.
- [Input](https://ui.lobehub.com/skills/components/input.md) — Base UI-powered text input with variants, sizes, clear button and slots, plus the Password, Number, OTP and TextArea family.
- [Radio](https://ui.lobehub.com/skills/components/radio.md) — Base UI-powered Radio and RadioGroup with lobe visual style.
- [Rate](https://ui.lobehub.com/skills/components/rate.md) — Star rating that displays any fractional score read-only, or lets users pick a value with pointer or keyboard.
- [SearchBar](https://ui.lobehub.com/skills/components/search-bar.md) — SearchBar that includes an input field with a search icon and clear button, allowing users to easily search for specific items or content.
- [Segmented](https://ui.lobehub.com/skills/components/segmented.md) — Base UI-powered Segmented control — toggle-group semantics with a sliding active indicator.
- [Select](https://ui.lobehub.com/skills/components/select.md) — Base UI-powered Select component.
- [Slider](https://ui.lobehub.com/skills/components/slider.md) — Base UI-powered Slider and SliderWithInput components.
- [Switch](https://ui.lobehub.com/skills/components/switch.md) — Base UI-powered Switch component.
- [ToggleGroup](https://ui.lobehub.com/skills/components/toggle-group.md) — Base UI-powered ToggleGroup — a frameless group of action buttons for mode switches.
- [Upload](https://ui.lobehub.com/skills/components/upload.md) — Headless file picker trigger with a hidden input, drag-and-drop dragger, and accept/maxCount filtering.

#### Feedback

- [Alert](https://ui.lobehub.com/skills/components/alert.md) — Neutral-first inline feedback with restrained semantic color, actions, dismissal, and expandable diagnostic detail.
- [Badge](https://ui.lobehub.com/skills/components/badge.md) — Status dots with text, and numeric or dot count badges anchored to their children's corner.
- [Drawer](https://ui.lobehub.com/skills/components/drawer.md) — Edge-anchored panel built directly on Base UI dialog primitives, with four placements, an optional sidebar layout, and nested push behaviou…
- [FloatingPanel](https://ui.lobehub.com/skills/components/floating-panel.md) — Viewport-anchored floating panel built from Base UI modal atoms for contextual side conversations, task runs, inspectors, and other non-blo…
- [FloatingSheet](https://ui.lobehub.com/skills/components/floating-sheet.md) — Container-embedded bottom sheet with drag-to-resize, snap points, overlay/inline layout modes, and elevated/embedded visual variants.
- [Modal](https://ui.lobehub.com/skills/components/modal.md) — Base UI-powered Modal with antd-compatible API, supporting declarative, imperative, and atomic usage.
- [Progress](https://ui.lobehub.com/skills/components/progress.md) — Line, segmented, inset, and circular progress indicators with status colors and a determinate info label.
- [Result](https://ui.lobehub.com/skills/components/result.md) — Feedback panel for success, error, warning, and info outcomes, with a status icon, title, subtitle, and extra actions.
- [Spin](https://ui.lobehub.com/skills/components/spin.md) — Lightweight loading indicator with size presets, a determinate progress ring, a network variant for AI work, and a children overlay mode.
- [Toast](https://ui.lobehub.com/skills/components/toast.md) — A toast notification component for displaying brief messages.

#### General

- [ActionIcon](https://ui.lobehub.com/skills/components/action-icon.md) — Compact icon button built on the Base UI Button with size presets, visual variants, loading state, and tooltip integration.
- [ActionIconGroup](https://ui.lobehub.com/skills/components/action-icon-group.md) — ActionIconGroup is a component for rendering multiple buttons with unified styling and layout control.
- [Block](https://ui.lobehub.com/skills/components/block.md) — A flexible container that extends Flexbox with variants, shadows, and glass effects.
- [Button](https://ui.lobehub.com/skills/components/button.md) — Polished Button built on Base UI.
- [Freeze](https://ui.lobehub.com/skills/components/freeze.md) — Prevents DOM updates in descendant content through React Suspense, primarily to keep exit animations visually stable.
- [Icon](https://ui.lobehub.com/skills/components/icon.md) — Icon is a component based on lucide-react that provides rich icon selection and customization options.

#### Internationalization

- [I18n](https://ui.lobehub.com/skills/components/i18n.md) — Internationalization (i18n) provider and hooks for managing translations across multiple languages in your application.

#### Layout

- [Divider](https://ui.lobehub.com/skills/components/divider.md) — A thin separator line between content, horizontal or vertical, with an optional centered label.
- [DraggablePanel](https://ui.lobehub.com/skills/components/draggable-panel.md) — An edge-anchored panel that can be resized by dragging, by keyboard, or collapsed.
- [Flex](https://ui.lobehub.com/skills/components/flex.md) — Flexible layout components based on Flexbox
- [Grid](https://ui.lobehub.com/skills/components/grid.md) — Grid is a responsive layout component that arranges child elements in a grid pattern.
- [Header](https://ui.lobehub.com/skills/components/header.md) — The Header component is a customizable header section with a logo, navigation, and actions.
- [Layout](https://ui.lobehub.com/skills/components/layout.md) — The Layout component is used to create a basic layout structure with header, footer, sidebar and content areas.
- [MaskShadow](https://ui.lobehub.com/skills/components/mask-shadow.md) — MaskShadow is a component that adds a gradient shadow effect to indicate content overflow in a specific direction.
- [ProgressiveBlur](https://ui.lobehub.com/skills/components/progressive-blur.md) — ProgressiveBlur fades the edge of an overflowing area with stacked backdrop blur layers that ramp from sharp to blurred, plus a theme-tinte…
- [ScrollArea](https://ui.lobehub.com/skills/components/scroll-area.md) — A native scroll container with custom scrollbars and gradient scroll fade.
- [ScrollShadow](https://ui.lobehub.com/skills/components/scroll-shadow.md) — ScrollShadow is a component that adds shadow indicators to scrollable content to show overflow in different directions.

#### Navigation

- [Anchor](https://ui.lobehub.com/skills/components/anchor.md) — Scroll-spy table of contents that highlights the heading at the top of a scroll container.
- [Breadcrumb](https://ui.lobehub.com/skills/components/breadcrumb.md) — A trail of links to the current page, with a chevron separator and router-aware links.
- [Burger](https://ui.lobehub.com/skills/components/burger.md) — Mobile navigation toggle that opens a drawer of List items under the header, or fullscreen with large type.
- [ContextMenu](https://ui.lobehub.com/skills/components/context-menu.md) — ContextMenu provides an imperative API to open a menu at the last pointer position.
- [DraggableSideNav](https://ui.lobehub.com/skills/components/draggable-side-nav.md) — A generic resizable side panel container with collapse/expand functionality.
- [DropdownMenu](https://ui.lobehub.com/skills/components/dropdown-menu.md) — DropdownMenu renders a dropdown menu based on Base UI Menu primitives, aligned with ContextMenu item layout and styling.
- [List](https://ui.lobehub.com/skills/components/list.md) — A vertical list of selectable rows with icons or avatars, descriptions, trailing extras, hover actions and dividers.
- [Pagination](https://ui.lobehub.com/skills/components/pagination.md) — Page navigation with a windowed page list, prev/next controls, and an optional page-size changer.
- [SideNav](https://ui.lobehub.com/skills/components/side-nav.md) — The SideNav component is a customizable side navigation bar.
- [Steps](https://ui.lobehub.com/skills/components/steps.md) — A numbered sequence for multi-step flows, or a neutral vertical guide list when no step is current.
- [Tabs](https://ui.lobehub.com/skills/components/tabs.md) — Base UI-powered Tabs with iOS-flavored interactions — no hover background, tap-scale feedback, and a sliding active indicator across rounde…
- [Toc](https://ui.lobehub.com/skills/components/toc.md) — Scroll-spy table of contents with an animated SVG outline rail that highlights the active section.

#### Theme

- [ConfigProvider](https://ui.lobehub.com/skills/components/config-provider.md) — Configures library-wide CDN resource resolution and the motion runtime for descendant components.
- [FontLoader](https://ui.lobehub.com/skills/components/font-loader.md) — The FontLoader component is used to load fonts from a provided URL.
- [MotionProvider](https://ui.lobehub.com/skills/components/motion-provider.md) — MotionProvider lets you choose which motion component (motion or m) Lobe UI uses.

#### Typography

- [Text](https://ui.lobehub.com/skills/components/text.md) — Base UI-powered Text typography component with semantic types, formatting options, and single- or multi-line ellipsis with overflow-aware t…

#### Utils

- [FocusScope](https://ui.lobehub.com/skills/components/focus-scope.md) — Sticky keyboard regions.

### awesome

#### Data Display

- [Features](https://ui.lobehub.com/skills/components/awesome/features.md) — Features is a component for displaying a grid of feature items with icons, descriptions, and optional images.
- [Hero](https://ui.lobehub.com/skills/components/awesome/hero.md) — Hero is a component for creating attractive landing page hero sections with a title, description, and customizable action buttons.
- [SpotlightCard](https://ui.lobehub.com/skills/components/awesome/spotlight-card.md) — SpotlightCard displays a grid of items with an interactive spotlight effect that follows the mouse cursor over each card.

#### Effect

- [AuroraBackground](https://ui.lobehub.com/skills/components/awesome/aurora-background.md) — AuroraBackground creates a beautiful aurora-like animated gradient background effect that can be used as a container for other content.
- [Grainient](https://ui.lobehub.com/skills/components/awesome/grainient.md) — An animated, grainy WebGL gradient for login and landing backgrounds.
- [GridBackground](https://ui.lobehub.com/skills/components/awesome/grid-background.md) — GridBackground creates a dynamic grid pattern background with customizable colors and animation effects.
- [Spotlight](https://ui.lobehub.com/skills/components/awesome/spotlight.md) — The Spotlight component creates a circular spotlight effect that follows the user's mouse cursor, useful for creating interactive hover eff…

#### Feedback

- [Giscus](https://ui.lobehub.com/skills/components/awesome/giscus.md) — A wrapper component for giscus 💎, a comments system powered by GitHub Discussions.

#### General

- [BottomGradientButton](https://ui.lobehub.com/skills/components/awesome/bottom-gradient-button.md) — A round filled button with a subtle gold bottom-edge gradient that appears on hover.
- [GradientButton](https://ui.lobehub.com/skills/components/awesome/gradient-button.md) — GradientButton is a customized button with an attractive gradient background that can include an optional glow effect.
- [TypewriterEffect](https://ui.lobehub.com/skills/components/awesome/typewriter-effect.md) — A powerful typewriter effect component that creates realistic typing animations with automatic typing and deleting, cycling through multipl…

#### Landing

- [AgentSkillCard](https://ui.lobehub.com/skills/components/awesome/agent-skill-card.md) — A card that hands coding agents a prompt pointing at your skills, and gives humans the matching install command, with a row of supported ag…
- [BentoGrid](https://ui.lobehub.com/skills/components/awesome/bento-grid.md) — A responsive tile grid for showing live component renders on a landing page.
- [CodeShowcase](https://ui.lobehub.com/skills/components/awesome/code-showcase.md) — Tabs that pair a short code snippet with its live render, to show what a few lines of code produce.
- [FeatureGrid](https://ui.lobehub.com/skills/components/awesome/feature-grid.md) — A grid of short feature cards with an icon, title and description.
- [FluidGradient](https://ui.lobehub.com/skills/components/awesome/fluid-gradient.md) — A slow, GPU-rendered gradient texture for landing page backgrounds.
- [InstallBanner](https://ui.lobehub.com/skills/components/awesome/install-banner.md) — The closing call to action of a landing page, with a title, a copyable install command and a footnote.
- [LandingHero](https://ui.lobehub.com/skills/components/awesome/landing-hero.md) — The opening band of a landing page, with a badge, a title with a gradient accent, a description and actions.
- [LandingSection](https://ui.lobehub.com/skills/components/awesome/landing-section.md) — The heading and spacing wrapper for every band of a landing page, with an optional eyebrow, title, description and top divider.
- [LogoMarquee](https://ui.lobehub.com/skills/components/awesome/logo-marquee.md) — An endless, pausable strip of logos with labels, for showing integrations or supported providers.

### brand

#### Combine

- [LobeChat](https://ui.lobehub.com/skills/components/brand/lobe-chat.md) — A versatile brand component for displaying LobeChat logo in various styles including 3D, flat, monochrome, text, and combined formats.
- [LobeHub](https://ui.lobehub.com/skills/components/brand/lobe-hub.md) — A versatile brand component for displaying LobeHub logo in various styles including 3D, flat, monochrome, text, and combined formats.

#### Components

- [BrandLoading](https://ui.lobehub.com/skills/components/brand/brand-loading.md) — A loading component that displays animated brand text logos, such as LobeHub or LobeChat, with a loading animation effect.
- [LobeChatText](https://ui.lobehub.com/skills/components/brand/lobe-chat-text.md) — Renders the LobeChat wordmark as a current-color SVG with configurable size.
- [LobeHubText](https://ui.lobehub.com/skills/components/brand/lobe-hub-text.md) — Renders the LobeHub wordmark as a current-color SVG with configurable size.
- [Logo3d](https://ui.lobehub.com/skills/components/brand/logo3d.md) — A component that renders a 3D image of the LobeHub logo using a CDN-hosted asset.
- [LogoFlat](https://ui.lobehub.com/skills/components/brand/logo-flat.md) — Renders the full-color LobeHub logo mark from @lobehub/icons.
- [LogoMono](https://ui.lobehub.com/skills/components/brand/logo-mono.md) — Renders the monochrome LobeHub logo mark from @lobehub/icons.

### chat

#### Data Display

- [ChatItem](https://ui.lobehub.com/skills/components/chat/chat-item.md) — ChatItem is a versatile React component that displays chat messages with support for avatars, message content, and interactive actions.
- [ChatList](https://ui.lobehub.com/skills/components/chat/chat-list.md) — ChatList is a flexible component for rendering chat conversations with rich customization options.
- [TokenTag](https://ui.lobehub.com/skills/components/chat/token-tag.md) — TokenTag is a dynamic button component that visualizes token usage with emoji indicators and textual information.

#### Data Entry

- [ChatInputArea](https://ui.lobehub.com/skills/components/chat/chat-input-area.md) — The ChatInputArea component is used to display a chat input area with expandable and collapsible feature, and a send button to submit the c…
- [EditableMessage](https://ui.lobehub.com/skills/components/chat/editable-message.md) — The EditableMessage component is used to display a message that can be edited by the user.
- [EditableMessageList](https://ui.lobehub.com/skills/components/chat/editable-message-list.md) — EditableMessageList is a React component that allows users to edit a list of chat messages, including their content and role.
- [MessageInput](https://ui.lobehub.com/skills/components/chat/message-input.md) — A message input component with a code editor for Markdown content, with confirm and cancel buttons.

#### Feedback

- [LoadingDots](https://ui.lobehub.com/skills/components/chat/loading-dots.md) — LoadingDots is an animated loading indicator component that displays three animated dots with various animation styles.
- [MessageModal](https://ui.lobehub.com/skills/components/chat/message-modal.md) — The MessageModal component is a modal window that can display either a message in Markdown format or a message input field for editing the…

#### Layout

- [ChatHeader](https://ui.lobehub.com/skills/components/chat/chat-header.md) — ChatHeader is a versatile navigation component for chat interfaces.

#### Navigation

- [BackBottom](https://ui.lobehub.com/skills/components/chat/back-bottom.md) — BackBottom is a scroll navigation button that appears when users have scrolled up in a chat interface.

### color

- [ColorScales](https://ui.lobehub.com/skills/components/color/color-scales.md) — The ColorScales component is a memoized component used to display a color scale.
- [CssVar](https://ui.lobehub.com/skills/components/color/css-var.md) — The CssVar component is a memoized component used to display a color scale.

### dashboard

#### Data Display

- [StatCard](https://ui.lobehub.com/skills/components/dashboard/stat-card.md) — StatCard is one metric in its own card.
- [PageSkeleton](https://ui.lobehub.com/skills/components/dashboard/page-skeleton.md) — PageSkeleton is the loading shape of a dashboard page — header, metric tiles, and a table — plus the announcer that tells assistive tech th…
- [TableIconActions](https://ui.lobehub.com/skills/components/dashboard/table-icon-actions.md) — TableIconActions is the row of icon buttons in a table's last column.
- [TitleWithTips](https://ui.lobehub.com/skills/components/dashboard/title-with-tips.md) — TitleWithTips is a column or field title followed by a muted info icon that explains the metric in a tooltip.
- [LabelWithKey](https://ui.lobehub.com/skills/components/dashboard/label-with-key.md) — LabelWithKey shows a human label followed by its machine key as a tag, for settings, permissions and other records that have both.
- [MetricStrip](https://ui.lobehub.com/skills/components/dashboard/metric-strip.md) — MetricStrip shows peer metrics, either joined in one Surface divided into cells or split into one card per item.
- [FilterStrip](https://ui.lobehub.com/skills/components/dashboard/filter-strip.md) — FilterStrip is one Surface of selectable counts that acts as a radio group.

#### Layout

- [ConsoleShell](https://ui.lobehub.com/skills/components/dashboard/console-shell.md) — ConsoleShell is a dashboard frame with a collapsible sidebar, a compact navigation drawer, and an inset workspace card.
- [AuthLayout](https://ui.lobehub.com/skills/components/dashboard/auth-layout.md) — AuthLayout centers a sign-in card on the workspace canvas.
- [AuthThemeSwitch](https://ui.lobehub.com/skills/components/dashboard/auth-tools.md) — AuthThemeSwitch and AuthLocaleSwitch are the compact theme and language pickers for AuthLayout's corner tools.
- [Surface](https://ui.lobehub.com/skills/components/dashboard/surface.md) — Surface is an elevated card for dashboard panels.
- [PageHeader](https://ui.lobehub.com/skills/components/dashboard/page-header.md) — PageHeader is the title row of a dashboard page.
- [PanelSurface](https://ui.lobehub.com/skills/components/dashboard/panel-surface.md) — PanelSurface is a titled Surface with a fixed body inset (default or small).
- [FilterSidebar](https://ui.lobehub.com/skills/components/dashboard/filter-sidebar.md) — FilterSidebar splits a dashboard page into a resizable filter rail and a content pane.
- [ChartGrid](https://ui.lobehub.com/skills/components/dashboard/chart-grid.md) — ChartGrid lays out peer charts two-up and drops to one column when its own container is narrower than 640px.
- [PageToolbar](https://ui.lobehub.com/skills/components/dashboard/page-toolbar.md) — PageToolbar is the row under a page header.
- [Section](https://ui.lobehub.com/skills/components/dashboard/section.md) — Section is a titled page block with a description, extra actions and a "more" link.

#### Navigation

- [ConsoleNav](https://ui.lobehub.com/skills/components/dashboard/console-nav.md) — ConsoleNav is grouped sidebar navigation for a dashboard.
- [Breadcrumb](https://ui.lobehub.com/skills/components/dashboard/breadcrumb.md) — Breadcrumb shows where a dashboard page sits.
- [PageTabs](https://ui.lobehub.com/skills/components/dashboard/page-tabs.md) — PageTabs is in-page navigation with an optional count on each tab.
- [RouteProgress](https://ui.lobehub.com/skills/components/dashboard/route-progress.md) — RouteProgress is a thin loading bar fixed to the top of the viewport.

### icons

#### Auth Icons

- [Auth0](https://ui.lobehub.com/skills/components/icons/auth0.md) — Provides the Auth0 monochrome icon and avatar variant, together with title and primary-color metadata.
- [Authelia](https://ui.lobehub.com/skills/components/icons/authelia.md) — Provides the Authelia monochrome icon and avatar variant, together with title and primary-color metadata.
- [Authentik](https://ui.lobehub.com/skills/components/icons/authentik.md) — Provides the Authentik monochrome icon and avatar variant, together with title and primary-color metadata.
- [Casdoor](https://ui.lobehub.com/skills/components/icons/casdoor.md) — Provides the Casdoor monochrome icon and avatar variant, together with title and primary-color metadata.
- [Clerk](https://ui.lobehub.com/skills/components/icons/clerk.md) — Provides the Clerk monochrome icon and avatar variant, together with title and primary-color metadata.
- [Cloudflare](https://ui.lobehub.com/skills/components/icons/cloudflare.md) — Re-exports the Cloudflare icon and avatar variants from @lobehub/icons.
- [Github](https://ui.lobehub.com/skills/components/icons/github.md) — Re-exports the GitHub icon and avatar variants from @lobehub/icons.
- [Logto](https://ui.lobehub.com/skills/components/icons/logto.md) — Provides the Logto monochrome icon and avatar variant, together with title and primary-color metadata.
- [MicrosoftEntra](https://ui.lobehub.com/skills/components/icons/microsoft-entra.md) — Provides the MicrosoftEntra monochrome icon and avatar variant, together with title and primary-color metadata.
- [NextAuth](https://ui.lobehub.com/skills/components/icons/next-auth.md) — Provides the NextAuth monochrome icon and avatar variant, together with title and primary-color metadata.
- [Zitadel](https://ui.lobehub.com/skills/components/icons/zitadel.md) — Provides the Zitadel monochrome icon and avatar variant, together with title and primary-color metadata.

#### Channel Icons

- [DingTalk](https://ui.lobehub.com/skills/components/icons/ding-talk.md) — Provides the DingTalk monochrome icon and avatar variant, together with title and primary-color metadata.
- [Discord](https://ui.lobehub.com/skills/components/icons/discord.md) — Provides the Discord monochrome icon and avatar variant, together with title and primary-color metadata.
- [GoogleChat](https://ui.lobehub.com/skills/components/icons/google-chat.md) — Provides the GoogleChat monochrome icon and avatar variant, together with title and primary-color metadata.
- [IMessage](https://ui.lobehub.com/skills/components/icons/i-message.md) — Provides the IMessage monochrome icon and avatar variant, together with title and primary-color metadata.
- [Lark](https://ui.lobehub.com/skills/components/icons/lark.md) — Provides the Lark monochrome icon and avatar variant, together with title and primary-color metadata.
- [Line](https://ui.lobehub.com/skills/components/icons/line.md) — Provides the Line monochrome icon and avatar variant, together with title and primary-color metadata.
- [MicrosoftTeams](https://ui.lobehub.com/skills/components/icons/microsoft-teams.md) — Provides the MicrosoftTeams monochrome icon and avatar variant, together with title and primary-color metadata.
- [QQ](https://ui.lobehub.com/skills/components/icons/qq.md) — Provides the QQ monochrome icon and avatar variant, together with title and primary-color metadata.
- [Slack](https://ui.lobehub.com/skills/components/icons/slack.md) — Provides the Slack monochrome icon and avatar variant, together with title and primary-color metadata.
- [Telegram](https://ui.lobehub.com/skills/components/icons/telegram.md) — Provides the Telegram monochrome icon and avatar variant, together with title and primary-color metadata.
- [WeChat](https://ui.lobehub.com/skills/components/icons/we-chat.md) — Provides the WeChat monochrome icon and avatar variant, together with title and primary-color metadata.
- [WhatsApp](https://ui.lobehub.com/skills/components/icons/whats-app.md) — Provides the WhatsApp monochrome icon and avatar variant, together with title and primary-color metadata.

#### Lucide Icons

- [Extra Icons](https://ui.lobehub.com/skills/components/icons/lucide-extra.md) — Exports the extended Lucide-compatible icon set for brands, pointer actions, agents, providers, and tree controls.

### mdx

#### Built-ins

- [Callout](https://ui.lobehub.com/skills/components/mdx/callout.md) — A styled component to highlight important content in an MDX document with different visual styles based on the content type (info, tip, war…
- [Cards](https://ui.lobehub.com/skills/components/mdx/cards.md) — A container component for displaying a collection of cards in an MDX document.
- [FileTree](https://ui.lobehub.com/skills/components/mdx/file-tree.md) — A component for displaying file and folder structures in MDX documents.
- [Steps](https://ui.lobehub.com/skills/components/mdx/steps.md) — A component for displaying ordered steps or instructions in MDX documents.
- [Tabs](https://ui.lobehub.com/skills/components/mdx/tabs.md) — A component for creating tabbed content in MDX documents that allows switching between different content sections.

#### Components

- [Mdx](https://ui.lobehub.com/skills/components/mdx/mdx.md) — A component that renders MDX content with enhanced features like LaTeX support, Mermaid diagrams, and customized MDX components.
- [mdxComponents](https://ui.lobehub.com/skills/components/mdx/mdx-components.md) — A collection of enhanced React components for rendering MDX content with improved styling and functionality.

### mobile

#### Chat

- [ChatInputArea](https://ui.lobehub.com/skills/components/mobile/chat-input-area.md) — The ChatInputArea component is used to display a chat input area with expandable and collapsible feature, and a send button to submit the c…

#### Layout

- [ChatHeader](https://ui.lobehub.com/skills/components/mobile/chat-header.md) — Provides a mobile chat header with optional safe-area padding, back navigation, and left, center, and right content slots.
- [SafeArea](https://ui.lobehub.com/skills/components/mobile/safe-area.md) — Adds top or bottom spacing for mobile safe-area insets.
- [TabBar](https://ui.lobehub.com/skills/components/mobile/tab-bar.md) — Renders a controlled or uncontrolled mobile tab bar with active-state render functions and optional bottom safe-area padding.

### spline

- [LogoThree](https://ui.lobehub.com/skills/components/spline/logo-three.md) — A 3D interactive logo component that renders a Spline-based 3D model of the LobeHub logo with a fallback image while loading.

### storybook

- [StoryBook](https://ui.lobehub.com/skills/components/storybook/story-book.md) — The StoryBook component is a customizable panel that can be used to display and edit data.

