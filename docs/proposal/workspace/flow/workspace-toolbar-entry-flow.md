# Workspace Toolbar Entry Flow

Detailed reference for what happens in the current implementation when a user clicks a note tab in the workspace toolbar.

---

## 1. Click Handling
- Component: `WorkspaceToolbar` (`components/canvas/workspace-toolbar.tsx`)
- Action: `onActivateNote(noteId)` fires immediately when the note tab button is pressed.
- Result: `AnnotationApp.handleNoteSelect(noteId, { source: 'toolbar-open' })` runs on the main canvas container.

## 2. Logging & Recent-Note Tracking
- `handleNoteSelect` logs the action via `debugLog({ component: 'AnnotationApp', action: 'note_select', … })`.
- `trackNoteAccess(noteId)` is dispatched immediately, regardless of whether the note is already active.
  - POST `/api/items/recent` → updates `items.last_accessed_at`.
  - On success, `recentNotesRefreshTrigger` increments so toolbars/floating menus refresh their recent list.
- Failures are logged but do not block the rest of the flow.

## 3. Same-Tab Re‑Select Fast Path
- Detection: `noteId === activeNoteId`.
- Effect:
  - No `openWorkspaceNote` call (note stays where it is).
  - Calls `logWorkspaceNotePositions('tab_click_reselect')` for diagnostics.
  - Emits `workspace:highlight-note` (unless hydration is still running or the note came from a “new note” seed).
  - **Still runs** `trackNoteAccess`, so the database write happens even on reselect.
- Camera: does **not** move. Only a visual pulse plays on the existing panel.

## 4. Preparing to Open a Different Note
- Flags `skipSnapshotForNote(noteId)` so local snapshot restore will be skipped on the next render.
- Checks whether the note is already represented in `openNotes`.

## 5. Position Resolution
- Inputs considered:
  - `options.initialPosition` (explicit overrides, e.g., from create flows).
  - Stored workspace positions (pending cache, local cache, existing `openNotes` entry).
- New notes (toolbar “+” creation):
  - Compute a fresh viewport-centered world position using the current camera (`window.innerWidth/Height`, translate, zoom).
  - No caching; the position is used once and passed down.
- Existing notes:
  - Default: use persisted position from `resolveMainPanelPosition`.
  - Centering override: if `NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES !== 'disabled'` (default) **and** the note was opened from the toolbar, `computeVisuallyCenteredWorldPosition` generates a centered coordinate. Rapid consecutive opens accumulate a diagonal offset to keep panels from stacking.
  - The centered coordinate is stored in `freshNoteSeeds` so the canvas paints in the correct spot on first render.

## 6. Marking the Note Open
- `openWorkspaceNote(noteId, { persist: true, mainPosition, persistPosition: true })`
  - Adds/updates the note in `openNotes` state.
  - Seeds workspace caches (`canvas_workspace_notes.main_position_*` and version map).
  - Persists to `/api/canvas/workspace` (or `/update` when the replay feature flag is enabled) with optimistic retries. This touches the `canvas_workspace_notes` table.
- If the note was already open, the call becomes a no-op aside from refreshing cached position metadata.

## 7. Canvas Hydration & Panel Creation
- `setActiveNoteId(noteId)` updates application state and persists to `localStorage`.
- `ModernAnnotationCanvas` consumes `freshNoteSeeds` / `openNotes`:
  - If the note lacks an active “main” panel record, `persistPanelCreate` issues a PATCH to `/api/canvas/layout/:noteId`, creating/updating the row in `panels` and writing the world position.
  - `updateMainPosition` immediately updates local caches and re-persist the workspace record when necessary.
- Snapshot restore is skipped when `skipSnapshotForNote` matches, preventing stale offscreen positions from reappearing.

## 8. Highlight & Active Styling
- After `setActiveNoteId`, `handleNoteSelect` emits `workspace:highlight-note` unless the note came from the “new note” creation path or the workspace is still hydrating.
- `CanvasPanel` listens for this event and toggles a short-lived pulse/glow effect on the matching panel (`components/canvas/canvas-panel.tsx`).
- The toolbar rerenders, applying the active styles (indigo border, accent background) to the clicked entry.

## 9. Camera Movement (Optional)
- Automatic highlight events do **not** move the camera.
- Camera recentering only happens when the user clicks the crosshair button on the toolbar entry. That triggers `handleCenterNote` → `centerNoteOnCanvas`, which pans/zooms the viewport and emits another highlight event.

## 10. Rapid-Sequence Handling & Guards
- Reopen centering maintains `reopenSequenceRef` to offset successive opens.
- New-note creation currently has no additional offset (the stored `newNoteSequenceRef` is unused).
- During workspace hydration (`isHydrating === true`), highlight emission is suppressed to avoid flashes while state replays.

---

## Database Touchpoints Per Click
1. `items.last_accessed_at` via `/api/items/recent` (runs on every activation, including reselects).
2. `canvas_workspace_notes` via `openWorkspaceNote` (position + open flag persistence; can be skipped if nothing changed).
3. `panels` via `persistPanelCreate`/`persistPanelUpdate` when the rendered panel needs a position write (first open, move, resize, etc.).

---

## UI Summary
- Toolbar entry: Active styling toggles immediately with the new `activeNoteId`.
- Canvas panel: Renders (or reuses) at the resolved world coordinate, leveraging workspace seeds to avoid jumps.
- Visual pulse: Fired via `workspace:highlight-note`; suppressed during hydration.
- Camera: Only moves on explicit center-button actions, not on every activation.
