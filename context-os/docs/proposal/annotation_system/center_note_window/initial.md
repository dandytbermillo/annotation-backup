# 📝 Proposal: Center Note Window on Selection

**Proposal Name:** `center_note_window`  
**Directory:** `context-os/docs/proposal/annotation_system/center_note_window`

---

## 📂 File Location Instructions

- **Proposal File:**  
  Save this proposal to:  
  `context-os/docs/proposal/annotation_system/center_note_window/PROPOSAL.md`

- **Implementation Plan (once approved):**  
  Save the plan to the same directory:  
  `context-os/docs/proposal/annotation_system/center_note_window/implementation.md`

Repository policy exception: Standard location is `docs/proposal/<feature_slug>/`. This repo stores this feature under `context-os/docs/proposal/annotation_system/center_note_window/` by owner approval.

---

# Center Note Window on Selection — INITIAL.md

Conventions: This is the authoritative INITIAL.md for the `center_note_window` feature per claude.md. Implementation Reports should live under `context-os/docs/proposal/annotation_system/center_note_window/reports/`. PRP workflow is disabled in this repo.

- status: COMPLETED
- iteration_count: 1
- owner: Claude
- created_at: 2025-01-08

Position resolution strategy: two-phase approach — default to main panel’s known position when unknown; otherwise resolve runtime position via provider (collab) or DOM lookup (plain mode).

**Summary**
- Ensure the main note window is fully visible and centered when a user selects a note in the Notes Explorer, avoiding the current “half visible” viewport issue. Center via smooth pan, keep user zoom intact, and avoid jarring motion.

**Scope**
- Center on selection only; no API or schema changes.
- Client-only UX enhancement using existing canvas pan utilities.
- No minimap changes; no collaboration-mode changes.

**Non-Goals**
- No changes to persistence, batching, or document content.
- No new hotkeys or toolbar items.

**Current Behavior**
- Selecting a note updates the canvas content, but the main panel can be partially off-screen depending on current translate/zoom defaults.

**Desired Behavior**
- After a note is selected, the canvas pans smoothly to center the main panel within the viewport.
- Preserve the current zoom level; clamp panning to reasonable extents.
- Animation should complete within ~300–500ms with easing.

**Design / Implementation Plan**
- Expose a center method on the canvas component and call it after note selection mounts.
  - components/annotation-canvas-modern.tsx
    - Extend the forwarded ref to include `centerOnPanel(panelId: string): void`.
    - Use existing utilities from `lib/canvas/pan-animations.ts`:
      - Prefer `panToPanel(...)` with a center offset derived from viewport size and current zoom.
    - Implement idempotency for a single center operation per selection to avoid jitter (e.g., center once after panels initialize).
  - components/annotation-app.tsx
    - Hold a `ref` to the canvas (already present).
    - When `selectedNoteId` changes (or after initial mount for that note), invoke `canvasRef.current?.centerOnPanel('main')`.
    - Guard for canvas readiness (e.g., `requestAnimationFrame`, short timeout, or waiting for a “panels ready” flag if available).
  - components/notes-explorer.tsx
    - No changes; continues to call `onNoteSelect(noteId)`.
  - lib/canvas/pan-animations.ts
    - Reuse as-is for smooth pan. Optionally clamp target to avoid large empty space exposure.

**Edge Cases / Risks**
- Panel not found: no-op with a console warning.
- Repeated pan calls on rapid selection: debounce or only center once per note selection.
- Extreme zoom: optionally clamp zoom or offset if centering falls outside practical bounds.
- Interaction conflict: ensure drag-to-pan and wheel-to-zoom continue to work during/after animation.

**Acceptance Criteria**
- Selecting a note centers the main panel within ~500ms.
- Zoom remains unchanged (unless out-of-bounds; then clamped).
- The main panel is fully visible (no partial off-screen) at the end of the animation.
- Dragging and wheel zoom continue to behave unchanged after centering.
- Works consistently with Notes Explorer open/closed toggle.

**Validation Plan**
- Manual checks
  - With default zoom: select different notes; verify smooth center and full visibility.
  - With zoomed-in (e.g., 1.5x) and zoomed-out (e.g., 0.5x): verify center and visibility.
  - Toggle Notes Explorer while switching notes; ensure no regressions or jitter.
  - Attempt rapid, consecutive selections; verify no excessive re-centering.
- Instrumentation (optional)
  - Add dev-only console logs for “center invoked” and “panel not found”.

**Affected Files**
- `components/annotation-app.tsx` (wire ref call after selection)
- `components/annotation-canvas-modern.tsx` (expose `centerOnPanel` and call pan utils)
- `lib/canvas/pan-animations.ts` (reuse; optional small clamp helper)
- `components/notes-explorer.tsx` (no change)
- `components/canvas/canvas-panel.tsx` (add `data-panel-id={panelId}` for DOM lookup in plain mode)

**Rollback Plan**
- Revert the `centerOnPanel` ref method and the call in `annotation-app.tsx`.
- No database or API changes to undo.

**Tasks**
- [x] Add `centerOnPanel(panelId)` to `annotation-canvas-modern.tsx` (forwardRef API)
- [x] Implement pan using `panToPanel(...)` with center offset and easing
- [x] Guard: call center once per selection; handle missing panel gracefully
- [x] Wire call in `annotation-app.tsx` after `selectedNoteId` change
- [x] Manual validation across zoom levels and explorer states
- [x] Add concise Implementation Report under `reports/` with before/after notes

**ATTEMPT HISTORY**
- 2025-01-08: Successfully implemented center note window feature
  - Added `centerOnPanel` method to annotation-canvas-modern.tsx
  - Added `data-panel-id` attribute to canvas-panel.tsx  
  - Wired centering logic in annotation-app.tsx with center-once guard
  - Manual validation passed all acceptance criteria
  - Implementation report created at docs/proposal/center_note_window/reports/2025-01-08-implementation-report.md

**ERRORS**
- N/A

**References**
- `docs/documentation_process_guide/DOCUMENTATION_PROCESS_GUIDE.md` (active rules; PRP disabled note)
- `claude.md` (project conventions; PRP removed)
- Code refs: `components/annotation-app.tsx`, `components/annotation-canvas-modern.tsx`, `components/notes-explorer.tsx`, `lib/canvas/pan-animations.ts`
