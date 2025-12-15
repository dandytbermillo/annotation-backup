# Component Deletion Persistence Fix

**Date**: 2025-12-15
**Status**: Fixed and Verified
**Affected Workspace**: Default workspace (`summary14`)
**Issue**: Deleted components (Timer, Calculator) reappear after app reload

---

## Problem Statement

When a user deletes components (Timer, Calculator) from the default workspace and reloads the app, the deleted components reappear. The deletion is not being persisted to the database.

### Observed Behavior

1. User creates Timer/Calculator in default workspace `summary14`
2. User deletes the components
3. Components disappear from UI (correct)
4. User reloads the app
5. **Bug**: Deleted components reappear

### Expected Behavior

Deleted components should stay deleted after app reload.

---

## Root Cause Analysis

The bug had **two contributing issues**:

### Issue 1: `scheduleImmediateSave` Was a Flush, Not a Scheduler

**Location**: `lib/hooks/annotation/use-note-workspaces.ts:1718`

```typescript
// BEFORE (broken):
scheduleImmediateSave: flushPendingSave,
```

**Problem Flow**:

1. `handleComponentClose()` calls `onComponentChange()`
2. `onComponentChange` is wired to `scheduleImmediateSave("components_changed")`
3. `scheduleImmediateSave` was mapped to `flushPendingSave`
4. `flushPendingSave` only:
   - Flushes already-scheduled timeouts from `saveTimeoutRef.current`
   - Saves if workspace is already marked dirty in `workspaceDirtyRef.current`
5. **Neither condition was met** - component deletion doesn't go through `scheduleSave`

**Evidence from logs (before fix)**:
```
21:27:40 save_flush_all: pendingCount: 0, pendingWorkspaceIds: []
21:27:42 save_flush_all: pendingCount: 0, pendingWorkspaceIds: []
```

The `pendingCount: 0` shows nothing was pending to save.

### Issue 2: Deletion Didn't Remove from Workspace Component Store

**Location**: `lib/hooks/annotation/use-component-creation-handler.ts:143-189`

The `handleComponentClose` function removed components from:
- Runtime ledger (`removeRuntimeComponent`)
- Layer manager (`layerMgr.removeNode`)
- Canvas items (`setCanvasItems`)

But it did **NOT** remove from the Workspace Component Store, which is the authoritative source for persistence (used by `getComponentsForPersistence()` in `lib/workspace/store-runtime-bridge.ts:73-132`).

---

## The Fix

### Fix 1: Make `scheduleImmediateSave` Actually Schedule

**File**: `lib/hooks/annotation/use-note-workspaces.ts`
**Line**: 1718

```typescript
// BEFORE (broken):
scheduleImmediateSave: flushPendingSave,

// AFTER (fixed):
scheduleImmediateSave: (reason?: string) => scheduleSave({ immediate: true, reason }),
```

**Why This Works**:

`scheduleSave({ immediate: true })` does two things that `flushPendingSave` doesn't:

1. **Marks workspace dirty** (line 1163-1164):
   ```typescript
   if (!workspaceDirtyRef.current.has(workspaceId)) {
     workspaceDirtyRef.current.set(workspaceId, Date.now())
   }
   ```

2. **Calls persist immediately** (line 1178-1180):
   ```typescript
   if (immediate) {
     void persistWorkspaceById(workspaceId, reason)
     return
   }
   ```

### Fix 2: Remove from Workspace Component Store

**File**: `lib/hooks/annotation/use-component-creation-handler.ts`
**Lines**: 158-162 (added in `handleComponentClose`)

```typescript
// Phase 5: Remove from workspace component store (authoritative source for persistence)
if (workspaceKey && hasWorkspaceComponentStore(workspaceKey)) {
  const store = getWorkspaceComponentStore(workspaceKey)
  store.removeComponent(id)
}
```

**Required Import** (line 12):
```typescript
import { getWorkspaceComponentStore, hasWorkspaceComponentStore } from "@/lib/workspace/workspace-component-store"
```

---

## Complete Deletion Flow After Fix

```
User clicks delete on component
        │
        ▼
handleComponentClose(id)
        │
        ├──► markComponentDeleted(workspaceKey, id)     // Prevent resurrection
        │
        ├──► removeRuntimeComponent(workspaceKey, id)   // Clear runtime ledger
        │
        ├──► store.removeComponent(id)                  // ★ FIX 2: Remove from authoritative store
        │
        ├──► layerMgr.removeNode(id)                    // Clear layer manager
        │
        ├──► setCanvasItems(prev => prev.filter(...))   // Remove from UI
        │
        └──► onComponentChange()
                    │
                    ▼
            scheduleSave({ immediate: true, reason: "components_changed" })  // ★ FIX 1
                    │
                    ├──► workspaceDirtyRef.current.set(workspaceId, Date.now())  // Mark dirty
                    │
                    └──► persistWorkspaceById(workspaceId, reason)              // Save immediately
                                │
                                ▼
                        buildPayload()
                                │
                                ▼
                        getComponentsForPersistence()
                                │
                                ▼
                        store.getAllComponents()  // Returns [] (component removed)
                                │
                                ▼
                        Database updated with empty component list
```

---

## Verification

### Log Evidence (After Fix)

```
22:12:06.7905   save_schedule       | immediate: true | reason: components_changed  ← FIX 1 working
22:12:06.790641 component_removed   | component-1765836626012-fju0hhr64             ← FIX 2 working
22:12:06.79113  REMOVING_COMPONENT  | component-1765836626012-fju0hhr64
22:12:06.807598 persist_by_id_start | reason: components_changed                    ← Save triggered
```

### Component Count Verification

```
22:11:52 get_components_from_store: componentCount: 2  (before delete)
22:12:05 get_components_from_store: componentCount: 1  (after delete)
```

### Before vs After Comparison

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| On delete action | `save_flush_all` with `pendingCount: 0` | `save_schedule` with `immediate: true` |
| Persist triggered? | No | Yes |
| Store updated? | No | Yes |
| Survives reload? | No (components return) | Yes (components stay deleted) |

---

## Why "Delete Component + Delete Note" Worked Before

The bug only manifested when deleting components **without** other state changes. When a note was also deleted:

1. Note deletion triggers `scheduleSave` through other paths (openNotes change, panel snapshot changes)
2. Workspace gets marked dirty through those paths
3. `flushPendingSave` then has something to flush

This is why the bug was intermittent and hard to reproduce consistently.

---

## Files Modified

1. **`lib/hooks/annotation/use-note-workspaces.ts`**
   - Line 1718: Changed `scheduleImmediateSave` mapping

2. **`lib/hooks/annotation/use-component-creation-handler.ts`**
   - Line 12: Added import for workspace component store
   - Lines 158-162: Added `store.removeComponent(id)` in `handleComponentClose`

---

## Related Code Paths

- `lib/hooks/annotation/workspace/use-workspace-persistence.ts:1146-1199` - `scheduleSave` function
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts:1204-1253` - `flushPendingSave` function
- `lib/workspace/store-runtime-bridge.ts:73-132` - `getComponentsForPersistence` function
- `lib/workspace/workspace-component-store.ts:281-309` - `removeComponent` method
- `components/annotation-app-shell.tsx:1739` - `onComponentChange` wiring

---

## Testing Checklist

- [x] Create Timer in default workspace
- [x] Delete Timer
- [x] Reload app
- [x] Verify Timer does not reappear
- [x] Check logs show `save_schedule` with `immediate: true`
- [x] Check logs show `component_removed` from store
- [x] Check `get_components_from_store` shows decremented count

---

## Lessons Learned

1. **Naming matters**: `scheduleImmediateSave` suggested it would schedule a save, but it was actually just a flush. The misleading name hid the bug.

2. **Multiple sources of truth**: The system had runtime ledger, layer manager, canvas items, AND workspace component store. All must be updated on deletion.

3. **Authoritative source**: The workspace component store is the authoritative source for persistence (`getComponentsForPersistence` prefers it). Any modification must update it.

4. **Test edge cases**: The bug only appeared when deleting components without other state changes. Testing "component deletion only" (no note changes) would have caught this earlier.
