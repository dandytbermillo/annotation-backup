# Note Workspace Snapshot Stabilization Plan

## Goal
Remove the “wait for panels to finish initializing” requirement and eliminate the title blinking by making the note canvas follow the same overlay-style snapshot behavior: every workspace switch rehydrates the saved payload immediately, and autosave/title sync renders happen only when data actually changes.

## Current Issues
1. **(Open)** `useCanvasNoteSync` only checks the open note IDs. When you switch workspaces and the note set stays the same, the effect returns the previous `canvasItems` array (`setCanvasItems_SKIPPED_SAME_REF`), so React never re-renders branch panels even though the workspace snapshot contains them. That’s why branch panels vanish if you switch before the snapshot mutation finishes—the render layer never consumes the new snapshot.
2. **(Resolved)** Autosave used to run every second, calling `buildPayload()` and `getPanelSnapshot()` for every open note. This re-applied panel metadata and caused `WidgetStudioConnections`/panel headers to re-render, which made the **main note titles** blink even when nothing changed. Guarding the autosave path (payload hashing + skip logs) now makes autosave a no-op in the steady state, so titles stay stable.

## Implementation Steps

### 1. Snapshot Revision Tracking
- **Add a snapshot revision ref** (e.g., `workspaceSnapshotRevisionRef`) inside `useNoteWorkspaces`. Every time `previewWorkspaceFromSnapshot` or `cacheWorkspaceSnapshot` runs, increment the revision and pass it down as part of the state returned to `AnnotationAppShell`.
- **Propagate revision to the canvas** (`AnnotationWorkspaceCanvas` and `useCanvasNoteSync`). Add a new prop `workspaceSnapshotRevision` that bumps whenever a workspace switch replays a snapshot.
- **Update `useCanvasNoteSync`**:
  - Include `workspaceSnapshotRevision` in the effect dependency array.
  - When the revision changes, build a fresh `canvasItems` array even if the note IDs haven’t changed, forcing React to re-render branch panels from the snapshot.
  - Ensure the effect short-circuits only when both the note ID list and revision are unchanged.

### 2. Autosave/Title Render Debounce _(Completed)_
Autosave now compares serialized payloads and panel snapshots before writing, so idle saves produce `save_skip_no_changes` / `panel_snapshot_skip_no_changes` logs. The main title no longer blinks because autosave doesn’t touch the store when nothing changed.

### 3. Testing & Verification
- **Unit tests**:
  - Add a test for `useCanvasNoteSync` verifying that when `workspaceSnapshotRevision` increments, the hook emits a new `canvasItems` array even if `noteIds` are the same.
  - Ensure memoized panel headers don’t re-render when titles are unchanged.
- **Manual/integration tests**:
  - Create a branch panel, switch between workspaces rapidly before/after title rename, confirm the branch always reappears immediately.
  - Observe the note titles during idle autosave and confirm they no longer blink.

### 4. Rollout
- Ship behind the existing `NEXT_PUBLIC_NOTE_WORKSPACES_V2` flag.
- Once verified in staging (check logs for reduced `setCanvasItems_SKIPPED_SAME_REF` spam and stable `panel_snapshot_updated` counts), enable in production.

## Expected Outcome
- Branch panels rehydrate instantly on every workspace switch, even if the note set hasn’t changed and regardless of title syncing.
- Note titles remain stable (no blink) because autosave no longer re-renders headers when nothing changed.
- Logs show consistent snapshot revisions and fewer redundant `panel_snapshot_updated` events, matching the behavior of the overlay workspace engine.
