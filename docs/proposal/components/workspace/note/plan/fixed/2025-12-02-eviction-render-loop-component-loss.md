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

**Expected log patterns:**
- `preview_snapshot_skip_hot_runtime` with `runtimeComponentCount > 0` = components preserved
- `persist_by_id_success` with `componentCount > 0` = components saved correctly
- No `snapshot_deferred_capture_loop_breaker` during normal operation

---

## Lessons Learned

1. **React component lifecycle vs data persistence:** React components deregistering on unmount doesn't mean data is lost - it means we need to restore data when components remount.

2. **Outdated warning comments:** The "Do NOT call bumpSnapshotRevision()" warning was outdated after FIX 11 was implemented. Always verify assumptions against current code.

3. **Multiple fallback layers:** Having fallback sources (`lastComponentsSnapshotRef`, `workspaceSnapshotsRef`, DB) provides resilience against transitional state issues.

4. **Loop detection is essential:** Any retry/defer pattern needs a maximum count to prevent infinite loops.

5. **Cooldown periods prevent race conditions:** A simple time-based cooldown can prevent race conditions between async operations.

---

## Related Documentation

- `docs/proposal/components/workspace/note/plan/fixed/2025-12-01-task3-pre-eviction-persistence.md` - Task 3 implementation details
- `docs/proposal/components/workspace/note/plan/live-state-phase3-persistence.md` - Overall Phase 3 plan
