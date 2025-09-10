# Tooltip Reference — Hover Annotation Icon

Status: Current implementation (synced 2025-09-10)

This document explains how the annotation tooltips are built, triggered, and populated in both editors (plain mode and Yjs). It also captures UX details, data flow, auto-scroll behavior, positioning, and safety notes.

## Overview

- Two implementations are currently in use:
  - Plain mode: square hover icon (AnnotationDecorationsHoverOnly) + shared tooltip module (`components/canvas/annotation-tooltip.ts`).
  - Yjs editor: magnifier emoji hover icon + inline tooltip logic (`components/canvas/annotation-decorations.ts`).
- Both implementations present the same structure and scroll behavior to the user.

## Trigger & UX

- Hover over annotated text → a hover icon appears (square in plain mode; emoji in Yjs).
- Hover over the icon → tooltip appears next to the icon.
- Leave icon/tooltip → tooltip hides after ~300ms (grace period to avoid flicker).
- The tooltip element is a single DOM node reused across events (`div.annotation-tooltip`) with sections:
  - `.tooltip-header` (icon + title)
  - `.tooltip-content` (text preview)
  - `.tooltip-footer` (hint text)
- Visibility class: `.annotation-tooltip.visible` enables pointer events and transitions.

## Data Flow

1) Note ID detection (plain & Yjs)
- Extracted from current URL path `/note/:noteId` or from `[data-note-id]` / `[data-note]` attributes.

2) Branch/Panel ID normalization
- UI uses `branch-<uuid>`; database uses raw `<uuid>`.
- The code strips `branch-` when calling APIs that expect raw IDs.

3) API endpoints (plain & Yjs)
- Branch metadata: `GET /api/postgres-offline/branches?noteId=:noteId` (for title/type sanity and existence).
- Document content: `GET /api/postgres-offline/documents/:noteId/:panelId` (where `:panelId` is the UI format `branch-<uuid>`).

## Content Processing

- If document content is HTML: strip all tags before rendering (plain text only).
- If document content is ProseMirror JSON: recursively extract text nodes.
- Empty state: when no content is present, show “No notes added yet”.
- Error state: show “Error loading content” while preserving structural sections.

## Auto-Scroll Behavior

- The tooltip auto-enables vertical scrolling when content exceeds the maximum height.
- JS check: `checkTooltipScrollable()` compares `.tooltip-content.scrollHeight` vs `.clientHeight` and toggles:
  - `contentEl.style.overflowY = 'auto'` and tooltip class `has-scroll` when overflowing
  - `overflowY = 'hidden'` otherwise
- CSS caps (editor-specific):
  - Yjs: container `max-height: ~400px` (`.annotation-tooltip`), scrollbar on the container; custom scrollbar styles present.
  - Plain mode: `.tooltip-content { max-height: ~250px; overflow-y: auto }` within the tooltip; custom scrollbar styles present.

## Positioning

- Anchor: the tooltip is positioned relative to the hovered icon using `getBoundingClientRect()`.
- Plain mode: positioned to the right of the icon with a +10px x-offset; no extra viewport clamping.
- Yjs mode: positioned above/below depending on space, with simple clamping to avoid off-screen (adjusts top/left within window bounds).

## Files & Responsibilities

- Plain mode
  - `components/canvas/annotation-decorations-hover-only.ts`: shows square icon; delegates to tooltip module.
  - `components/canvas/annotation-tooltip.ts`: creates and updates the tooltip; handles data fetch, sanitization, and auto-scroll.
  - `components/canvas/tiptap-editor-plain.tsx`: includes CSS for `.annotation-tooltip` and `.tooltip-content` (max heights, scrollbars).

- Yjs editor
  - `components/canvas/annotation-decorations.ts`: emoji icon; in-file tooltip logic and scroll detection.
  - `components/canvas/tiptap-editor.tsx`: includes CSS for `.annotation-tooltip` (container max height and scrollbars).

## Safety & Performance

- Content safety: Tooltip body text is sanitized (HTML stripped, PM JSON traversed) before insertion.
- Title insertion: `branch.title` is currently inserted via `innerHTML` (not escaped). Treat as trusted or escape in a future hardening pass.
- No external scripts or iframes are used; only first‑party API calls.
- A single tooltip element is reused; event listeners are attached once and cleaned up by the plugins.

## Known Differences & Future Work

- Unification: Yjs still uses inline tooltip logic; plain mode uses the shared module. A future refactor could centralize both on the shared module.
- Title escaping: escape `branch.title` when inserting into the tooltip.
- UA gating: the cursor-fix plugin is intended for Safari/Chrome; it currently applies globally (plain mode). Consider enabling UA gating.
- Position clamping: bring the more robust Yjs clamping logic to the shared tooltip for consistency.
- Accessibility: add keyboard support and ARIA roles for the tooltip and hover icon.

