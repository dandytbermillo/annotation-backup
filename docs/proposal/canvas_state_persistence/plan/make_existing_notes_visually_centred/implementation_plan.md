# Canvas – Visually Center Existing Notes on Open

## Objective
Existing notes (opened via Recents, popup overlays, tabs, etc.) should appear centered in the current viewport, just like newly created notes. The new-note pipeline already achieves this through `freshNoteSeeds` + workspace caching; this plan evolves the existing-note path so reopening a note flows through the exact same centering logic while still allowing users to “restore” their saved layouts on demand.

## Current Behaviour (2025-10-24)
- `handleNoteSelect` resolves `mainPosition` in this order: `options.initialPosition` → `resolveMainPanelPosition` (cached/persisted) → `computeViewportCenteredPosition`.
- When a stored workspace position exists, the note reopens exactly where it was last viewed; otherwise it falls back to the viewport center.
- Users with carefully arranged canvases rely on persisted positions to keep spatial layouts intact.

## Proposed Behaviour
1. Center every existing note on the live viewport (unless an explicit `initialPosition` is supplied).
2. Feed that centered world coordinate through the same `freshNoteSeeds`/workspace cache used for creation so the renderer receives it before the first paint (no “snap”).
3. Apply the same deterministic diagonal offset for consecutive opens to avoid perfect overlap.
4. Provide a “Restore position” affordance so users can jump back to the persisted coordinate when desired.
5. Gate the change behind a feature flag (or config toggle) so we can roll back to persisted positioning if needed.

## Implementation Plan

### 1. Seed existing notes via the workspace pipeline
- **Files**: `components/annotation-app.tsx`, `components/canvas/canvas-workspace-context.tsx`
  - Extend `freshNoteSeeds` so re-opened notes are assigned a centered world coordinate before `openWorkspaceNote` runs.
  - Immediately cache that coordinate in `positionCacheRef`/`workspaceEntry.mainPosition` (same as the new-note flow) so `resolveWorkspacePosition` returns it to the renderer on the first paint.
  - Ensure `resolveWorkspacePosition` only treats the legacy `{2000, 1500}` position as “default”; if the centered coordinate happens to equal `getDefaultMainPosition()` it must still pass through.

### 2. Centering Logic in `handleNoteSelect`
- **File**: `components/annotation-app.tsx`
  - If `options.initialPosition` is supplied (e.g., popup overlay), respect it.
  - Otherwise compute the viewport-centered world coordinate (`computeVisuallyCenteredWorldPosition`) and store it in `freshNoteSeeds[noteId]` before calling `openWorkspaceNote`.
  - Reuse the rapid-open offset counter from the new-note path, then pass the offset position into `openWorkspaceNote`.
  - Only request the main panel when opening; defer other panels so the centered view stays uncluttered.

### 3. Restore Position affordance
- **File**: `components/annotation-canvas-modern.tsx` (panel header UI)
  - Add a small “Restore position” control (text button or icon such as 📍/🎯).
  - When clicked, look up the persisted workspace coordinate and pan/animate the camera there (reuse `panToPanel` or `centerOnPanel`).
  - Show the control only when a persisted position exists and differs from the centered spawn; otherwise hide/disable it.

### 4. Offset Helper & Cleanup
- **File**: `components/annotation-app.tsx`
  - Reuse the diagonal offset logic from new note creation (`sequence.count * 50px`) so consecutive opens step slightly down/right.
  - After `ModernAnnotationCanvas` consumes a seed (see `noteIds_sync_creating_new_panel`), call `onConsumeFreshNoteSeed` to remove the entry and avoid stale data.

### 5. Telemetry & Rollback Safety
- Emit a specific `debugLog` (e.g., `open_note_centered_override_existing`) when the centered flow runs, capturing saved vs. centered coordinates. This supports quick rollback if users miss the old behaviour.
- Keep the feature flag documented in `docs/configuration` so QA can toggle it easily.

## Testing
- Manual:
  1. Open existing notes via Recents, popup overlays, and tab switches; confirm they spawn centered with the offset applied (no off-screen snap).
  2. Click “Restore position” to ensure the camera animates back to the saved coordinates.
  3. Open multiple notes rapidly and confirm they only shift by the offset (no alternating legacy positions).
  4. Move a note, close it, reopen centered, then restore—verify the persisted layout remains available.
- Regression:
  - Re-run the new-note centering tests to ensure fresh notes still spawn in view.
  - Verify provider initialization and `resolveWorkspacePosition` continue to respect centered seeds (check debug logs).
  - Confirm feature flag toggling reverts to persisted behaviour cleanly.

Saved: 2025-10-24  
Owner: Canvas Platform Team
