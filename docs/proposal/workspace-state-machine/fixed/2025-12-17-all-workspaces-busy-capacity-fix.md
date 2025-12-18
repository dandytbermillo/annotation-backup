# Fix: Block Workspace Opening When All Candidates Have Active Operations

**Date:** 2025-12-17
**Status:** Implemented and verified
**Related Files:**
- `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:325-341`
- `lib/workspace/runtime-manager.ts:229-236` (new notification function)
- `lib/workspace/eviction-toast.ts:39-48` (new toast message)

---

## Problem

When all workspaces at 4-cap had running timers, switching to a 5th workspace would silently exceed the capacity limit instead of blocking and showing a toast.

**Symptoms:**
- Open 5 workspaces, each with a running timer
- No toast appears
- 5th workspace opens anyway (capacity exceeded silently)

**Root Cause:**
```typescript
// In ensureRuntimePrepared:

// Line 307-322: Try to find eviction candidate
if (!candidate) {
  runtimeIds.forEach((id) => {
    if (getActiveOperationCount(id) > 0) return  // Skip ALL with timers
    // ...
  })
}

// Line 325: Only evict if candidate found
if (candidate) {
  // Eviction logic here
}

// Line 346: ALWAYS creates runtime if not loaded!
if (!hasWorkspaceRuntime(workspaceId)) {
  getWorkspaceRuntime(workspaceId)  // ← Exceeds capacity silently!
}
```

When ALL candidates have active operations:
1. `candidate` stays `null` (no valid candidate found)
2. `if (candidate)` block is skipped (no eviction attempted)
3. Line 346 creates new runtime anyway → capacity exceeded silently
4. No toast shown because eviction was never attempted

---

## Solution

Added explicit check after candidate selection: if no candidate found but at capacity, block workspace opening and show toast.

```typescript
// lib/hooks/annotation/use-note-workspace-runtime-manager.ts:325-341

// FIX: If no candidate found but we're at capacity, block workspace opening
if (!candidate) {
  emitDebugLogRef.current?.({
    component: "NoteWorkspaceRuntime",
    action: "workspace_open_blocked_all_busy",
    metadata: {
      requestedWorkspaceId: workspaceId,
      runtimeCount: runtimeIds.length,
      runtimeCapacity,
      reason: "all_candidates_have_active_operations",
    },
  })
  // Notify UI - all workspaces have running operations
  notifyEvictionBlockedAllBusy(workspaceId, "all_workspaces_busy")
  return { ok: false, blocked: true, blockedWorkspaceId: "" }
}
```

**New notification function:**
```typescript
// lib/workspace/runtime-manager.ts:229-236
export const notifyEvictionBlockedAllBusy = (workspaceId: string, reason: string): void => {
  notifyEvictionBlocked(workspaceId, 0, reason, "active_operations")
}
```

**Updated toast handler:**
```typescript
// lib/workspace/eviction-toast.ts:39-48
// If activeOperationCount is 0, it means ALL workspaces have active operations
if (activeOperationCount === 0) {
  toast({
    title: "All workspaces are busy",
    description: "Cannot open new workspace - all existing workspaces have running operations (e.g., timers). Stop some timers first.",
    variant: "default",
  })
  return
}
```

---

## Behavior Before vs After

| Scenario | Before | After |
|----------|--------|-------|
| 4 workspaces with timers, open 5th | Opens silently (capacity exceeded) | Blocked, "All workspaces are busy" toast |
| 4 workspaces, 1 has timer, open 5th | Timer workspace skipped, clean one evicted | Same (unchanged) |
| 4 clean workspaces, open 5th | LRU evicted silently | Same (unchanged) |

---

## Files Modified

1. `lib/hooks/annotation/use-note-workspace-runtime-manager.ts`
   - Added capacity enforcement check (lines 325-341)
   - Added import for `notifyEvictionBlockedAllBusy`

2. `lib/workspace/runtime-manager.ts`
   - Added `notifyEvictionBlockedAllBusy` function (lines 229-236)

3. `lib/workspace/eviction-toast.ts`
   - Updated `showEvictionBlockedActiveOpsToast` to handle "all busy" scenario (lines 39-48)

---

## Test Verification

1. Open 4 workspaces, start timer in each
2. Try to open 5th workspace
3. **Expected:** "All workspaces are busy" toast appears, 5th workspace does NOT open
4. Stop a timer in one workspace
5. Try to open 5th workspace again
6. **Expected:** Workspace with stopped timer is evicted, 5th opens

---

## Related Issues

This fix closes the capacity enforcement gap that was discovered during hard-safe eviction testing.
