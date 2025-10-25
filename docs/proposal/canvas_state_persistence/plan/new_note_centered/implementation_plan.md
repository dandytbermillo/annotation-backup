# Canvas – Predictable Centered Spawn for New Notes

## Objective
When a user creates a note via the floating toolbar’s “+ Note” button, the new panel should appear in the middle of the current viewport without panning the existing canvas. The new panel should be visually highlighted so it is immediately discoverable, while existing panels/connection lines remain undisturbed.

## Current Behaviour (2025-10-24)
- `handleNoteSelect` opens the note without panning, but when no position is provided the workspace still falls back to the legacy `{ x: 2000, y: 1500 }` seed.
- The first render therefore lands near the minimap; hydration later corrects it, producing the “off-screen then snap” behaviour.
- Canvas provider and workspace caching both persist the legacy default, so reloading restores the same off-screen location.

## Proposed Behaviour
1. Do **not** pan the camera.
2. Spawn the new note at the world coordinate that corresponds to the current viewport center.
3. Apply a brief “new note” highlight (existing glow utility or light animation) so the user’s attention stays on the new panel.

## Implementation Plan

### 1. Center defaults inside the workspace pipeline
- **File**: `components/canvas/canvas-context.tsx`
  - Replace the legacy canvas bootstrap of `translateX: -1000`, `translateY: -1200` with a neutral `{0, 0}` camera.
  - When seeding the plain-mode data store, compute the first panel’s position from the viewport centre (using `DEFAULT_PANEL_DIMENSIONS`) and treat `{2000, 1500}` as legacy-only.
- **File**: `components/canvas/canvas-workspace-context.tsx`
  - Update `calculateSmartDefaultPosition` to call the same centred helper when no cached position exists so `openWorkspaceNote` never falls back to minimap coordinates.
  - Keep the diagonal offset for rapid consecutive creations so new notes don’t overlap, but base the first position on the centred defaults.

### 2. Feed the centred position into the note-opening flow
- **File**: `components/annotation-app.tsx`
  - Continue using `computeViewportCenteredPosition(cameraState)` when `options.initialPosition` is missing; guard the creation path so we only create once a camera snapshot is available.
- **File**: `types/canvas-items.ts`
  - Ensure callers always supply an explicit `position` when using `createPanelItem`, so no silent reversion to the legacy default occurs.

### 3. Remove immediate camera panning for new notes
- **File**: `components/annotation-app.tsx`
  - Keep `centerNoteOnCanvas` disabled for creation/reselection. Users can re-centre manually via the minimap.

### 4. Highlight the fresh panel
- **Files**: `components/annotation-canvas-modern.tsx` (or shared highlight utility)
  - After the new panel is inserted into `canvasItems` within `handleNoteHydration`, emit `workspace:highlight-note` so the glow animation runs once.
  - Emit a `debugLog` (`new_note_highlight_triggered`) for verification.
  - Maintain a short-lived ref (e.g., `newlyCreatedNoteRef`) so the event fires only once per newly spawned note.

### 5. Guardrails / Edge Cases
- When computing the world-space spawn point, add a small offset for rapid consecutive creations (e.g., `index * 50px` diagonally) so notes don’t perfectly overlap if the user spams “+ Note”.
- Clamp the computed world position to safe bounds to avoid spawning panels in unreachable areas:
  ```ts
  const CANVAS_SAFE_BOUNDS = { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 }
  ```
  ```ts
  const clampPosition = (pos: { x: number; y: number }) => ({
    x: Math.max(CANVAS_SAFE_BOUNDS.minX, Math.min(CANVAS_SAFE_BOUNDS.maxX, pos.x)),
    y: Math.max(CANVAS_SAFE_BOUNDS.minY, Math.min(CANVAS_SAFE_BOUNDS.maxY, pos.y)),
  })
  ```
- When collaboration mode (Yjs) is active, ensure the initial position is broadcast via the provider so other clients see the new panel in the same spot.
- Fallback: if no canvas state is available (rare), default to the centred helper described above.

## Testing
- Unit: Update or add tests around the transform utilities if new helpers are introduced.
- Manual/Integration:
  1. Create notes with different zoom levels and pan offsets; verify the panel spawns in view and the camera doesn’t move.
  2. Confirm the highlight appears once and clears.
  3. Reload the app to ensure connection lines remain intact and positions persist.

Saved: 2025-10-23  
Owner: Canvas Platform Team
