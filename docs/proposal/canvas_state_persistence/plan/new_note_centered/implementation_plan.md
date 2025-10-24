# Canvas – Predictable Centered Spawn for New Notes

## Objective
When a user creates a note via the floating toolbar’s “+ Note” button, the new panel should appear in the middle of the current viewport without panning the existing canvas. The new panel should be visually highlighted so it is immediately discoverable, while existing panels/connection lines remain undisturbed.

## Current Behaviour (2025-10-23)
- `floating-toolbar.tsx` calls `createNote()` and then `handleNoteSelect`.
- `handleNoteSelect` triggers `centerNoteOnCanvas`, causing multiple `centerOnPanel` attempts before the new panel exists. The canvas pans away from the user’s current context.
- Snapshot/dedupe logic eventually hydrates the note, causing connection lines to momentarily re-route during the transition.

## Proposed Behaviour
1. Do **not** pan the camera.
2. Spawn the new note at the world coordinate that corresponds to the current viewport center.
3. Apply a brief “new note” highlight (existing glow utility or light animation) so the user’s attention stays on the new panel.

## Implementation Plan

### 1. Capture Viewport Center at Creation Time
- **File**: `components/floating-toolbar.tsx`
- When the user clicks “+ Note”:
  - Read the current canvas transform (`translateX`, `translateY`, `zoom`) from the canvas context (`useCanvas()`).
  - Convert the viewport center (screen coordinates) to world coordinates using `screenToWorld`.
  - Pass this world position to the note creation flow (see Step 2).

### 2. Allow `createNote` / `openWorkspaceNote` to Accept Initial Position
- **File**: `lib/utils/note-creator.ts`
  - Extend `CreateNoteOptions` with an optional `initialPosition` (world coordinates).
  - Keep existing API compatibility (position remains optional).
- **File**: `components/annotation-app.tsx`
  - When opening the new note (`openWorkspaceNote`), pass the supplied `initialPosition` as `mainPosition`. This ensures the workspace seeds the panel at the provided coordinates.
- **File**: `components/annotation-canvas-modern.tsx`
  - During hydration (`handleNoteHydration` / workspace seeding), respect the `mainPosition` when provided.

### 3. Remove Immediate Camera Panning for New Notes
- **File**: `components/annotation-app.tsx`
  - Skip `centerNoteOnCanvas` altogether for note selection (new note creation and tab reselection). Users can re-center via the minimap or manual “center” action if needed.
  - Later, if usability feedback shows tab switching needs auto-centering, we can reintroduce it with a dedicated flag at that time.

### 4. Highlight the Fresh Panel
- **Files**: `components/annotation-canvas-modern.tsx` (or shared highlight utility)
  - After the new panel is inserted into `canvasItems` within `handleNoteHydration`, emit `workspace:highlight-note` for the specific note so the existing highlight/glow logic runs.
  - Emit a `debugLog` (`new_note_highlight_triggered`) for verification.
  - Maintain a short-lived ref (e.g., `newlyCreatedNoteRef`) so the event only fires once per newly spawned note.

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
- Fallback: if no canvas state is available (rare), default to the existing `DEFAULT_MAIN_POSITION`.

## Testing
- Unit: Update or add tests around the transform utilities if new helpers are introduced.
- Manual/Integration:
  1. Create notes with different zoom levels and pan offsets; verify the panel spawns in view and the camera doesn’t move.
  2. Confirm the highlight appears once and clears.
  3. Reload the app to ensure connection lines remain intact and positions persist.

Saved: 2025-10-23  
Owner: Canvas Platform Team
