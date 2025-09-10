# Implementation Plan — Hover Icon + Popup for Annotated Text

Feature: `hover_annotation_icon`
Folder: `docs/proposal/hover_annotation_icon/`

Status: In Progress
Owner: Claude
Created: 2025-09-09

## Summary
Show a small hover icon when the cursor enters an annotated text span. Only when hovering the icon do we display the full annotation popup (title/preview). This reduces accidental popups while preserving discoverability. Works in both collaboration (Yjs) and plain modes.

## Goals
- Hovering annotated text reveals a small, non-intrusive icon near the cursor/text.
- Hovering the icon shows the annotation popup with a content preview.
- No flicker: delayed hide with overlap detection (target vs icon vs tooltip).
- Works in both TipTap editors (collab + plain); minimal changes elsewhere.

## Out of Scope
- No changes to persistence schema or API.
- No changes to annotation creation UX, only hover behavior.
- No changes to existing panel centering code.

---

## Migration Note
Migrated from `context-os/docs/proposal/annotation_system/` on 2025-09-09.

---

## Approach
Add a floating icon controlled by a TipTap hover plugin. On mouseover of an annotated decoration:
- Render a floating icon near the cursor or at the annotated span edge.
- When the user moves onto the icon, show the existing annotation tooltip at the icon.
- Hide icon/tooltip when the cursor is no longer over the annotated text, icon, or tooltip (with short delay).

Content source:
- Collaboration (Yjs) mode: the in-file tooltip logic inside `components/canvas/annotation-decorations.ts` loads branch content and applies the scrollbar when content is long.
- Plain mode: the shared tooltip in `components/canvas/annotation-tooltip.ts` fetches branch metadata and document content, sanitizes to text, and auto-enables the scrollbar.

See also: `TOOLTIP_REFERENCE.md` for a deep dive into data flow, auto-scroll, positioning, and safety notes.

---

## Changes by File (current state)

1) `components/canvas/annotation-decorations-hover-only.ts` (Plain mode hover UI)
- Creates the square hover icon (SVG rect) next to annotated text, without intercepting mousedown/mouseup.
- Delegates tooltip display to the shared `annotation-tooltip.ts` module.

2) `components/canvas/annotation-tooltip.ts` (Plain mode tooltip)
- Shared tooltip implementation: fetches branch metadata and document content, converts to plain text, and applies auto-scroll when long.

3) `components/canvas/webkit-annotation-cursor-fix.ts` (Cursor placement)
- Dedicated cursor-placement fix module registered before hover UI in plain mode.
- Note: Intended for Safari/Chrome. Current code path applies globally (no UA gating active).

4) `components/canvas/annotation-decorations.ts` (Yjs mode)
- Contains its own (emoji) hover icon and in-file tooltip logic (not using the shared tooltip module yet).
- Applies the same scrollbar behavior on long content via `.tooltip-content` sizing and checks.

---

## Risks and Mitigations
- Flicker between target and icon/tooltip: use small delayed hide (150–300ms) and shared over‑state flags.
- Icon overlap with selection/toolbar: position near cursor with small offset; clamp to viewport.
- Plain mode data: ensure fetch doesn’t block UI; consider caching short previews.
- Accessibility: icon is hover‑triggered; add keyboard access in a follow-up.
- Security: tooltip content is sanitized to text; titles are inserted via `innerHTML` and should be HTML‑escaped in future.

---

## Validation
Manual checks:
- Hover annotated text → icon appears; moving onto icon shows tooltip; leaving both hides tooltip.
- Works at different zoom levels and viewport sizes.
- Rapid hovers do not cause flicker; tooltip is stable when moving from target → icon.
- Yjs mode: in-file tooltip logic shows content and scrolls.
- Plain mode: shared tooltip module shows content and scrolls.

---

## Acceptance Criteria
- Hovering annotated text shows an icon within <100ms near cursor or span edge.
- Hovering the icon shows a tooltip with title/preview within <150ms.
- No tooltip appears unless the icon is hovered (not just text hover).
- Works in both collab and plain modes; preview sources are correct.
- No regressions to selection/editing interactions.

---

## Deliverables
- Updated files:
  - `components/canvas/annotation-decorations.ts` (hover icon, logic, plain‑mode fallback)
  - `components/canvas/tiptap-editor.tsx` (style injection for icon)
  - `components/canvas/tiptap-editor-plain.tsx` (style injection for icon)
- Short implementation report under `reports/` with before/after notes and screenshots/gifs.

---

## ATTEMPT HISTORY

### 2025-01-10: Safari Cursor Fix and Tooltip Restoration
- **Issue**: Cursor not appearing when clicking annotated text in Safari/Chrome/Electron
- **Approach**: 
  1. Identified WebKit bug with position: relative on inline elements
  2. Created webkit-annotation-cursor-fix.ts for browser-specific handling
  3. Replaced AnnotationDecorations with non-blocking hover-only version
  4. Extracted and restored original tooltip from backup repository
- **Result**: ✅ Successfully fixed cursor placement in all browsers
- **Files**: See report 2025-01-10-implementation-report.md

---

## ERRORS

### Error 1: CSS Position Breaking Safari Cursor (2025-01-10)
- **Root Cause**: WebKit bug - position: relative on inline elements hides cursor in contenteditable
- **Reproduction**: Click any annotated text in Safari/Chrome
- **Fix**: Removed position: relative, transform, and z-index from annotation CSS
- **Artifacts**: components/canvas/safari-proven-fix.ts (attempted)

### Error 2: Event Handlers Blocking Clicks (2025-01-10)
- **Root Cause**: AnnotationDecorations mousedown/mouseup handlers intercepting clicks
- **Reproduction**: Even with CSS fixed, clicks didn't place cursor
- **Fix**: Created annotation-decorations-hover-only.ts without blocking handlers
- **Artifacts**: components/canvas/annotation-decorations-hover-only.ts

### Error 3: Tooltip Not Showing Original Design (2025-01-10)
- **Root Cause**: New implementations didn't match original API flow and structure
- **Reproduction**: Hover showed wrong tooltip without proper data
- **Fix**: Copied exact implementation from backup repository
- **Artifacts**: components/canvas/annotation-tooltip.ts from backup

---

## WORKING CODE SOLUTIONS

### Square Hover Icon Implementation
**File**: `components/canvas/annotation-decorations-hover-only.ts`
- Creates square SVG icon: `<rect x="3" y="3" width="18" height="18" rx="2" ry="2">`
- No mousedown/mouseup handlers (doesn't block clicks)
- Connects to tooltip on hover: `showAnnotationTooltip(branchId, type, hoverIcon!)`
- See full code: `post-implementation-fixes/working-code-solutions.md`

### Tooltip with Correct Branch Data
**File**: `components/canvas/annotation-tooltip.ts`
- Two-step API flow:
  1. Fetch branches: `/api/postgres-offline/branches?noteId=${noteId}`
  2. Fetch document: `/api/postgres-offline/documents/${noteId}/${branchId}`
- ID normalization: `branch-UUID` (UI) vs `UUID` (DB)
- Auto-scrollbar: `checkTooltipScrollable()` function
- See full code: `post-implementation-fixes/working-code-solutions.md`

### WebKit Cursor Fix
**File**: `components/canvas/webkit-annotation-cursor-fix.ts`
- Detects WebKit browsers (Safari/Chrome)
- Manually places cursor using ProseMirror's TextSelection API
- Registered BEFORE hover plugins to handle clicks first

### CSS Fix
**File**: `components/canvas/tiptap-editor-plain.tsx`
```css
/* Removed these problematic properties */
.annotation {
  /* position: relative; REMOVED */
  /* transform: translateY(-1px); REMOVED */
  /* z-index: 1; REMOVED */
}
```

### Plugin Registration Order (Critical)
```typescript
// Order matters - cursor fix first!
editor.registerPlugin(WebKitAnnotationCursorFix())
editor.registerPlugin(AnnotationDecorationsHoverOnly())
```

---

## Rollback Plan
- Remove hover icon creation and related event handlers in `annotation-decorations.ts`.
- Remove injected `.annotation-hover-icon` CSS snippets from editors.
- No backend or schema changes to revert.

---

## Timeline (suggested)
- Day 0.5: Implement icon + event plumbing; style injection.
- Day 0.5: Plain‑mode fallback + preview extraction; polish hide timing.
- Day 0.5: Validation + Implementation Report.
