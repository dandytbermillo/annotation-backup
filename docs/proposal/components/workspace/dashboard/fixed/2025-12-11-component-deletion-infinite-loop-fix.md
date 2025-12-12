# Component Deletion Infinite Loop Fix

**Date:** 2025-12-11
**Status:** Fixed
**Severity:** Critical (App becomes unresponsive)

## Summary

Fixed an infinite loop bug that occurred when a component (e.g., timer) was deleted from a workspace and the user switched away and back to that workspace. The app would become unresponsive with continuous Canvas Layout API calls flooding the terminal.

## Symptoms

1. User adds a component (e.g., timer) to a workspace
2. User deletes the component
3. User switches to another workspace and back
4. **Result:** App freezes, terminal floods with:
   ```
   [Canvas Layout API] Fetched 1 panels for note xxx
   GET /api/canvas/layout/xxx 200 in 20ms
   POST /api/debug/log 200 in 16ms
   ...repeating infinitely...
   ```

## Root Cause Analysis

### The Loop Pattern

The bug was caused by stale cache data in `lastComponentsSnapshotRef` triggering a hydration loop:

```
1. Workspace switch back to summary14
   ↓
2. hydrateWorkspace() called
   ↓
3. runtimeComponentCount === 0 (component was deleted)
   ↓
4. BUT cache (lastComponentsSnapshotRef) still has the deleted component!
   ↓
5. Hydration tries to restore: populateRuntimeComponents()
   ↓
6. Runtime SKIPS the component (it's in runtime.deletedComponents)
   → populatedCount: 0, skippedDeletedCount: 1
   ↓
7. BUT hydration calls bumpSnapshotRevision() UNCONDITIONALLY
   ↓
8. Revision change triggers re-render
   ↓
9. Back to step 2 → INFINITE LOOP
```

### Key Issues Identified

1. **Cache not cleaned on delete:** When a component was deleted, it was marked in `runtime.deletedComponents` but NOT removed from `lastComponentsSnapshotRef` cache.

2. **Unconditional revision bump:** The hydration code called `bumpSnapshotRevision()` even when no components were actually populated (all were skipped as deleted).

## Solution: Two-Part Fix (Defense in Depth)

### Fix 1: Clear Cache on Component Delete (Primary Fix)

When a component is deleted, immediately remove it from `lastComponentsSnapshotRef` so hydration doesn't try to restore it.

**Files Modified:**

1. **`lib/hooks/annotation/use-component-creation-handler.ts`**
   - Added `onComponentDeleted` callback prop
   - Call the callback after `markComponentDeleted()`

2. **`lib/hooks/annotation/use-note-workspaces.ts`**
   - Added `clearDeletedComponentFromCache()` function
   - Filters out the deleted component from `lastComponentsSnapshotRef`

3. **`lib/hooks/annotation/workspace/workspace-types.ts`**
   - Added `clearDeletedComponentFromCache` to `UseNoteWorkspaceResult` type

4. **`components/annotation-canvas-modern.tsx`**
   - Added `onComponentDeleted` prop to interface and component

5. **`components/workspace/annotation-workspace-canvas.tsx`**
   - Pass through `onComponentDeleted` prop

6. **`components/annotation-app-shell.tsx`**
   - Wire up `onComponentDeleted={noteWorkspaceState.clearDeletedComponentFromCache}`

**Implementation:**

```typescript
// use-note-workspaces.ts
const clearDeletedComponentFromCache = useCallback(
  (workspaceId: string, componentId: string) => {
    const cached = lastComponentsSnapshotRef.current.get(workspaceId)
    if (!cached) return

    const filtered = cached.filter(c => c.id !== componentId)
    if (filtered.length !== cached.length) {
      lastComponentsSnapshotRef.current.set(workspaceId, filtered)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "cleared_deleted_component_from_cache",
        metadata: { workspaceId, componentId, remainingCount: filtered.length },
      })
    }
  },
  [emitDebugLog],
)
```

### Fix 2: Guard Revision Bump (Safety Net)

Only bump revision if components were actually populated, preventing the loop even if cache cleanup fails.

**Files Modified:**

1. **`lib/workspace/runtime-manager.ts`**
   - Changed `populateRuntimeComponents` return type from `void` to `{ populatedCount, skippedDeletedCount }`

2. **`lib/hooks/annotation/workspace/use-workspace-hydration.ts`**
   - Capture return value from `populateRuntimeComponents`
   - Only call `bumpSnapshotRevision()` if `actuallyPopulatedCount > 0 || runtimeLedgerCount > 0`

**Implementation:**

```typescript
// use-workspace-hydration.ts
let actuallyPopulatedCount = 0
if (runtimeLedgerCount === 0) {
  const result = populateRuntimeComponents(currentWorkspaceId, componentsToRestore)
  actuallyPopulatedCount = result.populatedCount
}

// Only bump revision if components were actually restored
if (actuallyPopulatedCount > 0 || runtimeLedgerCount > 0) {
  bumpSnapshotRevision()
} else {
  emitDebugLog({
    component: "NoteWorkspace",
    action: "hydrate_skipped_revision_bump",
    metadata: {
      workspaceId: currentWorkspaceId,
      reason: "no_components_actually_populated",
      componentCount: componentsToRestore.length,
      actuallyPopulatedCount,
    },
  })
}
```

## Verification

After the fix, the debug logs show correct behavior:

```
component_marked_deleted          → Timer marked deleted in runtime
cleared_deleted_component_from_cache → Cache cleared (NEW!)
runtime_component_removed         → Removed from runtime ledger
component_deregistered            → Deregistered from LayerManager

// After workspace switch back:
hydrate_skipped_hot_runtime       → runtimeComponentCount: 0 (no loop!)
```

**Key evidence:**
- `cleared_deleted_component_from_cache` shows cache is cleaned immediately on delete
- No `hydrate_hot_runtime_component_restore` logs after switching back
- No infinite API calls in terminal

## Safety Analysis

### Fix 1 (Cache Cleanup) - SAFE
- Consistent with existing deletion flow (runtime.deletedComponents)
- Workspace-scoped: only affects specific workspace
- Null-safe: returns early if no cache entry
- No data loss: component is intentionally deleted

### Fix 2 (Return Counts) - SAFE
- Backwards compatible: callers can ignore return value
- Logic handles all cases:
  - `runtimeLedgerCount > 0` → bump (existing components)
  - `populatedCount > 0` → bump (new components restored)
  - Both = 0 → don't bump (nothing to restore)

### Defense in Depth
- Fix 1 prevents loop by cleaning source (cache)
- Fix 2 prevents loop even if cache cleanup fails (guards symptom)

## Files Changed Summary

| File | Change |
|------|--------|
| `lib/hooks/annotation/use-component-creation-handler.ts` | Added `onComponentDeleted` callback |
| `lib/hooks/annotation/use-note-workspaces.ts` | Added `clearDeletedComponentFromCache` |
| `lib/hooks/annotation/workspace/workspace-types.ts` | Updated type definition |
| `lib/hooks/annotation/workspace/use-workspace-hydration.ts` | Added guard for revision bump |
| `lib/workspace/runtime-manager.ts` | Return counts from `populateRuntimeComponents` |
| `components/annotation-canvas-modern.tsx` | Added prop to interface |
| `components/workspace/annotation-workspace-canvas.tsx` | Pass through prop |
| `components/annotation-app-shell.tsx` | Wired up callback |

## Testing

To verify the fix:
1. Add a timer component to a workspace
2. Let it run for a few seconds
3. Delete the timer
4. Switch to another workspace
5. Switch back to the original workspace
6. **Expected:** App remains responsive, no infinite loop in terminal

## Related Issues

- Component resurrection bug (fixed in 2025-12-02)
- Eviction render loop component loss (fixed in 2025-12-02)
