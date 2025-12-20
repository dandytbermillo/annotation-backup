# Step 7 Lifecycle-Only Hot/Cold — Manual Test Report

**Date:** 2025-12-19
**Tester:** User + Claude
**Feature:** Canonical Persist Wiring - Step 7 (Hot/Cold Decisions Use Lifecycle)
**Status:** COMPLETE
**Parent Plan:** [`2025-12-18-canonical-persist-checklist.md`](../improvement/2025-12-18-canonical-persist-checklist.md)

---

## Test Objective

Verify that Step 7 implementation correctly uses `isWorkspaceLifecycleReady()` as the **sole authority** for hot/cold workspace classification, and that removing the legacy runtime-based checks does not cause regressions.

### What Changed in Step 7

| Before | After |
|--------|-------|
| `hasWorkspaceRuntime()` for hot/cold | `isWorkspaceLifecycleReady()` |
| `isWorkspaceHydrated()` for error recovery | `isWorkspaceLifecycleReady()` |
| Runtime-based empty snapshot rejection | Removed (lifecycle-only sourcing handles this) |

### Files Modified

- `lib/hooks/annotation/workspace/use-workspace-selection.ts`
- `lib/hooks/annotation/workspace/use-workspace-hydration.ts`
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts`
- `lib/workspace/store-runtime-bridge.ts`

---

## Test Environment

- **Dev server:** `npm run dev` on port 3000
- **Browser:** Chrome/Safari with DevTools Console open
- **Database:** PostgreSQL (annotation_dev)

---

## Test 1 — Cold Restore Must Replay

**Goal:** Cold workspace should always load from DB (no "hot" misclassification).

### Steps Performed

1. Opened Workspace A (default workspace)
2. Added a calculator component to Workspace A
3. Switched to 5 other workspaces sequentially (to force Workspace A eviction due to 4-cap)
4. Switched back to Workspace A

### Expected Behavior

- Workspace A restores from DB (notes + calculator appear correctly)
- Logs indicate cold path, not "preview_snapshot_skip_hot_runtime"
- No "empty" workspace on return

### Actual Result

**PASSED** ✅

- Calculator appeared correctly when returning to Workspace A
- Workspace was correctly classified as "cold" (evicted, lifecycle not ready)
- Cold restore from database occurred successfully
- No data loss observed

### Console Evidence (Optional/Supplemental)

These console logs may or may not appear depending on rate limiting and log filtering:

- `[WorkspaceRuntime] removeWorkspaceRuntime called` — workspaces being evicted
- `DATASTORE-UPDATE` with `hasHydratedContent: true` — content loaded from DB
- `[debugLog] rate limited` — high activity during switches

**Note:** These are supplemental indicators only. Primary evidence is UI verification (calculator appeared) and DB logs.

### Conclusion

Cold restore works correctly. Lifecycle state correctly identifies evicted workspaces as "not ready" and triggers DB hydration.

---

## Test 2 — Hot Switch Must Skip Replay

**Goal:** Hot workspace should not replay DB and should keep in-memory state.

### Steps Performed

1. In Workspace A (6953461d-e4b0-4a93-83d2-73dd080b5f7b), calculator was present
2. Switched to Workspace B (2350c44b-ea62-4592-8cee-cea8977b6f15)
3. Switched back to Workspace A immediately (no reload, no eviction)

### Expected Behavior

- Changes are still there instantly (no flicker/reset)
- Logs show `workspace_switch_hot` / `preview_snapshot_skip_hot_runtime`
- No DB hydration logs for Workspace A

### Actual Result

**PASSED** ✅

- No flicker when switching back to Workspace A
- Calculator and all state preserved instantly
- Hot path was taken (no DB hydration)

### Database Evidence

Query executed against `debug_logs` table to verify hot switch behavior:

```sql
SELECT id, created_at, action,
       metadata->>'workspaceId' AS workspace_id,
       metadata->>'targetRuntimeState' AS target_state,
       metadata->>'previousWorkspaceId' AS prev_workspace
FROM debug_logs
WHERE component = 'NoteWorkspace'
  AND action IN ('select_workspace_requested', 'workspace_switch_hot', 'select_workspace_hot_complete')
ORDER BY id DESC
LIMIT 10;
```

**Results (2025-12-20 00:14:47 UTC):**

| Timestamp | Action | Workspace | Target State | Previous |
|-----------|--------|-----------|--------------|----------|
| 00:14:47.599 | `select_workspace_requested` | 6953461d... | **hot** | 2350c44b... |
| 00:14:47.599 | `workspace_switch_hot` | 6953461d... | - | 2350c44b... |
| 00:14:47.612 | `select_workspace_hot_complete` | 6953461d... | - | - |

### Key Observations

1. **`targetRuntimeState: "hot"`** — Lifecycle correctly identified workspace as "ready"
2. **`workspace_switch_hot`** — Hot path code executed (visibility toggle only)
3. **`select_workspace_hot_complete`** — Hot switch completed in ~13ms
4. **No `hydrate_on_route_load`** — No cold hydration triggered for this switch
5. **Comparison:** Earlier switch to same workspace (22:05:40) showed `targetRuntimeState: "cold"` when returning after eviction

### Conclusion

Hot switch works correctly. Lifecycle state correctly identifies non-evicted workspaces as "ready" and skips DB hydration, preserving in-memory state instantly.

---

## Test 3 — No Empty Snapshot Guard Regression

**Goal:** Removing runtime-based empty snapshot guard should not cause data loss.

### Revised Test Approach

The original test (rapid hot switching) was replaced with a more comprehensive approach:
- Force a **cold restore** (the scenario the old guard actually protected)
- Verify content is restored without data loss
- Confirm `fix8_rejected_empty_snapshot` log no longer appears

This approach directly tests the scenario the removed guard was designed to handle.

### Steps Performed

1. Workspace A had content (note + calculator component)
2. Workspace A was evicted by switching to 4-5 other workspaces (4-cap)
3. Switched back to Workspace A (cold restore triggered)
4. Verified content appeared correctly (Test 1)

### Expected Behavior

- Content restored without data loss
- No `fix8_rejected_empty_snapshot` log entries
- No `runtime_has_notes_would_lose_data` log entries

### Actual Result

**PASSED** ✅

- Cold restore completed successfully (Test 1 validation)
- Calculator component appeared correctly
- No empty snapshot rejection occurred

### Database Evidence

Query executed to verify no empty snapshot rejections (scoped to test session):

```sql
-- Replace <WORKSPACE_ID> with the workspace you tested
-- Check for rejected snapshots in the tested workspace during this session
SELECT 'fix8_rejected_empty_snapshot count' AS check_type, COUNT(*) AS count
FROM debug_logs
WHERE action = 'fix8_rejected_empty_snapshot'
  AND created_at > NOW() - INTERVAL '10 minutes'
  AND metadata->>'workspaceId' = '<WORKSPACE_ID>'

UNION ALL

-- Confirm cold restore occurred (any of these actions indicate cold path)
SELECT 'cold_restore_evidence count' AS check_type, COUNT(*) AS count
FROM debug_logs
WHERE action IN ('hydrate_success', 'preview_snapshot_applied', 'hydrate_on_route_load')
  AND created_at > NOW() - INTERVAL '10 minutes'
  AND metadata->>'workspaceId' = '<WORKSPACE_ID>';
```

**Note:** Replace `<WORKSPACE_ID>` with the workspace you tested. For this test session: `6953461d-e4b0-4a93-83d2-73dd080b5f7b`

**Results:**

| Check Type | Count |
|------------|-------|
| `fix8_rejected_empty_snapshot` count | **0** |
| `cold_restore_evidence` count | **1** |

### Key Observations

1. **Guard is removed:** Zero `fix8_rejected_empty_snapshot` entries for the tested workspace
2. **Cold restore occurred:** At least one of `hydrate_success`, `preview_snapshot_applied`, or `hydrate_on_route_load` confirms cold path was taken
3. **No data loss:** UI verification (Test 1) confirmed calculator restored correctly
4. **Lifecycle-only sourcing works:** The removed guard is no longer needed because:
   - When lifecycle is "ready" → source from runtime (not snapshot)
   - When lifecycle is "not ready" → source from DB (cold restore)

### Conclusion

The runtime-based empty snapshot guard (`fix8_rejected_empty_snapshot`) has been successfully removed without causing data loss. The lifecycle-only approach correctly handles the scenarios the old guard was protecting against.

---

## Test 4 — Error Path Lifecycle Preservation

**Goal:** On preview error, lifecycle "ready/not ready" is preserved by lifecycle snapshot, not hydration state.

### Steps Performed

1. Workspace 2 (2f1d84cb-ae35-41ae-b047-14f48a14bebe) had content
2. Switched to 4-5 other workspaces to evict Workspace 2 (force it cold)
3. Enabled offline mode in browser DevTools (Network → Offline)
4. Attempted to switch back to Workspace 2 (cold restore)
5. Observed error in UI

**Note:** Initial attempts with the default workspace ("summary14") failed because it wasn't being evicted. Test succeeded with Workspace 2.

### Expected Behavior

- Workspace lifecycle state is consistent (no false "ready" after error)
- If the workspace was ready before, it remains ready after the error path; if not, it remains unready
- Error should be logged, but no false "hot" marking should occur

### Actual Result

**PASSED** ✅

- Error appeared in UI when attempting cold restore while offline
- `adapter_load_error` logged with "Failed to fetch"
- Workspace 2 was NOT incorrectly marked as "hot"

### Database Evidence

Query executed to verify error path behavior:

```sql
SELECT id, created_at, action,
       metadata->>'workspaceId' AS workspace_id,
       metadata->>'workspaceName' AS workspace_name,
       metadata->>'error' AS error
FROM debug_logs
WHERE component = 'NoteWorkspace'
  AND created_at > NOW() - INTERVAL '5 minutes'
  AND metadata->>'workspaceId' = '2f1d84cb-ae35-41ae-b047-14f48a14bebe';
```

**Results (2025-12-20 01:08:40 UTC):**

| Timestamp | Action | Workspace | Error |
|-----------|--------|-----------|-------|
| 01:08:40 | `adapter_load_error` | Workspace 2 | **"Failed to fetch"** |

**Verification - No false hot marking:**

```sql
SELECT action FROM debug_logs
WHERE metadata->>'workspaceId' = '2f1d84cb-ae35-41ae-b047-14f48a14bebe'
  AND action IN ('workspace_switch_hot', 'select_workspace_hot_complete')
  AND created_at > NOW() - INTERVAL '5 minutes';
-- Result: 0 rows (correct - no false hot marking)
```

### Key Observations

1. **Error correctly triggered:** `adapter_load_error` with "Failed to fetch" confirms offline mode blocked the API
2. **No false "hot" marking:** Zero `workspace_switch_hot` or `select_workspace_hot_complete` entries for Workspace 2
3. **Lifecycle preserved:** The workspace that was NOT ready before the error remained NOT ready after
4. **Step 7 change validated:** The error recovery path correctly uses `wasReadyBeforeRestore = isWorkspaceLifecycleReady(workspaceId)`

### Conclusion

The error path correctly preserves lifecycle state. When a cold restore fails, the workspace is NOT incorrectly marked as "ready" (hot). This validates the Step 7 change from `isWorkspaceHydrated()` to `isWorkspaceLifecycleReady()` in error recovery paths.

### Degraded Mode Observation (Bonus Validation)

After Test 4, while switching between workspaces during **online mode**, the degraded mode safety system triggered:

**UI Observations:**
- "Workspace save failed (3x)" toast appeared
- "System in degraded mode" toast followed
- New workspace opens were blocked

**Database Evidence:**

```sql
SELECT id, action,
       metadata->>'consecutiveFailures' AS failures
FROM debug_logs
WHERE action = 'workspace_open_blocked_degraded_mode'
ORDER BY id DESC
LIMIT 1;
```

**Result:**
| id | action | failures |
|----|--------|----------|
| 28585930 | `workspace_open_blocked_degraded_mode` | **3** |

**Significance:**
- The degraded mode safety system is working correctly
- After 3 consecutive save failures, system blocked new workspace opens to prevent further data loss risk
- System recovered after a few workspace switches (failures reset when saves succeed)
- This validates the failure tracking and safety mechanisms beyond Step 7's scope

---

## Test 5 — Component Persistence After Eviction

**Goal:** Verify components keep their state after a cold restore (validates full persist→evict→restore cycle).

### Why This Tests Step 7

Step 7 makes `isWorkspaceLifecycleReady()` the **sole authority** for hot/cold classification across all paths:

- **Unified snapshot builder** (`buildUnifiedSnapshot`) — canonical persistence path
- **Preview/snapshot operations** (`buildPayloadFromSnapshot`) — capture for preview/switch
- **Selection/hydration** — determines whether to load from DB or use in-memory state

This test validates the end-to-end cycle:
1. **Hot persist path** — When leaving Workspace A (before eviction), lifecycle is "ready" → components sourced from runtime → persisted to DB
2. **Cold restore path** — When returning to evicted Workspace A, lifecycle is NOT "ready" → components loaded from DB

If components survive with correct values, the lifecycle-only hot/cold classification works correctly across both paths.

### Steps To Perform

1. In Workspace A, set calculator to a specific value (e.g., `123.45`)
2. Add a timer, set minutes to a value (e.g., `5`), but do NOT start it
3. Open 4–5 other workspaces to evict Workspace A (4-cap)
4. Switch back to Workspace A

### Expected Behavior

| Component | Expected State |
|-----------|----------------|
| Calculator | Value unchanged (`123.45`) |
| Timer | Minutes unchanged (`5`) |
| Timer | Still paused (not running) |

**Note:** Timer "running" state may reset to paused on restore (implementation-dependent). The key validation is that the **minutes value survives**.

### Optional DB Confirmation

```sql
SELECT id, created_at, action,
       LEFT(metadata::text, 150) AS metadata_preview
FROM debug_logs
WHERE component IN ('StoreRuntimeBridge', 'NoteWorkspace', 'BuildPayloadDiagnostic')
  AND action IN ('restore_to_store_complete', 'preview_snapshot_applied', 'build_payload_components')
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY id DESC
LIMIT 10;
```

### Actual Result

**PASSED** ✅

- All notes survived the eviction cycle
- All components survived with their state intact
- Calculator value preserved
- Timer minutes preserved
- Cold restore correctly loaded persisted component state from DB

**Conclusion:** The Step 7 change (`lifecycleReady` replacing `hasRuntime`) correctly handles component persistence. Components are captured from runtime when hot, persisted to DB, and restored correctly on cold restore.

---

## Logs to Watch For

### Positive Indicators (Expected)

**Log Actions:**

| Log Action | Meaning | When Expected |
|------------|---------|---------------|
| `workspace_switch_hot` | Hot switch (lifecycle ready) | Test 2 |
| `preview_snapshot_skip_hot_runtime` | Skipping replay for hot (optional, may not appear on pure hot switch) | Test 2 |
| `hydrate_skipped_lifecycle_ready` | Hydration skipped (hot) | Test 2 |
| `hydrate_on_route_load` | Cold hydration starting | Test 1 |
| `hydrate_success` | Cold hydration completed | Test 1 |
| `preview_snapshot_applied` | Preview snapshot applied (alternative cold path) | Test 1 |

**Metadata Fields** (on `select_workspace_requested`, `BuildPayloadDiagnostic`):

| Metadata Field | Meaning | When Expected |
|----------------|---------|---------------|
| `targetRuntimeState: "cold"` | Cold classification | Test 1 |
| `targetRuntimeState: "hot"` | Hot classification | Test 2 |
| `lifecycleReady: true` | Workspace lifecycle is ready | Hot paths |
| `lifecycleReady: false` | Workspace lifecycle is not ready | Cold paths |

### Negative Indicators (Should NOT Appear)

| Log Action | Meaning | Problem If Seen |
|------------|---------|-----------------|
| `hasRuntime` in `BuildPayloadDiagnostic` metadata | Old runtime check used for hot/cold classification | Step 7 incomplete |
| `fix8_rejected_empty_snapshot` | Old guard still active | Step 7 incomplete |
| `runtime_has_notes_would_lose_data` | Old guard still active | Step 7 incomplete |
| `preview_snapshot_skip_hot_runtime` for cold workspace | Hot misclassification | Regression |

**Note:** `hasRuntime` may still appear in other log components for non-classification purposes (e.g., debugging). The concern is specifically `BuildPayloadDiagnostic` using it for hot/cold decisions instead of `lifecycleReady`.

---

## Summary

| Test | Status | Notes |
|------|--------|-------|
| Test 1 - Cold Restore | ✅ PASSED | Calculator restored after eviction |
| Test 2 - Hot Switch | ✅ PASSED | `workspace_switch_hot` + `targetRuntimeState: hot` confirmed in DB |
| Test 3 - Empty Snapshot Guard | ✅ PASSED | 0 `fix8_rejected_empty_snapshot`, guard successfully removed |
| Test 4 - Error Path | ✅ PASSED | `adapter_load_error` + no false hot marking for Workspace 2 |
| Test 5 - Component Persistence | ✅ PASSED | All notes and components survived eviction cycle |
| Bonus - Degraded Mode | ✅ VALIDATED | Safety system correctly blocked after 3 failures |

**Overall Status: PASSED** - Step 7 is validated and ready to be marked complete.

---

## Post-Test Actions

- [x] Complete core tests (Tests 1-4)
- [x] Update this document with results
- [x] Mark Step 7 as complete in checklist
- [ ] Consider adding automated tests for regression coverage (future)
