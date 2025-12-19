# Phase 3: Unified Restore (Cold Restore is Never Misclassified)

**Date:** 2025-12-18
**Status:** Complete
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Summary

This phase implements the unified lifecycle state manager that tracks workspace restoration state.
The lifecycle state (`uninitialized → restoring → ready`) becomes the **single source of truth**
for hot/cold restore classification, replacing the fragmented checks scattered across the codebase.

---

## Problem Solved

### Before (Fragmented Checks)

Hot/cold restore classification was scattered across multiple locations:

| Location | Check Used |
|----------|------------|
| `runtime-manager.ts` | `hydrationState` ("hydrated"/"hydrating"/"unhydrated") |
| `store-runtime-bridge.ts` | `hasWorkspaceComponentStore() && store.length > 0 && isWorkspaceHydrated()` |
| `use-workspace-hydration.ts` | `hasWorkspaceRuntime() && isWorkspaceHydrated() && (openNotes.length > 0 \|\| componentCount > 0)` |

These checks could get out of sync, leading to misclassification:
- **False hot**: Think workspace is restored when it isn't → skip load → empty workspace
- **False cold**: Think workspace needs load when it's already restored → overwrite in-memory state

### After (Unified Lifecycle)

A single lifecycle state tracks the workspace's restoration status:

```
uninitialized → restoring → ready
```

- **`ready`** = Workspace is fully restored (hot restore, skip DB load)
- **Not `ready`** = Workspace needs restoration (cold restore, load from DB)

---

## What Was Implemented

### 1. Lifecycle State Manager

**File:** `lib/workspace/durability/lifecycle-manager.ts` (NEW)

| Function | Purpose |
|----------|---------|
| `getWorkspaceLifecycle(workspaceId)` | Get current lifecycle state |
| `isWorkspaceLifecycleReady(workspaceId)` | Check if workspace is fully restored |
| `beginWorkspaceRestore(workspaceId, source)` | Transition to `restoring` (before load) |
| `completeWorkspaceRestore(workspaceId, source)` | Transition to `ready` (after load) |
| `removeWorkspaceLifecycle(workspaceId)` | Clean up on eviction |

### 2. Hydration Integration

**File:** `lib/hooks/annotation/workspace/use-workspace-hydration.ts`

**Before load:**
```typescript
if (liveStateEnabled) {
  beginWorkspaceRestore(workspaceId, "hydrate_workspace")
  markWorkspaceHydrating(workspaceId, "hydrate_workspace")
}
```

**After load (both domains restored):**
```typescript
if (liveStateEnabled) {
  markWorkspaceHydrated(workspaceId, "hydrate_workspace")
  completeWorkspaceRestore(workspaceId, "hydrate_workspace")
}
```

**Hydration trigger (primary check):**
```typescript
// Phase 3: Check lifecycle state as PRIMARY hot/cold discriminator
if (liveStateEnabled && isWorkspaceLifecycleReady(currentWorkspaceId)) {
  emitDebugLog({
    component: "NoteWorkspace",
    action: "hydrate_skipped_lifecycle_ready",
    metadata: { workspaceId: currentWorkspaceId, reason: "workspace_lifecycle_is_ready" },
  })
  return  // Hot restore: skip hydration
}
```

### 3. Hot/Cold Detection Updated

**File:** `lib/workspace/store-runtime-bridge.ts`

```typescript
export function detectRestoreType(workspaceId: string): RestoreType {
  // Phase 3: Primary check - use unified lifecycle state
  if (isWorkspaceLifecycleReady(workspaceId)) {
    return 'hot'
  }

  // Legacy fallback for backward compatibility during transition
  // ...existing checks...

  return 'cold'
}
```

### 4. Workspace Selection Integration

**File:** `lib/hooks/annotation/workspace/use-workspace-selection.ts`

The `selectWorkspace` function is another code path that loads workspace data from DB.
Both paths now use consistent lifecycle transitions:

**Before load:**
```typescript
if (liveStateEnabled && shouldRestoreFromAdapter) {
  beginWorkspaceRestore(workspaceId, "select_workspace")
  markWorkspaceHydrating(workspaceId, "select_workspace")
}
```

**After successful load:**
```typescript
markWorkspaceHydrated(workspaceId, "select_workspace")
completeWorkspaceRestore(workspaceId, "select_workspace")
```

**On error:**
```typescript
removeWorkspaceLifecycle(workspaceId)
markWorkspaceUnhydrated(workspaceId, "select_workspace_error")
```

### 5. Eviction Cleanup

**File:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts`

```typescript
// Safe to evict: either persist succeeded or workspace wasn't dirty
removeWorkspaceRuntime(targetWorkspaceId)
// Phase 3: Clean up lifecycle state when workspace is evicted
removeWorkspaceLifecycle(targetWorkspaceId)
```

---

## Files Modified

| File | Change |
|------|--------|
| `lib/workspace/durability/lifecycle-manager.ts` | **NEW** - Lifecycle state manager |
| `lib/workspace/durability/index.ts` | Added lifecycle exports |
| `lib/hooks/annotation/workspace/use-workspace-hydration.ts` | Wire lifecycle into hydration flow |
| `lib/hooks/annotation/workspace/use-workspace-selection.ts` | Wire lifecycle into workspace selection |
| `lib/workspace/store-runtime-bridge.ts` | Use lifecycle for hot/cold detection |
| `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` | Clean up lifecycle on eviction |

---

## Lifecycle State Machine

```
                    ┌────────────────────────────────────────┐
                    │                                        │
                    v                                        │
┌───────────────┐       ┌───────────┐       ┌───────┐       │
│ uninitialized │──────>│ restoring │──────>│ ready │───────┘
└───────────────┘       └───────────┘       └───────┘
       │                      │                 │
       │ (runtime created)    │ (load from DB)  │ (persist/switch)
       │                      │                 │
       v                      v                 v
    No persist             No persist        Safe to persist
    Skip = cold            Skip = cold       Skip = hot
```

**State Semantics:**

| State | Meaning | Persist Allowed | Restore Type |
|-------|---------|-----------------|--------------|
| `uninitialized` | Runtime exists but never loaded | No | Cold |
| `restoring` | Loading from DB in progress | No | Cold |
| `ready` | Fully restored, in-memory state valid | Yes | Hot |
| `persisting` | Persist in progress | Reads OK | Hot |
| `degraded` | Consecutive failures | Yes (recovery) | Blocked |

---

## Cold Restore Invariant

**Invariant:** When `restoring` completes and transitions to `ready`, both domains MUST be restored:

1. Notes/panels domain: `commitWorkspaceOpenNotes()`, `applyPanelSnapshots()`
2. Components domain: `restoreComponentsToWorkspace()`, `populateRuntimeComponents()`

This is enforced by the hydration sequence:
```typescript
// 1. Load from DB
const record = await adapterRef.current.loadWorkspace(workspaceId)

// 2. Restore notes/panels
commitWorkspaceOpenNotes(workspaceId, normalizedSnapshotOpenNotes, ...)
applyPanelSnapshots(scopedPanels, panelNoteIds, resolvedComponents, ...)

// 3. Restore components
restoreComponentsToWorkspace(workspaceId, resolvedComponents, { forceRestoreType: 'cold' })
populateRuntimeComponents(workspaceId, resolvedComponents)

// 4. Only THEN mark ready
completeWorkspaceRestore(workspaceId, "hydrate_workspace")
```

---

## Backward Compatibility

The legacy checks remain as fallback during the transition period:

1. `isWorkspaceHydrated(workspaceId)` - Still used by existing code
2. `hasWorkspaceRuntime() && openNotes.length > 0` - Fallback in hydration trigger
3. `hasWorkspaceComponentStore() && store.length > 0` - Fallback in `detectRestoreType()`

These fallbacks will catch cases where lifecycle isn't wired yet (e.g., external callers).

---

## Acceptance Criteria

- [x] Lifecycle manager created (`lifecycle-manager.ts`)
- [x] Lifecycle exports added to durability index
- [x] Hydration calls `beginWorkspaceRestore()` before load
- [x] Hydration calls `completeWorkspaceRestore()` after both domains restored
- [x] Hydration trigger uses `isWorkspaceLifecycleReady()` as primary check
- [x] `detectRestoreType()` uses lifecycle as primary check
- [x] Eviction cleans up lifecycle state
- [x] Type-check passes
- [x] Legacy fallbacks preserved for backward compatibility

---

## Testing Notes

To verify lifecycle tracking is working:

1. Open dev tools console
2. Navigate to a workspace
3. Check logs for `DurabilityLifecycle` component:
   - `lifecycle_transition`: Should show `uninitialized → restoring → ready`
4. Switch to another workspace and back
5. Check logs for `hydrate_skipped_lifecycle_ready`:
   - This confirms hot restore classification via lifecycle

---

## Next Steps

**Phase 4:** Unified Dirty Model
- Ensure all dirty-setting code paths use the unified API
- Add lifecycle state to block dirty-marking during `restoring`
- This prevents false positives where restore triggers dirty flags

