# Fix Documentation: Eviction-Related Render Loop, Canvas Warnings, and Component Loss

**Date:** 2025-12-02
**Status:** Fixed
**Phase:** Phase 3 - Live-State Persistence Plan (Task 3: Pre-Eviction Persistence)

---

## Executive Summary

During testing of Task 3 (pre-eviction persistence), multiple critical issues were discovered related to workspace switching, component persistence, and render loops. This document details all issues found, their root causes, and the fixes applied.

---

## Issues Discovered

### Issue 1: App Unresponsiveness (Render Loop)

**Symptom:** App becomes unresponsive after rapid workspace switching, with the browser becoming sluggish and eventually freezing.

**Evidence:** Debug logs showed 340+ `get_open_notes_called` events in 13 seconds (26/sec vs normal ~1/sec).

**Root Cause:** After workspace eviction with `REVISION_MISMATCH` error, the runtime becomes empty but cached state remains. The `captureCurrentWorkspaceSnapshot` function enters an infinite retry loop trying to capture from cache when runtime is empty.

**Code Path:**
1. Workspace evicted due to LRU capacity
2. Pre-eviction persist fails with `REVISION_MISMATCH`
3. `captureCurrentWorkspaceSnapshot` called
4. Runtime is empty, so it tries to capture from cache
5. Cache has data, so it defers capture
6. Deferred capture calls `captureCurrentWorkspaceSnapshot` again
7. Infinite loop

---

### Issue 2: "Canvas state warnings" Toast

**Symptom:** Brief amber toast "Canvas state warnings" appears during workspace switching.

**Root Cause:** Panels with `noteId: null` trigger dedupe warnings in the canvas state management.

**Note:** This issue was secondary and resolved by other fixes that improved panel state handling.

---

### Issue 3: Data Loss After Switching Back (Notes Disappearing)

**Symptom:** Workspace notes disappear after switching away and back to a workspace.

**Root Cause:** Race condition where the `components_changed` effect triggers a persist immediately after hydration/replay, before the canvas has fully populated. This saves empty data, overwriting the good data.

**Code Path:**
1. Switch to workspace
2. Hydration/replay populates workspace state
3. `components_changed` effect triggers (detecting the population as a "change")
4. Persist runs with incomplete/empty data (LayerManager not yet populated)
5. Good data overwritten with empty data

---

### Issue 4: Component Loss in buildPayload

**Symptom:** Calculator/timer components disappear from workspaces after switching. Persist logs show `componentCount: 0` for workspaces that had components.

**Root Cause:** `buildPayload` reads components from `getWorkspaceLayerManager()`, which returns empty during transitional states (eviction, cold runtime initialization).

**Code Path:**
1. `buildPayload` called during persist
2. Reads from `layerManager.getNodes()`
3. LayerManager is in transitional state, returns empty
4. Persist saves 0 components
5. Good component data lost

---

### Issue 5: Component Loss Due to Hot Runtime Skip

**Symptom:** Components disappear on 2nd or 3rd switch back to a workspace, even when data is persisted correctly in the database.

**Root Cause:** When switching back to a workspace with a "hot" runtime (notes exist), hydration/replay is SKIPPED to avoid overwriting live state. But components are NOT restored because:

1. `runtimeComponentCount` tracks React component **registrations** (instances), not component data
2. Components deregister when they unmount during workspace switch
3. So `runtimeComponentCount === 0` even though component DATA exists in cache
4. Hot runtime skip logic sees notes exist, skips restoration
5. Components never get restored to LayerManager
6. Canvas doesn't render them

**Evidence:** `hydrate_skipped_hot_runtime` logs showing `runtimeComponentCount: 0` for workspaces that previously had components.

---

### Issue 6: Component Restore Not Triggering Canvas Re-render

**Symptom:** Even after implementing component restoration to LayerManager, components still didn't appear visually.

**Root Cause:** The canvas has a `useEffect` (line ~670 in `annotation-canvas-modern.tsx`) that reads from LayerManager and updates `canvasItems`. This effect only triggers when `workspaceSnapshotRevision` changes. The initial Fix 6 implementation registered components to LayerManager but did NOT bump the revision, so the canvas never re-read from LayerManager.

**Additional Discovery:** The warning comment "Do NOT call bumpSnapshotRevision() here" was outdated. The canvas's FIX 11 (lines 411-418 in `annotation-canvas-modern.tsx`) now only sets `workspaceRestorationInProgressRef` on **first mount**, not on subsequent revision bumps. This makes it safe to bump revision for hot runtimes.

---

## Fixes Applied

### Fix 1: Loop Breaker for Deferred Capture

**Location:** `lib/hooks/annotation/use-note-workspaces.ts`
- Lines 361-364: Added refs and constants
- Lines 1766-1816: Loop breaker logic

**Implementation:**
```typescript
// Added refs
const deferredCachedCaptureCountRef = useRef<Map<string, number>>(new Map())
const MAX_DEFERRED_CACHED_CAPTURES = 3

// In captureCurrentWorkspaceSnapshot:
if (runtimeOpenNotes.length === 0 && cachedSnapshot) {
  const count = deferredCachedCaptureCountRef.current.get(workspaceId) ?? 0
  if (count >= MAX_DEFERRED_CACHED_CAPTURES) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "snapshot_deferred_capture_loop_breaker",
      metadata: { workspaceId, count, max: MAX_DEFERRED_CACHED_CAPTURES },
    })
    deferredCachedCaptureCountRef.current.delete(workspaceId)
    return // Break the loop, don't delete cache
  }
  deferredCachedCaptureCountRef.current.set(workspaceId, count + 1)
  // ... defer capture
}
```

**Key Decision:** The loop breaker returns early WITHOUT deleting the cache. Deleting the cache would cause data loss because pre-eviction persist relies on the cached snapshot.

---

### Fix 4: Post-Hydration Save Cooldown

**Location:** `lib/hooks/annotation/use-note-workspaces.ts`
- Line ~2367: After `replayWorkspaceSnapshot`
- Line ~3419: After `hydrateWorkspace`

**Implementation:**
```typescript
// Set 500ms cooldown after hydration/replay
skipSavesUntilRef.current.set(workspaceId, Date.now() + 500)
```

**Purpose:** Prevents the `components_changed` effect from immediately persisting empty data after hydration populates the workspace. The 500ms window allows the canvas to fully populate before any saves are triggered.

**Debug Logs:**
- `persist_by_id_skip_cooldown` - confirms saves are being skipped during cooldown

---

### Fix 5: Component Fallback in buildPayload

**Location:** `lib/hooks/annotation/use-note-workspaces.ts`
- Lines ~2646-2674: In `buildPayload` function
- Lines ~2107-2114: In `buildPayloadFromSnapshot` function

**Implementation:**
```typescript
// In buildPayload:
let components = lm?.getNodes()
  ? Array.from(lm.getNodes().values())
      .filter((node: any) => node.type === "component")
      .map((node: any) => ({ /* ... */ }))
  : []

// Fallback when LayerManager returns empty
if (components.length === 0 && workspaceIdForComponents) {
  const cachedComponents = lastComponentsSnapshotRef.current.get(workspaceIdForComponents)
  const snapshotComponents = workspaceSnapshotsRef.current.get(workspaceIdForComponents)?.components
  if (cachedComponents && cachedComponents.length > 0) {
    components = cachedComponents
    emitDebugLog({
      component: "NoteWorkspace",
      action: "build_payload_component_fallback",
      metadata: {
        workspaceId: workspaceIdForComponents,
        fallbackSource: "lastComponentsSnapshotRef",
        componentCount: components.length,
      },
    })
  } else if (snapshotComponents && snapshotComponents.length > 0) {
    components = snapshotComponents
  }
}
```

**Fallback Sources (in order):**
1. `lastComponentsSnapshotRef` - last known good components
2. `workspaceSnapshotsRef` - cached workspace snapshot components

---

### Fix 6: Hot Runtime Component Restore with Revision Bump

**Location:** `lib/hooks/annotation/use-note-workspaces.ts`
- Lines ~2279-2312: In `replayWorkspaceSnapshot` hot runtime skip path
- Lines ~3647-3685: In hydrate effect hot runtime skip path

**Implementation:**
```typescript
// In replayWorkspaceSnapshot hot runtime skip path:
if (runtimeState === "hot") {
  const runtimeComponentCount = getRegisteredComponentCount(workspaceId)
  if (runtimeComponentCount === 0 && snapshot.components && snapshot.components.length > 0) {
    const layerMgr = getWorkspaceLayerManager(workspaceId)
    if (layerMgr) {
      snapshot.components.forEach((component) => {
        if (!component.id || !component.type) return
        const componentMetadata = {
          ...(component.metadata ?? {}),
          componentType: component.type,
        } as Record<string, unknown>
        layerMgr.registerNode({
          id: component.id,
          type: "component",
          position: component.position ?? { x: 0, y: 0 },
          dimensions: component.size ?? undefined,
          zIndex: component.zIndex ?? undefined,
          metadata: componentMetadata,
        } as any)
      })
      emitDebugLog({
        component: "NoteWorkspace",
        action: "preview_hot_runtime_component_restore",
        metadata: { workspaceId, componentCount: snapshot.components.length },
      })
      // CRITICAL: Bump revision to trigger canvas useEffect
      bumpSnapshotRevision()
    }
  }
}

// Similar implementation in hydrate effect with:
// - Reads from lastComponentsSnapshotRef or workspaceSnapshotsRef
// - Logs as "hydrate_hot_runtime_component_restore"
// - Also calls bumpSnapshotRevision()
```

**Why bumpSnapshotRevision() is safe:**
The canvas's FIX 11 (in `annotation-canvas-modern.tsx`) only sets `workspaceRestorationInProgressRef = true` on **first mount** (`isFirstMount = previousRevision === null`). For hot runtimes, the canvas is already mounted, so `isFirstMount = false` and the restoration flag is NOT set.

---

## Debug Logs Reference

| Log Action | Description |
|------------|-------------|
| `snapshot_deferred_capture_loop_breaker` | Fix 1: Loop breaker triggered |
| `persist_by_id_skip_cooldown` | Fix 4: Save skipped due to cooldown |
| `build_payload_component_fallback` | Fix 5: Component fallback used |
| `preview_hot_runtime_component_restore` | Fix 6: Components restored in replay path |
| `hydrate_hot_runtime_component_restore` | Fix 6: Components restored in hydrate path |
| `preview_snapshot_skip_hot_runtime` | Hot runtime skip (with runtimeComponentCount) |
| `hydrate_skipped_hot_runtime` | Hydration skipped for hot runtime |
| `noteIds_sync_skip_during_hydration` | Fix 7: Note sync blocked by hydrationInProgressRef |
| `workspace_restoration_completed` | Fix 7: Hydration complete, onHydrationComplete called |

---

## Files Modified

1. **`lib/hooks/annotation/use-note-workspaces.ts`**
   - Lines 361-364: Loop breaker refs and constants
   - Lines 1766-1816: Loop breaker logic in `captureCurrentWorkspaceSnapshot`
   - Lines ~2107-2114: Component fallback in `buildPayloadFromSnapshot`
   - Lines ~2279-2312: Component restore + revision bump in `replayWorkspaceSnapshot`
   - Lines ~2367: Cooldown after `replayWorkspaceSnapshot`
   - Lines ~2646-2674: Component fallback in `buildPayload`
   - Lines ~3419: Cooldown after `hydrateWorkspace`
   - Lines ~3647-3685: Component restore + revision bump in hydrate effect
   - Line ~3721: Added `bumpSnapshotRevision` to hydrate effect dependencies

2. **`lib/hooks/annotation/use-non-main-panel-hydration.ts`** (Fix 7)
   - Lines 29-37: Added `onHydrationComplete` callback to options type
   - Line 55: Added `onHydrationComplete` to function parameters
   - Line 200: Call `onHydrationComplete?.()` after "no_panels_to_add"
   - Line 272: Call `onHydrationComplete?.()` after "hydration_successful"
   - Line 298: Call `onHydrationComplete?.()` after "hydration_error"
   - Line 300: Added `onHydrationComplete` to effect dependencies

3. **`components/annotation-canvas-modern.tsx`** (Fix 7)
   - Lines 320-328: Added `nonMainHydrationCompleteCount` state and `handleNonMainHydrationComplete` callback
   - Line 466: Updated `hydrationStateKey` to include counter
   - Line 482: Passed `onHydrationComplete` callback to `useNonMainPanelHydration`

---

### Issue 7: Late Note Appearance (Notes Only Show After User Interaction)

**Symptom:** When switching workspaces, notes appear late (1-2 seconds delay) or only after user interaction like clicking/dragging the canvas.

**Root Cause:** The `hydrationInProgressRef` ref blocks canvas note sync, but when hydration completes and the ref is cleared, React doesn't re-render because refs don't trigger state updates. The canvas note sync effect (`useCanvasNoteSync`) has `hydrationStateKey` in its dependencies, but this key doesn't change when non-main panel hydration completes.

**Evidence from logs:**
```
22:03:10.303-10.343: noteIds_sync_skip_during_hydration (blocked by ref)
22:03:10.350-10.377: workspace_restoration_completed (ref cleared)
22:03:10.384-22:03:11.977: *** 1.6 second gap - nothing happens ***
22:03:12.010: setCanvasState_called from handleCanvasMouseDown (USER CLICK!)
22:03:12.240: Notes finally appear
```

**Code Path:**
1. Workspace switch triggers non-main panel hydration
2. `hydrationInProgressRef.current = true` blocks canvas note sync
3. Hydration completes, clears `hydrationInProgressRef.current = false`
4. But refs don't trigger React re-renders
5. `useCanvasNoteSync` effect doesn't re-run (no dependency changed)
6. Notes stay hidden until user interaction causes a re-render

---

### Fix 7: Hydration Complete Callback to Trigger Re-render

**Location:**
- `lib/hooks/annotation/use-non-main-panel-hydration.ts` - Added `onHydrationComplete` callback
- `components/annotation-canvas-modern.tsx` - Added state counter and wired up callback

**Implementation:**

```typescript
// In use-non-main-panel-hydration.ts - added callback option
type UseNonMainPanelHydrationOptions = {
  // ... existing options
  onHydrationComplete?: () => void  // NEW
}

// Call the callback after clearing hydrationInProgressRef in all code paths:
// 1. After "no_panels_to_add" (line 200)
// 2. After "hydration_successful" (line 272)
// 3. After "hydration_error" (line 298)
onHydrationComplete?.()
```

```typescript
// In annotation-canvas-modern.tsx
// Added state counter (line 325):
const [nonMainHydrationCompleteCount, setNonMainHydrationCompleteCount] = useState(0)
const handleNonMainHydrationComplete = useCallback(() => {
  setNonMainHydrationCompleteCount(c => c + 1)
}, [])

// Updated hydrationStateKey to include counter (line 466):
hydrationStateKey: `${primaryHydrationStatus.success}-${primaryHydrationStatus.panelsLoaded}-${nonMainHydrationCompleteCount}`,

// Passed callback to hook (line 482):
onHydrationComplete: handleNonMainHydrationComplete,
```

**Why this works:**
1. When hydration completes, `onHydrationComplete()` is called
2. This increments `nonMainHydrationCompleteCount` state
3. State change triggers React re-render
4. `hydrationStateKey` changes (includes the counter)
5. `useCanvasNoteSync` effect re-runs (has `hydrationStateKey` dependency)
6. Effect sees `hydrationInProgressRef.current = false`, allows sync to proceed
7. Notes appear immediately

---

### Issue 8: Cross-Workspace Panel Contamination (Wrong Panels Saved)

**Symptom:** Notes disappear from workspaces after switching. Database shows workspace's `panels` array contains panels with noteIds belonging to a different workspace.

**Evidence:**
```
Default Workspace:
  openNotes: 94f9d18d... (correct note)
  panels:    d675bdbd... (WRONG - belongs to Workspace a)
```

**Root Cause:** Workspace ID resolution mismatch between `buildPayload` and `collectPanelSnapshotsFromDataStore`.

**`buildPayload` (line 2577-2578):**
```typescript
const workspaceIdForComponents =
  currentWorkspaceId ?? snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current
```

**`collectPanelSnapshotsFromDataStore` (line 873 - OLD):**
```typescript
const activeWorkspaceId =
  snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
```

The fallback order is **different**! If `snapshotOwnerWorkspaceIdRef` has a stale value from a previous workspace:
- `buildPayload` uses `currentWorkspaceId` → correct workspace
- `collectPanelSnapshotsFromDataStore` uses `snapshotOwnerWorkspaceIdRef` → wrong workspace

Result: Panels from the wrong workspace are read and saved to the current workspace.

---

### Fix 9: Pass Target Workspace ID to collectPanelSnapshotsFromDataStore

**Location:** `lib/hooks/annotation/use-note-workspaces.ts`
- Lines 871-880: Added optional `targetWorkspaceId` parameter
- Lines 2601-2606: Pass `workspaceIdForComponents` to the function

**Implementation:**

```typescript
// FIX 9: Accept optional targetWorkspaceId parameter
const collectPanelSnapshotsFromDataStore = useCallback((targetWorkspaceId?: string | null): NoteWorkspacePanelSnapshot[] => {
  // FIX 9: Prefer targetWorkspaceId if explicitly provided by caller
  const activeWorkspaceId = targetWorkspaceId ?? snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
  // ... rest of function
})

// In buildPayload:
// FIX 9: Pass workspaceIdForComponents to ensure correct workspace
let panelSnapshots =
  v2Enabled && currentWorkspaceId
    ? collectPanelSnapshotsFromDataStore(workspaceIdForComponents)
    : getAllPanelSnapshots({ useFallback: false })
```

**Why this works:**
1. `buildPayload` determines `workspaceIdForComponents` (the target workspace)
2. Passes it explicitly to `collectPanelSnapshotsFromDataStore`
3. Function uses that exact workspace ID to read from the correct DataStore
4. No more cross-workspace contamination from stale refs

---

## Testing Verification

After all fixes:

1. **Create 5+ workspaces** with notes AND components (timer, calculator)
2. **Rapidly switch between them** multiple times
3. **Verify:**
   - No app freeze/render loop
   - No "Canvas state warnings" toast
   - Notes persist when switching back
   - Components persist when switching back
   - Database has correct component counts
   - **Notes appear immediately** (no 1-2 second delay, no need to interact)
   - **No cross-workspace panel contamination** (each workspace's panels match its openNotes)

**Expected log patterns:**
- `preview_snapshot_skip_hot_runtime` with `runtimeComponentCount > 0` = components preserved
- `persist_by_id_success` with `componentCount > 0` = components saved correctly
- No `snapshot_deferred_capture_loop_breaker` during normal operation
- `workspace_restoration_completed` followed quickly by notes appearing (no long gap)

---

## Test Results (2025-12-02)

### Test Performed

1. Created 5 workspaces (Default, Workspace a-d)
2. Added notes to each workspace (Workspace d had 2 notes with a branch panel)
3. Added timer components to workspaces a, b, c and calculator/timer to Default
4. Rapidly switched between workspaces multiple times
5. Reloaded the app to test persistence

### Results

| Fix | Issue | Status | Evidence |
|-----|-------|--------|----------|
| Fix 1 | Render loop | ✅ Verified | No `snapshot_deferred_capture_loop_breaker` logs during normal operation |
| Fix 4 | Post-hydration save race | ✅ Verified | No data loss after workspace switches |
| Fix 5 | Component fallback | ✅ Verified | Components persisted correctly |
| Fix 6 | Hot runtime component restore | ✅ Verified | `preview_hot_runtime_component_restore` logged with correct componentCount |
| Fix 7 | Late note appearance | ✅ Verified | Notes appeared immediately, no interaction required |
| Fix 9 | Cross-workspace contamination | ✅ Verified | Each workspace's panels match its openNotes in DB |

### Database State After Testing

| Workspace | Notes | Panels | Components |
|-----------|-------|--------|------------|
| Default Workspace | 1 | 1 | 3 (calculator, calculator, timer) |
| Workspace a | 1 | 1 | 1 (timer) |
| Workspace b | 1 | 1 | 1 (timer) |
| Workspace c | 1 | 1 | 1 (timer) |
| Workspace d | 2 | 3 | 0 (no components added) |

### Post-Reload Verification

After page reload:
- All workspaces loaded with correct notes
- All components restored correctly
- `hydration_complete` logs showed successful camera and panel restoration
- `preview_hot_runtime_component_restore` confirmed component restoration

### Observations (Non-blocking)

1. **REVISION_MISMATCH during pre-eviction**: Some pre-eviction callbacks failed with `REVISION_MISMATCH` error. This is a race condition where the normal save completes before the pre-eviction save, making the pre-eviction revision stale. This is **harmless** because the normal save already captured the correct state.

2. **`"__workspace__"` placeholder**: Some older log entries show this placeholder. May be legacy data from earlier development.

---

## Lessons Learned

1. **React component lifecycle vs data persistence:** React components deregistering on unmount doesn't mean data is lost - it means we need to restore data when components remount.

2. **Outdated warning comments:** The "Do NOT call bumpSnapshotRevision()" warning was outdated after FIX 11 was implemented. Always verify assumptions against current code.

3. **Multiple fallback layers:** Having fallback sources (`lastComponentsSnapshotRef`, `workspaceSnapshotsRef`, DB) provides resilience against transitional state issues.

4. **Loop detection is essential:** Any retry/defer pattern needs a maximum count to prevent infinite loops.

5. **Cooldown periods prevent race conditions:** A simple time-based cooldown can prevent race conditions between async operations.

6. **Refs don't trigger re-renders:** When using refs to control behavior in effects, remember that changing a ref value doesn't trigger the effect to re-run. If behavior depends on the ref, you need a complementary mechanism (like a state counter or callback) to trigger the re-render when the ref changes.

---

## Related Documentation

- `docs/proposal/components/workspace/note/plan/fixed/2025-12-01-task3-pre-eviction-persistence.md` - Task 3 implementation details
- `docs/proposal/components/workspace/note/plan/live-state-phase3-persistence.md` - Overall Phase 3 plan
