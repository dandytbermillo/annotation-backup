# Note Workspace Autosave Guard Plan

## Goal
Prevent the autosave loop from rewriting identical panel metadata every few seconds, which currently triggers redundant `BRANCH_UPDATED` dispatches, floods logs with `noteIds_sync_NO_CHANGE`, and used to make note titles blink. We want the autosave pipeline to become a no-op when nothing changed, matching overlay workspace behavior.

## Current Problem
`useCanvasNoteSync` + `usePanelPersistence` reserialize every open panel on each autosave tick, push those updates into the shared data store, and dispatch `BRANCH_UPDATED` even if the serialized metadata matches the previous snapshot. React sees an update, re-renders `CanvasPanel`, and the logs are filled with “NO_CHANGE” diagnostics. Guarding the title display stopped the visible flicker, but the underlying churn remains.

## Implementation Steps

### 1. Serialize & Compare Panel Snapshots
1. Extract the panel metadata we care about (position, size, zIndex, title, state) from `canvasItems` inside `useCanvasNoteSync`.
2. Maintain a `lastSerializedSnapshotRef` keyed by storeKey. Before dispatching `setCanvasItems`, compare the new serialized metadata to the cached version:
   - If the note IDs and metadata are identical, bail out early and skip the `setCanvasItems` call (and subsequent `BRANCH_UPDATED` dispatch).
   - If anything changed, update the cache and continue as we do today.

### 2. Guard `usePanelPersistence`
1. Inside `usePanelPersistence.persistPanelUpdate`, fetch the existing `dataStore` value for the panel and diff the new world-space position/size/zIndex before calling `transaction.add`.
2. If the position/size values are identical, log a `PanelPersistence.noop_update_skipped` event and return early without invoking the transaction, so we don't rewrite the store or call the API.

### 3. Memoize Main Header Rendering
1. Keep the existing `titleOverride` path as a safety net, but also wrap the main note header text in `React.memo` (or use `useMemo`) so identical title props skip DOM updates.
2. This ensures even if autosave re-runs (e.g., immediately after a genuine change), the header only repaints when the title string actually changes.

### 4. Logs & Telemetry
1. Add debug logs in the guard path (e.g., `panel_snapshot_equal_skipped`, `persistPanelUpdate_noop`). This makes it easy to verify the guard is working (logs become quiet during idle periods).
2. Ensure we still log a normal `panel_snapshot_updated` when something genuinely changes so we don't lose visibility.

### 5. Testing & Verification
1. Unit-test the serialized metadata diff: feed two identical `canvasItems` arrays into the new helper and verify it reports "unchanged." Test cases for position-only, size-only, zIndex-only, and title-only changes.
2. Manual regression:
   - Open a note, stop interacting, confirm the logs no longer spam `noteIds_sync_NO_CHANGE` and `setCanvasItems_SKIPPED_SAME_REF`.
   - Change a note title or drag a panel; autosave should run once, update the metadata, and then go quiet again.

## Expected Outcome
- Autosave becomes a true no-op when nothing changed, so the canvas stops dispatching `BRANCH_UPDATED` every few seconds.
- Logs quiet down—`noteIds_sync_NO_CHANGE` should only appear after genuine changes, not continuously.
- The note title remains stable without relying solely on the override, because the header no longer re-renders unless data changes.
