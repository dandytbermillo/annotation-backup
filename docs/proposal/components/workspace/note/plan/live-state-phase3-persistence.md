## Note Workspace Live-State – Phase 3 Persistence Plan

Goal: make background workspaces persist independently so no dirty runtime depends on being "current" before its state is saved. This plan covers the four remaining tasks:

1. `persistWorkspaceById` - ✅ **IMPLEMENTED**
2. Per-workspace dirty-state/timers - ✅ **IMPLEMENTED**
3. Eviction-triggered persistence - ✅ **IMPLEMENTED**
4. Background autosave - ⏸️ **DEFERRED**

Each task includes scope, implementation steps, logging/telemetry, and validation.

---

### Implementation Status Summary

| Task | Status | Notes |
|------|--------|-------|
| 1. persistWorkspaceById | ✅ Complete | `use-note-workspaces.ts:2906` |
| 2. Per-workspace Maps | ✅ Complete | `saveInFlightRef`, `skipSavesUntilRef`, `workspaceDirtyRef`, `saveTimeoutRef` are all Maps |
| 3. Eviction persistence | ✅ Complete | Pre-eviction callbacks registered and invoked via `firePreEvictionCallbacksSync` |
| 4. Background autosave | ⏸️ Deferred | See rationale below |

---

### 1. `persistWorkspaceById` ✅ IMPLEMENTED

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

### 2. Maps instead of singletons ✅ IMPLEMENTED

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

### 3. Eviction → persistence ✅ IMPLEMENTED

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

### 4. Background autosave ⏸️ DEFERRED

**Status:** Implementation deferred. Current save triggers are sufficient for most use cases.

**Rationale for Deferral:**

The existing save mechanisms already cover most scenarios:
1. **Active workspace changes** - `scheduleSave` triggers on edits
2. **Workspace switch** - Save triggered when switching away
3. **Pre-eviction (Task 3)** - Persist before capacity eviction
4. **Visibility change** - `save_flush_all` when tab becomes hidden
5. **Component changes** - `save_flush_all` on `components_changed`

Background autosave would add an additional safety net for edge cases (e.g., user stays in Workspace B for extended time while A has dirty changes, then app crashes). However, this is a low-priority enhancement given the existing triggers.

**When to Reconsider:**
- If users report data loss in background workspaces
- If telemetry shows saves not triggering as expected
- If the app needs to support longer idle periods without visibility changes

**Original Implementation Plan (for future reference):**

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

**Validation (when implemented)**

1. Manual: make edits in workspace B, switch to A, wait for autosave interval, verify B is persisted (check debug log / database).
2. Negative: ensure background save doesn't spam active workspace (skip when `workspaceId === currentWorkspaceId`).

---

### Rollout & Verification Checklist

1. ✅ Implement tasks in order (persist helper → per-workspace maps → eviction persistence).
2. ⏸️ Background autosave deferred.
3. Add unit tests for scheduling maps and eviction callback wiring.
4. Add integration test: create note + calculator in workspace A, switch to B, trigger eviction, reload → changes persist.
5. Telemetry dashboard:
   - Count of `save_success` per workspace (active vs background).
   - Eviction persistence success rate.
6. Enable behind `NOTE_WORKSPACES_LIVE_STATE` until telemetry confirms stability (<1% save failures, no data loss reports).

Phase 3 persistence (Tasks 1-3) is complete. Task 4 can be added later if needed based on user feedback or telemetry data.
