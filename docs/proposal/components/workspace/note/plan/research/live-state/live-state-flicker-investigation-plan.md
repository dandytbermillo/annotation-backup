# Live-State Flicker Investigation Plan

## Background
Despite migrating to per-workspace runtimes and seeding open-note membership, branch panels still disappear when a second note is added in the same workspace. Logs show repeated `preview_snapshot` replays that target only the newest note (`targetNoteIds:[newNote]`) while `panel_snapshot_apply_prune` removes the prior note’s panels before the first capture finishes, producing visible flicker. We need a structured research effort to pinpoint why replay still prunes even though captures contain both notes.

## Objectives
1. Prove whether preview snapshots ever include both note IDs before `applyPanelSnapshots` runs.
2. Determine why `targetNoteIds` excludes already-open notes on the first preview iterations.
3. Identify store/layer mutations that clear branch panels between captures.
4. Validate whether runtime membership or open-note cache resets during preview/hydration loops.

## Hypotheses to Test
- **H1:** The snapshot delivered to preview only contains the newly created note until the next autosave, so `targetNoteIds` never sees the earlier note in time.
- **H2:** `commitWorkspaceOpenNotes` is overwritten by provider `openNotes` (which lags), trimming membership back to a single note just before preview runs.
- **H3:** LayerManager rehydration clears all non-target nodes regardless of `targetNoteIds`, causing the branch panel to unmount even if not pruned from the datastore.
- **H4:** The runtime manager evicts inactive runtimes under memory pressure, forcing `applyPanelSnapshots` to replay against an empty datastore on each switch, amplifying flicker.

## Research Tasks
1. **Snapshot Payload Audit**
   - Capture consecutive `preview_snapshot` payloads (pre/post second note) from adapter responses.
   - Compare `snapshot.openNotes`, `panels`, and `components` arrays to confirm whether the missing note is present.
2. **Open-Note Cache Trace**
   - Instrument `commitWorkspaceOpenNotes` to log the source (provider vs snapshot vs inferred) and note count.
   - Verify whether `openNotesWorkspaceId` sync overwrites the per-workspace cache between preview runs.
3. **Target Note Derivation Review**
   - Trace how `targetIds` is built inside `previewWorkspaceFromSnapshot` and how it is passed to `applyPanelSnapshots` across successive iterations.
   - Log whenever `targetIds` is smaller than current membership.
4. **Layer Manager Lifecycle**
   - Observe `getWorkspaceLayerManager(workspaceId)` before/after replay to see if nodes for the first note still exist.
   - Check whether `annotation-canvas-modern` reinitializes the canvas on each preview.
5. **Runtime Store Consistency**
   - Dump `getWorkspaceRuntime(workspaceId).dataStore.keys()` after replay to confirm whether panel records are still present.
6. **Telemetry Gap Identification**
   - Ensure new events (`panel_snapshot_apply_start`, `preview_snapshot_applied`, `snapshot_open_note_seed`) are captured near the flicker moment for correlation.
7. **Reproduction Matrix**
   - Document scenarios (default workspace vs secondary workspace, main panel only vs branch) to isolate whether issue is specific to branch panels.
8. **Regression Comparison**
   - Compare against logs from pre-live-state builds to ensure the issue is new or exacerbated by recent changes.

## Deliverables
- Annotated log timeline clearly showing membership, targetId, and prune behavior during flicker.
- Table summarizing which pipelines (capture, preview, replay) drop the missing note.
- Recommendation on whether additional buffering (e.g., delaying preview until both notes are in the payload) or architectural tweaks are required.

## Timeline
1. **Day 1:** Collect fresh logs, snapshot payload dumps, and instrument open-note commit sources.
2. **Day 2:** Analyze LayerManager/runtime states and finalize the reproduction matrix.
3. **Day 3:** Synthesize findings, update plan/architecture doc, and propose fixes.
