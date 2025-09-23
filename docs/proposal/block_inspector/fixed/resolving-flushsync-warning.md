# Resolving the `flushSync` Warning in the Block Inspector

## Context
While testing the floating block inspector, opening a block that contained annotation marks produced the React runtime warning:

> Warning: flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering.

The inspector content stayed interactive, but the warning signalled that TipTap was forcing synchronous renders while React was still reconciling the portal, leaving us exposed to potential breakage in future React releases.

## Root Cause
- The inspector was reusing the main document instance when rendering inside a portal. When annotation marks (implemented with React-driven NodeViews) were present, TipTap attempted to mount those NodeViews with `flushSync` because the editor was already initialised.
- React considers that call unsafe when it happens during another component’s render pass (the portal mounting), so every annotated block opened in the inspector logged the warning.

## Solutions Applied
1. **Isolated, read-only TipTap editor for the inspector.** `InspectorPreview` now instantiates its own TipTap editor with `editable: false`, seeded with a JSON snapshot produced by `buildInspectorDoc`. The snapshot expands nested collapsible blocks so everything is visible without mutating the live document.
2. **Lightweight annotation mark for preview mode.** The inspector extension set registers a minimal `AnnotationMark` that renders annotations as plain `<span>` elements, avoiding the React NodeView that triggered `flushSync`.
3. **Preview-mode collapsible NodeView.** `CollapsibleBlock.configure({ inspectorPreview: true })` switches the inspector editor to a simplified NodeView (`CollapsibleBlockPreview`) that toggles locally and never opens nested inspectors. This keeps interactions self-contained and prevents recursive portal mounts.
4. **Layout polish for the preview editor.** Supporting CSS updates tighten the header row, keep titles from expanding, and hide metadata while the action strip is visible, matching the compact layout expected in the floating inspector.

Together these changes let the inspector render annotated content without hitting TipTap’s synchronous re-render path, eliminating the warning while keeping the preview fully interactive.

## Affected Files
- `lib/extensions/collapsible-block.tsx`
  - Introduced the preview-mode TipTap editor (`InspectorPreview`), the lightweight `AnnotationMark`, and the shared helpers that build the inspector document.
  - Added layout adjustments and conditional metadata display inside `CollapsibleBlockFull` when actions are visible.
- `styles/tiptap-editor.css`
  - Added inspector-specific rules so collapsible headers align with their titles and long titles truncate cleanly within the preview editor.

## Current Status
- Opening any block—annotated or not—in the floating inspector no longer triggers the `flushSync` warning.
- The inspector preview remains non-editable but interactive (collapse/expand, reveal) and mirrors the document structure without risking side effects on the main editor.
