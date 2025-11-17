# Note Workspace Overlay-Parity Refactor Plan

## Objective
Refactor note workspace persistence so each workspace behaves like an overlay workspace: every workspace owns its saved layout (notes, panels, camera) and switching workspaces rehydrates its payload immediately without depending on the legacy `/api/canvas/workspace` store.

## Key Problems Today
- CanvasWorkspace provider stores a single global workspace; note workspaces piggyback on it, so closing notes in workspace A wipes them from the global snapshot.
- `/api/canvas/workspace` is skipped when `NEXT_PUBLIC_NOTE_WORKSPACES` is enabled, so the data store never hydrates from the backend when switching workspaces.
- Panel snapshots are serialized ad-hoc and can be stale when switching workspaces (captured after notes are removed).

## High-Level Approach
1. **Dedicated Note Workspace State Module**
   - Create `lib/note-workspaces/state.ts` that manages open notes, panel snapshots, camera per workspace ID.
   - This module replaces the CanvasWorkspace autosave layer when the note workspace flag (new `NEXT_PUBLIC_NOTE_WORKSPACES_V2`) is enabled.

2. **Overlay-Style Hydrate/Save Cycle**
   - Build `NoteWorkspacePersistenceAdapter` mirroring `OverlayLayoutAdapter` with methods: `loadWorkspace`, `saveWorkspace`, `listWorkspaces` (existing APIs already in place).
   - When switching workspaces, run: `snapshot = adapter.loadWorkspace(workspaceId)` → wipe note-layer data store → apply `snapshot.panels` → open `snapshot.openNotes`.
   - When autosave fires, serialize the entire data store + open notes and call `adapter.saveWorkspace`.

3. **Migration Path**
   - Gate the new module behind `NEXT_PUBLIC_NOTE_WORKSPACES_V2` so we can ship incrementally.
   - While the flag is on, disable `persistWorkspaceUpdates` (`/api/canvas/workspace` autosave).
   - Add debug logs for every hydrate/save to verify parity with overlay workspaces.

## Detailed Steps
### 1. State Module
- File: `lib/note-workspaces/state.ts`
- Responsibilities: track OpenNote[] per workspace, panel snapshots per note, current camera, active note ID.
- API: `initializeWorkspace(workspaceId)`, `setWorkspacePanels(workspaceId, panels)`, `getWorkspaceSnapshot(workspaceId)` (returns payload ready for backend).

### 2. Persistence Hook Updates
- In `useNoteWorkspaces`, replace CanvasWorkspace dependencies with calls into the new state module when `NOTE_WORKSPACES_V2` is enabled.
- Capture snapshots before closing notes: `state.capture(workspaceId, sharedWorkspace.dataStore)`.
- Switch workflow:
  1. `captureCurrentWorkspaceSnapshot(currentWorkspaceId)`
  2. `adapter.saveWorkspace(...)` (debounced).
  3. Load target workspace via adapter, `state.install(workspaceId, payload)`.
  4. Wipe note-layer data store, reapply panels, open notes from payload.

### 3. Hydration Loader
- `lib/hooks/annotation/use-workspace-hydration-loader.ts`: remove `skipRemoteHydration` guard and, under `NOTE_WORKSPACES_V2`, bail out of legacy CanvasWorkspace hydration entirely (note workspace hook hydrates itself directly from adapter).
- Add instrumentation logs for `note_workspace_hydrate_start/success` with counts.

### 4. Flag Wiring & Cleanup
- Define `NEXT_PUBLIC_NOTE_WORKSPACES_V2` in `/lib/flags/note.ts`.
- When flag is enabled:
  - `CanvasWorkspaceProvider` should not call `persistWorkspaceUpdates` or `/api/canvas/workspace`.
  - Only the note workspace hook interacts with the backend.
- After stabilization, remove the legacy fallback.

## Verification Plan
- Unit tests for state module (snapshot captures, merges, hydration).
- Integration tests (Playwright) covering: create branch in default workspace → switch to workspace 1 → switch back → branch restored.
- Debug log checks: `panel_snapshot_updated` (with reasons `hydrate`, `autosave`, `switch_capture`) and `note_workspace_hydrate_success` per switch.

## Risks
- Large change touching CanvasWorkspace and note workspace hooks; regression potential is high.
- Need to ensure overlay features (autosave, toolbar interactions) keep working when the new flag is off.

## Rollout
1. Implement behind `NEXT_PUBLIC_NOTE_WORKSPACES_V2=false`.
2. QA with flag on locally/staging.
3. Flip flag in production once stable; remove legacy path later.
