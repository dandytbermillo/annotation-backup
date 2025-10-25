# Canvas – Visually Center Existing Notes on Open

## Objective
Existing notes (opened via Recents, popup overlays, tabs, etc.) should appear centered in the current viewport, just like newly created notes. We will temporarily ignore previously persisted positions so the user’s current context always determines where the panel spawns. A small offset will prevent stacked overlaps during rapid openings.

## Current Behaviour (2025-10-24)
- `handleNoteSelect` resolves `mainPosition` in this order: `options.initialPosition` → `resolveMainPanelPosition` (cached/persisted) → `computeViewportCenteredPosition`.
- When a stored workspace position exists, the note reopens exactly where it was last viewed; otherwise it falls back to the viewport center.
- Users with carefully arranged canvases rely on persisted positions to keep spatial layouts intact.

## Proposed Behaviour
1. Center every existing note on the live viewport (except when an explicit `initialPosition` is supplied).
2. Apply a deterministic diagonal offset for consecutive opens to avoid perfect overlap.
3. Gate the change behind a feature flag (or config toggle) so we can roll back to persisted positioning if needed.

## Implementation Plan

### 1. Center defaults inside the workspace pipeline
- **Files**: `components/canvas/canvas-context.tsx`, `components/canvas/canvas-workspace-context.tsx`
  - Keep the earlier centered defaults so every empty workspace boots at `{translateX: 0, translateY: 0}`.
  - Ensure existing notes still persist their saved coordinates in storage.

### 2. Centering Logic in `handleNoteSelect`
- **File**: `components/annotation-app.tsx`
  - If `options.initialPosition` is supplied (e.g., popup overlay), respect it.
  - Otherwise skip `resolveMainPanelPosition` and center the main panel using `computeViewportCenteredPosition`.
  - Call `computeViewportCenteredPosition(cameraState)` to derive the center. If the camera isn’t ready, fall back to the shared centered helper used for new notes.
  - Apply the rapid-open offset (based on the same counter used for new notes) before passing the position to `openWorkspaceNote`.
  - Only request the main panel when opening; suppress any hydrated branch panels so the centered view stays uncluttered.

### 3. Restore Position affordance
- **File**: `components/annotation-canvas-modern.tsx` (panel header UI)
  - Add a small “Restore position” control (text button or icon such as 📍/🎯).
  - When clicked, look up the persisted workspace coordinate and pan/animate the camera there (reuse `panToPanel` or `centerOnPanel`).
  - Show the control only when a persisted position exists and differs from the centered spawn; otherwise hide/disable it.

### 4. Offset Helper
- **File**: `components/annotation-app.tsx` (or shared util)
  - Reuse the diagonal offset logic from new note creation (`sequence.count * 50px`) so consecutive opens step slightly down/right.

### 5. Telemetry & Rollback Safety
- Emit a specific `debugLog` (e.g., `open_note_centered_override`) when the centered flow runs, capturing the old vs. new coordinates. This supports quick rollback if users miss the old behaviour.
- Keep the feature flag documented in `docs/configuration` so QA can toggle it easily.

## Testing
- Manual:
- Manual:
  1. Open existing notes via Recents, popup overlays, and tab switches; confirm they spawn centered with the offset applied.
  2. Click “Restore position” to ensure the camera animates back to the saved coordinates.
  3. Open multiple notes rapidly and confirm they don’t cover one another completely.
- Regression:
  - Re-run the new-note centering tests to ensure fresh notes still spawn in view.
  - Verify persisted positions remain stored and are used when “Restore position” is invoked.

Saved: 2025-10-24  
Owner: Canvas Platform Team
