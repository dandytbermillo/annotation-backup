# Phase 4: Unified Dirty Model (Lifecycle-Guarded Dirty Marking)

**Date:** 2025-12-18
**Status:** Complete
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Summary

This phase implements lifecycle guards for dirty-marking to prevent false positives during cold restore
and entry re-entry. The key invariant: **dirty should only be set when the workspace lifecycle is `ready`**.

---

## Problem Solved

### Before (Unguarded Dirty Marking)

Dirty flags could be set at any time, including during:

1. **Cold restore** - Loading DB state into runtime can trigger change handlers that set dirty
2. **Entry re-entry** - Component remount fires useEffect before hydration starts
3. **Placeholder runtime** - Runtime exists but hasn't loaded state yet

This caused several issues:

| Scenario | Problem |
|----------|---------|
| Entry switching | `scheduleSave` fires during remount, sets dirty before revision is known |
| Cold restore | Restoring component state triggers `updateComponentState` which sets dirty |
| Hydration race | `captureCurrentWorkspaceSnapshot` runs before hydration completes |

### After (Lifecycle-Guarded Dirty)

Dirty-marking is now gated by the durability lifecycle state:

```
Only allow dirty when: isWorkspaceLifecycleReady(workspaceId) === true
```

This means:
- **`uninitialized`** → dirty blocked (no meaningful state yet)
- **`restoring`** → dirty blocked (loading from DB, not making new changes)
- **`ready`** → dirty allowed (user is actively modifying state)
- **`persisting`** → dirty allowed (accumulates for next persist cycle)
- **`degraded`** → dirty allowed (still need to track changes for recovery)

---

## What Was Implemented

### 1. Lifecycle-Aware Dirty Guards

**File:** `lib/workspace/durability/dirty-tracking.ts`

| Function | Purpose |
|----------|---------|
| `shouldAllowDirty(workspaceId)` | Check if dirty-marking is allowed (lifecycle is `ready`) |
| `setWorkspaceDirtyIfAllowed(workspaceId, ref, source)` | Set dirty with lifecycle guard (for notes/panels domain) |
| `shouldAllowComponentDirty(workspaceId)` | Check if component dirty-marking is allowed |

```typescript
export function shouldAllowDirty(workspaceId: string): boolean {
  // Only allow dirty-marking when lifecycle is 'ready'
  // This means the workspace has been fully restored from DB
  return isWorkspaceLifecycleReady(workspaceId)
}
```

### 2. Persistence Scheduler Integration

**File:** `lib/hooks/annotation/workspace/use-workspace-persistence.ts`

Added lifecycle guard at the start of `scheduleSave`:

```typescript
const scheduleSave = useCallback((options) => {
  // ... existing early returns ...

  // Phase 4: Check lifecycle guard before marking dirty
  if (!shouldAllowDirty(workspaceId)) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "save_schedule_blocked_lifecycle",
      metadata: { workspaceId, reason, lifecycleNotReady: true },
    })
    return
  }
  // ... rest of scheduleSave
}, [...])
```

This prevents:
- False dirty flags during entry re-entry (before hydration starts)
- Spurious persist attempts when revision is unknown
- "Workspace save failed" toasts from REVISION_MISMATCH errors

### 3. Component Store Integration

**File:** `lib/workspace/workspace-component-store.ts`

Added `shouldMarkDirty()` helper function that checks durability lifecycle:

```typescript
// Phase 4: Lifecycle Guard for Dirty-Marking
const shouldMarkDirty = (): boolean => {
  if (!isWorkspaceLifecycleReady(workspaceId)) {
    void debugLog({
      component: 'WorkspaceComponentStore',
      action: 'dirty_blocked_lifecycle',
      metadata: {
        workspaceId,
        reason: 'durability_lifecycle_not_ready',
        storeLifecycle: lifecycle,
      },
    })
    return false
  }
  return true
}
```

All mutation methods now use this guard before marking dirty:

| Method | Change |
|--------|--------|
| `updateComponentState` | Wrapped `dirtyIds.add()` with `shouldMarkDirty()` |
| `updateComponentPosition` | Wrapped `dirtyIds.add()` with `shouldMarkDirty()` |
| `updateComponentSize` | Wrapped `dirtyIds.add()` with `shouldMarkDirty()` |
| `updateComponentZIndex` | Wrapped `dirtyIds.add()` with `shouldMarkDirty()` |
| `addComponent` | Wrapped `dirtyIds.add()` with `shouldMarkDirty()` |
| `removeComponent` | Wrapped `dirtyIds.add()` with `shouldMarkDirty()` |

**Important:** The state mutation itself still happens (for in-memory consistency), only the
dirty-marking is gated. This is correct because during restore, we want to update component
state but not mark it as "needing to be saved" (it was just loaded from DB).

### 4. Circular Dependency Avoidance

The component store imports `isWorkspaceLifecycleReady` directly from `lifecycle-manager.ts`
instead of the main durability index:

```typescript
// Phase 4: Import lifecycle check directly to avoid circular dependency
// (dirty-tracking.ts imports from workspace-component-store.ts)
import { isWorkspaceLifecycleReady } from './durability/lifecycle-manager'
```

This avoids the circular dependency:
- `workspace-component-store.ts` → `durability/index.ts` → `dirty-tracking.ts` → `workspace-component-store.ts`

---

## Files Modified

| File | Change |
|------|--------|
| `lib/workspace/durability/dirty-tracking.ts` | Added `shouldAllowDirty()`, `setWorkspaceDirtyIfAllowed()`, `shouldAllowComponentDirty()` |
| `lib/workspace/durability/index.ts` | Added exports for new dirty guard functions |
| `lib/hooks/annotation/workspace/use-workspace-persistence.ts` | Added lifecycle guard in `scheduleSave` |
| `lib/workspace/workspace-component-store.ts` | Added `shouldMarkDirty()` helper and wrapped all mutation methods |

---

## Dirty Marking State Machine

```
                           ┌─────────────────────────────────────────┐
                           │        Workspace Lifecycle State        │
                           └─────────────────────────────────────────┘

     uninitialized              restoring                   ready
          │                        │                          │
          v                        v                          v
   ┌──────────────┐         ┌──────────────┐          ┌──────────────┐
   │ dirty BLOCKED│         │ dirty BLOCKED│          │ dirty ALLOWED│
   │              │         │              │          │              │
   │ (no state    │         │ (loading from│          │ (user making │
   │  loaded yet) │         │  DB, not new │          │  real changes│
   │              │         │  changes)    │          │  that need   │
   │              │         │              │          │  persisting) │
   └──────────────┘         └──────────────┘          └──────────────┘
```

---

## Root Cause of Entry Re-entry Issue

**The timing problem (Gap 4 from Phase 0 audit):**

1. User switches entry (annotation → home → annotation)
2. Component **unmounts** → all refs (including `workspaceRevisionRef`) reset
3. Component **remounts** → refs are fresh empty Maps
4. `useEffect` with `currentWorkspaceSummary` fires → `scheduleSave` → would set dirty flag
5. `scheduleSave` timeout hasn't fired yet, but dirty flag is set
6. Eviction triggers (4-cap) and calls persist
7. `workspaceRevisionRef.current.get(workspaceId)` returns `""` (empty)
8. API fails with REVISION_MISMATCH (409) because `""` ≠ actual DB revision
9. Toast appears: "Workspace save failed"

**The fix:** Step 4 now checks `shouldAllowDirty()` which returns `false` because the lifecycle
is still `uninitialized` (not `ready` yet). The dirty flag is never set, so when eviction runs,
there's nothing to persist, and it proceeds cleanly.

---

## Acceptance Criteria

- [x] `shouldAllowDirty()` function created and returns `false` when lifecycle not ready
- [x] `setWorkspaceDirtyIfAllowed()` wraps dirty-setting with lifecycle check
- [x] `shouldAllowComponentDirty()` exported for component store integration
- [x] `scheduleSave` in persistence hook uses lifecycle guard
- [x] All component store mutation methods use lifecycle guard for dirty-marking
- [x] Circular dependency avoided via direct import from `lifecycle-manager.ts`
- [x] Type-check passes
- [x] Debug logging added for blocked dirty operations (for debugging/verification)

---

## Testing Notes

To verify lifecycle-guarded dirty is working:

1. Open dev tools console
2. Navigate to a workspace
3. Switch entry (annotation → home → annotation)
4. Check logs for `dirty_blocked_lifecycle` or `save_schedule_blocked_lifecycle`:
   - These confirm dirty-marking was blocked during the remount window
5. After workspace is ready, make a real change (e.g., move a panel)
6. Verify normal `save_scheduled` logs appear (dirty is allowed now)

**Expected behavior:**
- No "Workspace save failed" toast on entry switching when online
- Timer state still persists correctly across workspace switches (after hydration)
- Components loaded from DB don't immediately trigger persist

---

## Next Steps

**Phase 5:** Persistence Scheduling Uses the Unified Boundary
- Ensure all persistence reasons funnel through guarded boundary
- Add retry/defer logic for blocked persists
- Handle degraded mode recovery

---

## Relationship to Other Phases

| Phase | Status | Dependency |
|-------|--------|------------|
| Phase 0 (Dirty Sources Audit) | Complete | Informed Phase 4 implementation |
| Phase 1 (Durability Boundary) | Complete | Types used by Phase 4 |
| Phase 2 (Unified Guards) | Complete | Guard functions complemented |
| Phase 3 (Unified Restore) | Complete | Lifecycle state used by Phase 4 |
| Phase 4 (Unified Dirty Model) | **Complete** | This document |
| Phase 5 (Scheduling) | Pending | Will use lifecycle + dirty guards |
| Phase 6 (Validation) | Pending | Will verify all phases together |
