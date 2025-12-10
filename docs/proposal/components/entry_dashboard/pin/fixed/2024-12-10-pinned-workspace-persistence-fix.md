# Fix: Pinned Workspace State Persistence (Two-Layer Fix)

**Date:** 2024-12-10
**Status:** Implemented
**Files Modified:**
- `components/workspace/multi-workspace-canvas-container.tsx`
- `lib/workspace/runtime-manager.ts`
- `components/dashboard/DashboardInitializer.tsx`

---

## Problem

When a user opens a workspace, pins it, then switches to another entry and back, the pinned workspace does NOT preserve its background operations (Timer state, Calculator values, etc.).

**Reproduction steps:**
1. Open workspace, start Timer
2. Pin workspace from dropdown
3. Switch to another entry
4. Switch back
5. **Bug**: Timer has reset

**Root cause from debug logs:**
```
filter_inputs: { pinnedWorkspaceIds: ["...", "5fc0e08d-..."] }
filter_decision: { workspaceId: "5fc0e08d-...", isPinned: false }  // BUG!
```

The workspace ID was IN the `pinnedWorkspaceIds` array, but `isPinned` was computed as `false`.

---

## Solution: Two-Layer Fix

### Layer 1: Fix Filter Classification

**File:** `components/workspace/multi-workspace-canvas-container.tsx`

**Problem:** `pinnedSet` was a separate `useMemo` that could become stale due to React's batching behavior when `isEntryActive` changes.

**Fix:** Create the Set INSIDE the `canvasesToRender` useMemo to ensure it's always fresh:

```typescript
// BEFORE (buggy)
const pinnedSet = useMemo(() => new Set(pinnedWorkspaceIds ?? []), [pinnedWorkspaceIds])
const canvasesToRender = useMemo(() => {
  const isPinned = pinnedSet.has(runtime.workspaceId)  // Stale!
}, [hotRuntimes, ..., pinnedSet, pinnedWorkspaceIds])

// AFTER (fixed)
const canvasesToRender = useMemo(() => {
  const pinnedSet = new Set(pinnedWorkspaceIds ?? [])  // Always fresh!
  const isPinned = pinnedSet.has(runtime.workspaceId)
}, [hotRuntimes, ..., pinnedWorkspaceIds])
```

### Layer 2: Protect Pinned Runtimes from Eviction

**File:** `lib/workspace/runtime-manager.ts`

**Problem:** Even if Layer 1 is fixed, the RuntimeManager could evict pinned workspaces due to LRU pressure.

**Fix:** Added pinned workspace protection:

```typescript
// New state
let pinnedWorkspaceIds: Set<string> = new Set()

// New exports
export const updatePinnedWorkspaceIds = (ids: string[]) => {
  pinnedWorkspaceIds = new Set(ids)
}

export const isWorkspacePinned = (workspaceId: string) => {
  return pinnedWorkspaceIds.has(workspaceId)
}

// Modified getLeastRecentlyVisibleRuntimeId()
for (const [id, runtime] of runtimes.entries()) {
  // ... existing checks ...

  // Layer 2: Don't evict pinned workspaces
  if (pinnedWorkspaceIds.has(id)) {
    skippedPinnedCount++
    continue
  }
  // ...
}
```

### Layer 3: Wire Up State

**File:** `components/dashboard/DashboardInitializer.tsx`

**Added:** useEffect to sync pinned workspace IDs to RuntimeManager:

```typescript
useEffect(() => {
  const allPinnedWorkspaceIds = pinnedEntriesState.entries.flatMap(
    entry => entry.pinnedWorkspaceIds
  )
  updatePinnedWorkspaceIds(allPinnedWorkspaceIds)
}, [pinnedEntriesState.entries])
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 1: Filter Classification                │
│  MultiWorkspaceCanvasContainer                                   │
│  - pinnedSet created INSIDE useMemo (always fresh)               │
│  - isPinned correctly identifies pinned workspaces               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 2: Runtime Protection                   │
│  RuntimeManager                                                  │
│  - pinnedWorkspaceIds Set tracks all pinned workspaces           │
│  - getLeastRecentlyVisibleRuntimeId() skips pinned workspaces    │
│  - Pinned runtimes survive LRU eviction                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 3: State Wiring                         │
│  DashboardInitializer                                            │
│  - Watches pinnedEntriesState.entries                            │
│  - Syncs all pinned workspace IDs to RuntimeManager              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Verification

- [x] TypeScript compilation passes (`npm run type-check`)
- [ ] Manual test: Open workspace, start Timer, pin, switch away, switch back
- [ ] Manual test: LRU pressure doesn't evict pinned workspaces
- [ ] Debug logs show correct `isPinned` values

---

## Code Changes Summary

### File 1: `components/workspace/multi-workspace-canvas-container.tsx`

**Location:** Lines 96-174

**Change:** Moved `pinnedSet` creation inside the `canvasesToRender` useMemo to fix stale closure issue.

```typescript
// BEFORE (buggy - at line 93, separate useMemo):
const pinnedSet = useMemo(() => new Set(pinnedWorkspaceIds ?? []), [pinnedWorkspaceIds])

// AFTER (fixed - inside canvasesToRender memo at line 101):
const canvasesToRender = useMemo(() => {
  // FIX: Create pinnedSet INSIDE the memo to ensure it's always fresh.
  const pinnedSet = new Set(pinnedWorkspaceIds ?? [])
  // ... rest of filter logic
}, [hotRuntimes, activeWorkspaceId, isEntryActive, pinnedWorkspaceIds])
```

### File 2: `lib/workspace/runtime-manager.ts`

**Location:** Lines 72-122 (new state and exports), Lines 799-838 (modified eviction)

**Changes:**
1. Added `pinnedWorkspaceIds` state (line 79)
2. Added `updatePinnedWorkspaceIds()` export (lines 86-107)
3. Added `isWorkspacePinned()` export (lines 112-114)
4. Added `getPinnedWorkspaceIds()` export (lines 119-121)
5. Modified `getLeastRecentlyVisibleRuntimeId()` to skip pinned workspaces (lines 811-835)

```typescript
// New state (line 79):
let pinnedWorkspaceIds: Set<string> = new Set()

// New function (lines 86-107):
export const updatePinnedWorkspaceIds = (ids: string[]): void => {
  const prevSize = pinnedWorkspaceIds.size
  pinnedWorkspaceIds = new Set(ids)
  // ... logging
}

// Modified eviction (lines 811-815):
// Layer 2: Don't evict pinned workspaces - they should preserve state
if (pinnedWorkspaceIds.has(id)) {
  skippedPinnedCount++
  continue
}
```

### File 3: `components/dashboard/DashboardInitializer.tsx`

**Location:** Lines 32 (import), Lines 91-115 (useEffect)

**Changes:**
1. Added import for `updatePinnedWorkspaceIds` (line 32)
2. Added useEffect to sync pinned workspace IDs to RuntimeManager (lines 91-115)

```typescript
// Import (line 32):
import { updatePinnedWorkspaceIds } from "@/lib/workspace/runtime-manager"

// useEffect (lines 91-115):
useEffect(() => {
  if (!pinnedEntriesEnabled || !pinnedEntriesState.enabled) {
    updatePinnedWorkspaceIds([])
    return
  }
  const allPinnedWorkspaceIds = pinnedEntriesState.entries.flatMap(
    entry => entry.pinnedWorkspaceIds
  )
  updatePinnedWorkspaceIds(allPinnedWorkspaceIds)
  // ... logging
}, [pinnedEntriesEnabled, pinnedEntriesState.enabled, pinnedEntriesState.entries])
```

---

## Debug Log Points

**Layer 1 - Filter:**
```sql
SELECT * FROM debug_logs
WHERE component = 'MultiWorkspaceCanvas'
  AND action = 'filter_inputs'
ORDER BY created_at DESC LIMIT 5;
-- Look for: pinnedSetSize, pinnedSetContents
```

**Layer 2 - Eviction:**
```sql
SELECT * FROM debug_logs
WHERE component = 'WorkspaceRuntime'
  AND action IN ('pinned_workspaces_updated', 'eviction_skipped_pinned')
ORDER BY created_at DESC LIMIT 10;
```

**Layer 3 - Wiring:**
```sql
SELECT * FROM debug_logs
WHERE component = 'DashboardInitializer'
  AND action = 'synced_pinned_workspaces_to_runtime'
ORDER BY created_at DESC LIMIT 5;
```

---

## Related Files

- `docs/proposal/components/entry_dashboard/pin/PINNED_WORKSPACE_PERSISTENCE_PLAN.md` - Original plan
- `docs/proposal/components/entry_dashboard/pin/IMPLEMENTATION_PLAN.md` - Dashboard pin fix
- `docs/proposal/components/entry_dashboard/pin/fixed/2024-12-10-unified-render-list-fix.md` - Related fix
