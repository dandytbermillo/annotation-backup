# Implementation Plan — Hover Icon + Popup for Annotated Text

Feature: `hover_annotation_icon`
Folder: `docs/proposal/hover_annotation_icon/`

Status: In Progress
Owner: Claude
Created: 2025-09-09

## Summary
Show a small "hover icon" when the cursor enters an annotated text span. Only when hovering the icon do we display the full annotation popup (title/preview). This reduces accidental popups while preserving discoverability. Works in both collaboration (Yjs) and plain modes.

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
Add a floating icon controlled by the existing TipTap hover plugin (AnnotationDecorations). On mouseover of an annotated decoration:
- Render a floating icon near the cursor or at the annotated span edge.
- When the user moves onto the icon, show the existing annotation tooltip at the icon.
- Hide icon/tooltip when the cursor is no longer over the annotated text, icon, or tooltip (with short delay).

Content source:
- Collaboration mode: use CollaborationProvider.getBranchesMap() to obtain preview (existing logic).
- Plain mode: fall back to the plain provider via getPlainProvider() and editor attributes (data-note/data-panel) to load content for a given branch/panel id.

---

## Changes by File

1) `components/canvas/annotation-decorations.ts`
- Extend the TipTap plugin to manage a floating icon element:
  - Create once (`.annotation-hover-icon`), position near cursor/annotation.
  - Store `data-branch-id` and `data-annotation-type` on the icon for later tooltip rendering.
  - On `mouseenter` of the icon: show tooltip anchored to the icon; mark as hovered.
  - On `mouseleave` of the icon: schedule hide with a short delay unless pointer is over target or tooltip.
- Update DOM event handlers:
  - `mouseover` on `.annotation-hover-target`: show & position icon, set `isOverTarget = true`.
  - `mouseout` on `.annotation-hover-target`: set `isOverTarget = false`; if neither icon nor target is hovered, hide icon/tooltip soon.
- Update `showAnnotationTooltip(anchor, branchId, type)` to accept the icon as the anchor. Keep existing positioning logic using `getBoundingClientRect()`.
- Plain-mode preview fallback (optional but recommended): if CollaborationProvider returns no data, use `getPlainProvider()` and editor root attributes (`[role="textbox"][data-note]`) to fetch the document content and compute a short text preview.

2) `components/canvas/tiptap-editor.tsx` and `components/canvas/tiptap-editor-plain.tsx`
- Ensure AnnotationDecorations plugin is included (already is).
- Inject minimal CSS for `.annotation-hover-icon` (collab + plain):
  - Fixed positioning, small circular black background, white icon (e.g., 🔎), box-shadow, `z-index: 10000`, `pointer-events: auto`.
- No functional editor changes required beyond style injection.

3) (No change required) `components/ui/tooltip.tsx` / Popover components
- Keep the existing DOM-based tooltip produced by the plugin to minimize ripple effects. A future enhancement could replace the raw tooltip with Radix UI Tooltip/Popover.

---

## Risks and Mitigations
- Flicker between target and icon/tooltip: use small delayed hide (150–200ms) and shared over‑state flags.
- Icon overlap with selection/toolbar: position near cursor with small offset; clamp to viewport.
- Plain mode data: ensure fallback read does not block UI; consider caching short previews.
- Accessibility: icon is purely hover‑triggered; future iteration can add keyboard navigation to the annotation tooltip.

---

## Validation
Manual checks:
- Hover annotated text → icon appears; moving onto icon shows tooltip; leaving both hides tooltip.
- Works at different zoom levels and viewport sizes.
- Rapid hovers do not cause flicker; tooltip is stable when moving from target → icon.
- Collab mode: preview loads from CollaborationProvider; Plain mode: preview loads via plain provider.

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

## Rollback Plan
- Remove hover icon creation and related event handlers in `annotation-decorations.ts`.
- Remove injected `.annotation-hover-icon` CSS snippets from editors.
- No backend or schema changes to revert.

---

## Timeline (suggested)
- Day 0.5: Implement icon + event plumbing; style injection.
- Day 0.5: Plain‑mode fallback + preview extraction; polish hide timing.
- Day 0.5: Validation + Implementation Report.