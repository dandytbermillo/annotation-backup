## Note Workspace Live-State – Phase 3 Persistence Plan

Goal: make background workspaces persist independently so no dirty runtime depends on being “current” before its state is saved. This plan covers the four remaining tasks:

1. `persistWorkspaceById`
2. Per-workspace dirty-state/timers
3. Eviction-triggered persistence
4. Background autosave

Each task includes scope, implementation steps, logging/telemetry, and validation.

---

### 1. `persistWorkspaceById`

**Objective:** Allow any workspace runtime (active or background) to serialize itself without relying on `currentWorkspaceSummary`.

**Implementation**

1. Add a new helper in `lib/hooks/annotation/use-note-workspaces.ts`:
   ```ts
   const persistWorkspaceById = useCallback(async (
     targetWorkspaceId: string,
     reason: string,
     options?: { skipReadinessCheck?: boolean }
   ) => { … })
   ```
2. Move the internals of `persistWorkspaceNow` into this helper:
   - Lookup runtime-derived open notes via `getWorkspaceOpenNotes(targetWorkspaceId)`.
   - Wait for readiness (`waitForPanelSnapshotReadiness`) unless `options.skipReadinessCheck`.
   - Capture the workspace snapshot (`getWorkspaceSnapshot(targetWorkspaceId)`).
   - Build payload via `buildPayloadFromSnapshot`.
   - Compare hash against `lastSavedPayloadHashRef.current.get(targetWorkspaceId)`.
   - Save through `adapter.saveWorkspace` with `workspaceRevisionRef`.
3. Keep `persistWorkspaceNow` as a thin wrapper that calls `persistWorkspaceById(currentWorkspaceSummary.id, lastSaveReasonRef.current)`.

**Telemetry**

Emit `save_attempt`/`save_success`/`save_skip_*` with metadata `{ workspaceId, reason, isBackground }`.

**Tests/Validation**

1. Unit: ensure `persistWorkspaceById` returns false when save in flight or readiness fails.
2. Manual: switch to workspace B, make changes, stay on A, call the helper (via dev console) and verify B saves.

---

### 2. Maps instead of singletons

**Objective:** Track dirty state per workspace.

**Implementation**

1. Convert refs to `Map<string, …>`:
   - `saveInFlightRef` → `Map<string, boolean>`
   - `skipSavesUntilRef` → `Map<string, number>`
   - `saveTimeoutRef` → `Map<string, NodeJS.Timeout>`
   - Add `workspaceDirtyRef` → `Map<string, number>` storing the timestamp when a workspace became dirty.
2. Update scheduling helpers:
   - `scheduleSave`: mark `workspaceDirtyRef.set(workspaceId, Date.now())`; manage per-workspace timeout map.
   - `flushPendingSave`: clear timeout from map.
3. Update `persistWorkspaceById` to consult these maps (e.g., skip if `saveInFlightRef.get(id)` is true).

**Telemetry**

Log `save_schedule`, `save_skipped_in_flight`, `save_skipped_cooldown` with workspaceId and reason.

**Validation**

1. Unit: verify scheduling maps store/retrieve entries per workspace.
2. Manual: open two workspaces, make edits in each, ensure each gets its own timeout and dirty timestamp.

---

### 3. Eviction → persistence

**Objective:** When the runtime cap is reached and LRU eviction occurs, persist the workspace before removing it.

**Implementation**

1. In `lib/workspace/runtime-manager.ts`, add a registry for pre-eviction callbacks:
   ```ts
   type PreEvictionCallback = (workspaceId: string, reason: string) => Promise<void>;
   export const registerPreEvictionCallback = (cb: PreEvictionCallback) => { … };
   export const unregisterPreEvictionCallback = (cb: PreEvictionCallback) => { … };
   ```
2. Call the callback inside `evictLRURuntime` and `removeWorkspaceRuntime` before clearing state.
3. Inside `useNoteWorkspaces`, register a callback:
   - Capture snapshot via `captureCurrentWorkspaceSnapshot(workspaceId, { readinessReason: "pre_eviction_capture", readinessMaxWaitMs: 500 })`.
   - Call `persistWorkspaceById(workspaceId, "pre_eviction_capacity", { skipReadinessCheck: true })`.
   - Emit `pre_eviction_persist_start/complete` logs.

**Telemetry**

Log `workspace_runtime_evicted`, `pre_eviction_persist_start/complete`, and include metadata `{ workspaceId, reason, runtimeCount, success }`.

**Validation**

1. Unit/integration: simulate five workspaces (cap=4) and check that eviction triggers capture+persist.
2. Manual: enable flag, open > cap workspaces, inspect debug log to ensure eviction events include persistence step.

---

### 4. Background autosave

**Objective:** Persist dirty runtimes even when they’re not visible, so users don’t need to switch back before their work is saved.

**Implementation**

1. Add an effect in `useNoteWorkspaces` when `liveStateEnabled`:
   ```ts
   useEffect(() => {
     const interval = setInterval(async () => {
       const hotRuntimeIds = listHotRuntimes();
       for (const workspaceId of hotRuntimeIds) {
         const dirtyAt = workspaceDirtyRef.current.get(workspaceId);
         if (!dirtyAt || Date.now() - dirtyAt < DIRTY_THRESHOLD) continue;
         if (workspaceId === currentWorkspaceId) continue;
         await captureCurrentWorkspaceSnapshot(workspaceId, { readinessReason: "background_autosave_capture" });
         await persistWorkspaceById(workspaceId, "background_autosave", { skipReadinessCheck: true });
       }
     }, BACKGROUND_SAVE_INTERVAL);
     return () => clearInterval(interval);
   }, [liveStateEnabled, currentWorkspaceId, persistWorkspaceById]);
   ```
2. Set constants (e.g., `DIRTY_THRESHOLD_MS = 10000`, `BACKGROUND_SAVE_INTERVAL_MS = 30000`).
3. Emit `background_autosave_start`, `background_autosave_workspace`, `background_autosave_complete`.

**Validation**

1. Manual: make edits in workspace B, switch to A, wait for autosave interval, verify B is persisted (check debug log / database).
2. Negative: ensure background save doesn’t spam active workspace (skip when `workspaceId === currentWorkspaceId`).

---

### Rollout & Verification Checklist

1. Implement tasks in order (persist helper → per-workspace maps → eviction persistence → background autosave).
2. Add unit tests for scheduling maps and eviction callback wiring.
3. Add integration test: create note + calculator in workspace A, switch to B, wait for autosave, reload → changes persist.
4. Telemetry dashboard:
   - Count of `save_success` per workspace (active vs background).
   - Average background autosave duration.
   - Eviction persistence success rate.
5. Enable behind `NOTE_WORKSPACES_LIVE_STATE` until telemetry confirms stability (<1% save failures, no data loss reports).

Once all four tasks pass validation and telemetry thresholds, Phase 3 persistence is complete and we can move on to Phase 4 testing/rollout tasks.
