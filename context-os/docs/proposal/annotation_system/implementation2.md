can # Implementation Plan — Hover Icon + Popup for Annotated Text

Feature: `hover_annotation_icon`
Folder (temp): `context-os/docs/proposal/annotation_system/`

Status: draft
Owner: <assign>
Created: <YYYY-MM-DD>

## Summary
Show a small “hover icon” when the cursor enters an annotated text span. Only when hovering the icon do we display the full annotation popup (title/preview). This reduces accidental popups while preserving discoverability. Works in both collaboration (Yjs) and plain modes.

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

## Example (sketch code)

AnnotationDecorations additions (conceptual):
```
let hoverIcon: HTMLDivElement | null = null
let isOverIcon = false
let isOverTarget = false
let hoverIconHideTimeout: NodeJS.Timeout | null = null

function ensureHoverIcon() {
  if (hoverIcon) return
  hoverIcon = document.createElement('div')
  
  hoverIcon.className = 'annotation-hover-icon'
  hoverIcon.innerHTML = '🔎'
  hoverIcon.style.cssText = 'position:fixed;display:none;z-index:10000;'
  document.body.appendChild(hoverIcon)

  hoverIcon.addEventListener('mouseenter', () => {
    isOverIcon = true
    const id = hoverIcon!.getAttribute('data-branch-id') || ''
    const type = hoverIcon!.getAttribute('data-annotation-type') || 'note'
    if (id) showAnnotationTooltip(hoverIcon!, id, type)
  })
  hoverIcon.addEventListener('mouseleave', () => {
    isOverIcon = false
    hideHoverIconSoon()
    hideAnnotationTooltipSoon()
  })
}

function positionHoverIcon(x: number, y: number) {
  const OFFSET = 8
  hoverIcon!.style.left = `${x + OFFSET}px`
  hoverIcon!.style.top  = `${y - OFFSET}px`
}

function showHoverIcon(targetEl: HTMLElement, branchId: string, type: string, evt: MouseEvent) {
  ensureHoverIcon()
  hoverIcon!.setAttribute('data-branch-id', branchId)
  hoverIcon!.setAttribute('data-annotation-type', type)
  positionHoverIcon(evt.clientX, evt.clientY)
  hoverIcon!.style.display = 'block'
}

function hideHoverIconSoon() {
  if (hoverIconHideTimeout) clearTimeout(hoverIconHideTimeout)
  hoverIconHideTimeout = setTimeout(() => {
    if (!isOverIcon && !isOverTarget && hoverIcon) hoverIcon.style.display = 'none'
  }, 180)
}
```

Handlers (within `props.handleDOMEvents`):
```
mouseover(view, event) {
  const target = event.target as HTMLElement
  const ann = target.closest('.annotation-hover-target') as HTMLElement
  if (ann) {
    isOverTarget = true
    const id = ann.getAttribute('data-branch-id') || ''
    const type = ann.getAttribute('data-annotation-type') || 'note'
    showHoverIcon(ann, id, type, event as MouseEvent)
    ann.classList.add('annotation-hovered')
  }
  return false
},
mouseout(view, event) {
  const target = event.target as HTMLElement
  const ann = target.closest('.annotation-hover-target') as HTMLElement
  if (ann) {
    isOverTarget = false
    ann.classList.remove('annotation-hovered')
    hideHoverIconSoon()
    hideAnnotationTooltipSoon()
  }
  return false
}
```

Minimal CSS (collab + plain editors):
```
.annotation-hover-icon {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(0,0,0,0.85); color: #fff; font-size: 12px;
  line-height: 22px; text-align: center; border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer; user-select: none;
}
```

Plain-mode content fallback (inside `showAnnotationTooltip`):
```
import { getPlainProvider } from '@/lib/provider-switcher'

const provider = CollaborationProvider.getInstance()
const map = provider.getBranchesMap()
let data = map.get(branchId)

if (!data) {
  const root = element.closest('.tiptap-editor-wrapper') || document.body
  const textbox = root.querySelector('[role="textbox"]') as HTMLElement | null
  const noteId = textbox?.getAttribute('data-note') || ''
  const plain = getPlainProvider()
  if (plain && noteId) {
    // Use your adapter to load content and compute preview from JSON/HTML
  }
}
```

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

## Repository Location and Structure (Required)

Migrate this feature to the canonical path and enforce the standard structure:
- Move to `docs/proposal/hover_annotation_icon/`.
- Move this `implementation2.md` (rename to `implementation.md`) and create `initial.md` there.
- Create subfolders:
  - `reports/` (main Implementation Report)
  - `implementation-details/`
  - `post-implementation-fixes/` (include `README.md` index)
- Add a note in `initial.md`: “Migrated from `context-os/docs/proposal/annotation_system/` on <YYYY-MM-DD>.”

If migration is blocked, proceed temporarily in the current location and record the deviation (see next section). Complete the migration when unblocked.

Note: This structure aligns with ACTIVE RULES in `docs/documentation_process_guide/DOCUMENTATION_PROCESS_GUIDE.md`. The subfolders listed above are mandatory for this feature.

---

## Deviation Logging Requirements
- Implementation Report: include “Deviations From Implementation Plan/Guide” for any structural or behavioral differences.
- `initial.md`: append entries in `ATTEMPT HISTORY` and add an `ERRORS` item if canonical structure cannot be followed (reason + workaround + next steps).

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

