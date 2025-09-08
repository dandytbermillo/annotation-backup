# Implementation Plan — Center Note Window on Selection

Feature: `center_note_window`
Folder: `context-os/docs/proposal/annotation_system/center_note_window/`

Status: draft
Owner: <assign>
Created: <YYYY-MM-DD>

## Summary
Center the main note panel in the viewport when a user selects a note in the Notes Explorer. Use smooth panning, preserve user zoom, and avoid jarring motion. No backend changes.

## Goals
- Panel becomes fully visible and centered within ~300–500ms after selection
- Preserve current zoom; only pan unless out-of-bounds
- No regressions to drag-to-pan or wheel-to-zoom

## Out of Scope
- No API/schema changes
- No minimap behavior changes
- No collaboration-mode-specific logic

---

## Approach
Expose a `centerOnPanel(panelId: string)` imperative method from the canvas, then invoke it when `selectedNoteId` changes. Use existing pan utilities (`lib/canvas/pan-animations.ts`) to compute and animate the pan.

To locate a panel’s world position, use a two-stage strategy:
- Phase 1 (minimal): Center the default “main” panel using its known default position when panel positions are not yet available.
- Phase 2 (robust): Resolve actual panel position at runtime:
  - Collaboration mode: `UnifiedProvider.getInstance().getBranchesMap()` → `branch.position`
  - Plain mode: query the DOM for `[data-panel-id="<id>"]` and derive world coordinates from element bounding box by inverting canvas transform (translate/scale).
 - Center-once guard: Track the last centered note id and avoid repeated centering for the same selection (e.g., using a ref in `annotation-app.tsx`).

---

## Changes by File

1) components/annotation-canvas-modern.tsx
- Extend the forwarded ref interface to include `centerOnPanel(panelId: string)`.
- Implement `centerOnPanel` using `panToPanel`:
  - Map internal state `{ translateX, translateY, zoom }` → `ViewportState` `{ x, y, zoom }` expected by pan utils.
  - Provide `getPanelPosition(id)` implementation:
    - Try collaboration map if not in plain mode
    - In plain mode, fallback to DOM-based lookup and, if missing, default `{ x: 2000, y: 1500 }` for `main`.
- Optional: clamp overshoot after animation to avoid large empty-space exposure.

Example (sketch):
```
import { panToPanel } from '@/lib/canvas/pan-animations'

useImperativeHandle(ref, () => ({
  ...existing,
  centerOnPanel: (panelId: string) => {
    const getPanelPosition = (id: string) => {
      // 1) Collaboration map
      const provider = UnifiedProvider.getInstance()
      if (getPlainProvider() == null) {
        const m = provider.getBranchesMap()
        const b = m?.get(id)
        if (b?.position) return b.position
      }
      // 2) DOM (plain mode)
      const el = document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        const container = document.getElementById('canvas-container')
        const containerRect = container?.getBoundingClientRect()
        const screenX = (rect.left + rect.width / 2) - (containerRect?.left ?? 0)
        const screenY = (rect.top + rect.height / 2) - (containerRect?.top ?? 0)
        // Convert screen → world coords: invert current translate/scale
        const worldX = screenX / canvasState.zoom - canvasState.translateX
        const worldY = screenY / canvasState.zoom - canvasState.translateY
        return { x: worldX, y: worldY }
      }
      // 3) Fallback default for 'main'
      if (id === 'main') return { x: 2000, y: 1500 }
      return null
    }

    panToPanel(
      panelId,
      getPanelPosition,
      { x: canvasState.translateX, y: canvasState.translateY, zoom: canvasState.zoom },
      (v) => setCanvasState(prev => ({
        ...prev,
        translateX: v.x ?? prev.translateX,
        translateY: v.y ?? prev.translateY,
        zoom: v.zoom ?? prev.zoom,
      })),
      { duration: 400 }
    )
  }
}), [canvasState])
```

2) components/annotation-app.tsx
- Invoke centering when `selectedNoteId` changes, after the canvas mounts the selected note.

Example:
```
useEffect(() => {
  if (!selectedNoteId) return
  // Center once per selection; allow layout to settle
  if (lastCenteredRef.current !== selectedNoteId) {
    lastCenteredRef.current = selectedNoteId
    const id = requestAnimationFrame(() => {
      canvasRef.current?.centerOnPanel?.('main')
    })
    return () => cancelAnimationFrame(id)
  }
}, [selectedNoteId])
```

3) components/canvas/canvas-panel.tsx
- Add a data attribute to aid DOM lookup in plain mode:
```
<div className="panel" data-panel-id={panelId} ...>
```

---

## Risks and Mitigations
- Panel not found: no-op + console.warn; fallback to default for `main`.
- Timing (panel not mounted yet): use `requestAnimationFrame`/short timeout after note selection to allow render.
- Extreme zoom: clamp via optional bounds on translate, or use a max pan distance.
- Interaction conflicts: ensure animation respects `isDragging` and stops or defers while dragging.

---

## Validation
Manual checks:
- Default zoom, select several notes → centered within ~500ms
- Zoomed in/out → centered and fully visible, zoom unchanged
- Toggle Notes Explorer open/closed → no regressions
- Rapid consecutive selections → no jitter or repeated re-centering loops

(Optional) Add dev logs on center invoke and fallbacks used.

---

## Acceptance Criteria (from INITIAL.md)
- Selecting a note centers the main panel within ~500ms
- Zoom remains unchanged (unless clamped)
- Main panel fully visible at end of animation
- Drag/wheel interactions unaffected after centering
- Works with Notes Explorer toggle

---

## Deliverables
- Updated files:
  - `components/annotation-canvas-modern.tsx` (imperative method)
  - `components/annotation-app.tsx` (effect to invoke)
  - `components/canvas/canvas-panel.tsx` (data attribute)
- Short implementation report under `reports/` with before/after notes

---

## Repository Location and Structure (Required)

Migrate the feature to the canonical path and enforce the standard structure:

- Move the feature to `docs/proposal/center_note_window/`.
- Move `initial.md` and `implementation.md` into that folder.
- Create subfolders:
  - `reports/` (main Implementation Report lives here)
  - `implementation-details/`
  - `post-implementation-fixes/` (include a `README.md` index)
- Add a note in `initial.md`: “Migrated from `context-os/...` on <YYYY-MM-DD>.”

If migration is blocked (permissions/policy), proceed temporarily in the current location and record the deviation (see next section). Once unblocked, complete the migration.

Note: This structure aligns with the ACTIVE RULES in `docs/documentation_process_guide/DOCUMENTATION_PROCESS_GUIDE.md`. The subfolders listed above are mandatory for this feature.

---

## Deviation Logging Requirements

- Implementation Report (under `reports/`): include a “Deviations From Implementation Plan/Guide” section that lists any differences from this `implementation.md` and any Directory Structure exceptions (with rationale).
- `initial.md`: if the canonical structure could not be followed, append an entry in `ATTEMPT HISTORY` and add an item in `ERRORS` that explains the constraint and the chosen workaround (path used, artifacts created, and next steps to reconcile).

---

## Rollback Plan
- Remove `centerOnPanel` from the canvas imperative API and the effect in `annotation-app.tsx`.
- Remove the `data-panel-id` attribute if undesired. No backend changes to revert.

---

## Timeline (suggested)
- Day 0.5: Implement imperative method + data attribute
- Day 0.5: Wire effect in `annotation-app.tsx` and validate manually
- Day 0.5: Polish (clamp, logs), draft Implementation Report
