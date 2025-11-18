# Branch Hydration Tracing Plan

## Goal
Trace the entire lifecycle of non‑main (branch) panels from creation → datastore write → workspace snapshot capture → rehydrate, so we know exactly where the 2–3 second wait comes from and what hook(s) must emit a “ready” signal before we switch workspaces.

## Steps

1. **Instrumentation Targets**
   - `CanvasPanel` (branch creation path): log when the panel mounts, when it finishes loading content, and when `persistPanelUpdate` writes to the datastore.
   - `usePanelPersistence`: log the payload passed to `StateTransactionImpl` (position, metadata, title, timestamps) and when the datastore transaction commits.
   - `useNoteWorkspaces` `updatePanelSnapshotMap`: log the panel IDs captured and include a sequence number so we can correlate with the branch creation logs.
   - `captureCurrentWorkspaceSnapshot` and `persistWorkspaceNow`: log when we serialize the payload hash and whether the new panel is present.

2. **Timeline Trace**
   - Reproduce the bug twice (create branch, switch immediately). Capture timestamps from the above logs to see how long it takes for the branch to appear in the snapshot.
   - Repeat with “wait 3 s before switching” to get the baseline where the branch survives. Compare the log sequence to spot the missing event(s) in the fast path.

3. **Data Correlation**
   - Collect the `panel_snapshot_updated` vs. `panel_snapshot_skip_no_changes` events to verify whether the branch ever entered the snapshot before switching.
   - Track note-title sync events (`noteTitleMapRef`) to see when the friendly name arrives relative to the panel snapshot.

4. **Output**
   - Document the exact point where the branch becomes eligible for snapshot capture (e.g., after `persistPanelUpdate` resolves).
   - Identify what event we can hook (e.g., branch creation API response, `persistPanelUpdate` promise resolution) to push a shell entry into the snapshot immediately.

This plan stops short of code changes; it only collects the data needed to design a safe fix. Once we have the timing trace, we can spec the actual implementation (shell entry, immediate snapshot capture, or autosave flush) with confidence.
