# Implementation Plan: Pinned Workspace State Persistence (Two-Layer Fix)

**Feature Slug:** `pinned_workspace_persistence`
**Created:** 2024-12-10
**Status:** Planning
**Priority:** High

---

## 1. Problem Statement

### Issue Description
When a user opens a workspace, pins it from the dropdown, then switches to another entry and back, the pinned workspace does NOT preserve its background operations (Timer, Calculator state, etc.).

### Reproduction Steps
1. Open an entry (e.g., "summary14 C")
2. Navigate to a workspace (e.g., "Workspace 2")
3. Start a Timer or add components with state
4. Pin the workspace from the dropdown menu
5. Switch to another entry (e.g., "Home")
6. Switch back to the original entry
7. **Bug**: Timer has reset, component state is lost

### Expected Behavior
Pinned workspaces should preserve their state (Timer continues, components keep state) when switching between entries.

### Working Scenario (for comparison)
If you **pin first, then open** the workspace, state IS preserved. The bug only occurs in the "open first, pin later" order.

---

## 2. Root Cause Analysis

### Investigation Findings

From debug logs at the moment of entry switch:

```
filter_inputs: {
  pinnedWorkspaceIds: ["2334fb09-...", "5fc0e08d-..."],  ← Workspace IS in list
  isEntryActive: false
}

filter_decision: {
  workspaceId: "5fc0e08d-...",
  isPinned: false,  ← BUG: Should be TRUE!
  reason: "not_pinned",
  shouldRender: false
}
```

### Root Cause 1: Stale `pinnedSet` in Filter

In `multi-workspace-canvas-container.tsx`:

```typescript
// Line 93 - pinnedSet computed via useMemo
const pinnedSet = useMemo(() => new Set(pinnedWorkspaceIds ?? []), [pinnedWorkspaceIds])

// Line 117 - isPinned uses pinnedSet
const isPinned = pinnedSet.has(runtime.workspaceId)
```

The `pinnedSet` may be stale due to React's batching behavior. When `isEntryActive` changes, the `canvasesToRender` useMemo might execute before `pinnedSet` is recomputed.

### Root Cause 2: No Runtime Protection

Even if the filter is fixed, the runtime-manager uses LRU eviction:
- If too many workspaces are open, older runtimes get evicted
- Pinned workspaces have no special protection
- A pinned workspace could still lose state due to eviction pressure

---

## 3. Solution: Two-Layer Fix

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 1: Filter Classification                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  MultiWorkspaceCanvasContainer                             │  │
│  │  - Fix: Compute isPinned directly from array               │  │
│  │  - isPinned = pinnedWorkspaceIds?.includes(wsId) ?? false  │  │
│  │  - No reliance on potentially stale pinnedSet              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 2: Runtime Protection                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  RuntimeManager                                            │  │
│  │  - New: Accept pinnedWorkspaceIds parameter                │  │
│  │  - Skip LRU eviction for pinned workspace IDs              │  │
│  │  - Pinned runtimes stay alive regardless of LRU pressure   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits of Two-Layer Approach

| Layer | What It Protects Against |
|-------|-------------------------|
| Layer 1 | Filter misclassification (immediate bug) |
| Layer 2 | LRU eviction (defense-in-depth) |

---

## 4. Layer 1: Fix Filter Classification

### File: `components/workspace/multi-workspace-canvas-container.tsx`

### Current Code (Buggy)

```typescript
// Line 93
const pinnedSet = useMemo(() => new Set(pinnedWorkspaceIds ?? []), [pinnedWorkspaceIds])

// Line 99-169 - canvasesToRender useMemo
const canvasesToRender = useMemo(() => {
  // ...
  const result = hotRuntimes.filter((runtime) => {
    // Line 117
    const isPinned = pinnedSet.has(runtime.workspaceId)  // ← Stale closure risk!
    // ...
  })
}, [hotRuntimes, activeWorkspaceId, isEntryActive, pinnedSet, pinnedWorkspaceIds])
```

### Fixed Code

```typescript
// REMOVE the pinnedSet useMemo entirely - not needed
// const pinnedSet = useMemo(() => new Set(pinnedWorkspaceIds ?? []), [pinnedWorkspaceIds])

// In canvasesToRender useMemo:
const canvasesToRender = useMemo(() => {
  // Create Set INSIDE the memo to ensure fresh computation
  const pinnedSet = new Set(pinnedWorkspaceIds ?? [])

  debugLog({
    component: "MultiWorkspaceCanvas",
    action: "filter_inputs",
    metadata: {
      isEntryActive,
      activeWorkspaceId,
      pinnedWorkspaceIds: pinnedWorkspaceIds ?? [],
      pinnedSetSize: pinnedSet.size,  // Add this for debugging
      pinnedSetContents: Array.from(pinnedSet),  // Add this for debugging
      hotRuntimesCount: hotRuntimes.length,
      hotRuntimeIds: hotRuntimes.map(r => r.workspaceId),
      everRenderedWorkspaces: Array.from(everRenderedWorkspacesRef.current),
    },
  })

  const result = hotRuntimes.filter((runtime) => {
    const hasNotes = runtime.openNotes.length > 0
    const isActiveWorkspace = runtime.workspaceId === activeWorkspaceId
    // FIX: Use the local pinnedSet created inside this memo
    const isPinned = pinnedSet.has(runtime.workspaceId)
    const wasRenderedBefore = everRenderedWorkspacesRef.current.has(runtime.workspaceId)

    // ... rest of filter logic unchanged
  })

  return result
}, [hotRuntimes, activeWorkspaceId, isEntryActive, pinnedWorkspaceIds])  // Remove pinnedSet from deps
```

### Alternative Fix (If Set Performance is Needed)

If the `pinnedWorkspaceIds` array is large and Set performance matters:

```typescript
// Keep pinnedSet but ensure it's always fresh by using pinnedWorkspaceIds directly as fallback
const canvasesToRender = useMemo(() => {
  const result = hotRuntimes.filter((runtime) => {
    // Double-check: use both pinnedSet AND direct array check
    const isPinned = pinnedSet.has(runtime.workspaceId) ||
                     (pinnedWorkspaceIds?.includes(runtime.workspaceId) ?? false)
    // ...
  })
}, [hotRuntimes, activeWorkspaceId, isEntryActive, pinnedSet, pinnedWorkspaceIds])
```

---

## 5. Layer 2: Protect Pinned Runtimes from Eviction

### File: `lib/workspace/runtime-manager.ts`

### Step 5.1: Add Pinned Workspaces State

```typescript
// Add near the top of the file with other state
let pinnedWorkspaceIds: Set<string> = new Set()

/**
 * Update the set of pinned workspace IDs
 * Called when pinned entries state changes
 */
export function updatePinnedWorkspaceIds(ids: string[]): void {
  pinnedWorkspaceIds = new Set(ids)

  void debugLog({
    component: 'RuntimeManager',
    action: 'pinned_workspaces_updated',
    metadata: {
      pinnedCount: pinnedWorkspaceIds.size,
      pinnedIds: ids,
    },
  })
}

/**
 * Check if a workspace is pinned
 */
export function isWorkspacePinned(workspaceId: string): boolean {
  return pinnedWorkspaceIds.has(workspaceId)
}
```

### Step 5.2: Modify LRU Eviction Logic

Find the eviction logic (likely in `enforceRuntimeLimit` or similar function):

```typescript
// BEFORE: Evicts based purely on LRU
function enforceRuntimeLimit(): void {
  if (runtimes.size <= MAX_RUNTIMES) return

  const sortedByAccess = [...runtimes.entries()]
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)

  while (runtimes.size > MAX_RUNTIMES) {
    const [oldestId] = sortedByAccess.shift()!
    evictRuntime(oldestId)  // ← Evicts any runtime, including pinned!
  }
}

// AFTER: Skip pinned workspaces during eviction
function enforceRuntimeLimit(): void {
  if (runtimes.size <= MAX_RUNTIMES) return

  // Sort by last access, but filter out pinned workspaces
  const evictionCandidates = [...runtimes.entries()]
    .filter(([wsId]) => !pinnedWorkspaceIds.has(wsId))  // ← NEW: Exclude pinned
    .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)

  void debugLog({
    component: 'RuntimeManager',
    action: 'eviction_check',
    metadata: {
      totalRuntimes: runtimes.size,
      maxRuntimes: MAX_RUNTIMES,
      pinnedCount: pinnedWorkspaceIds.size,
      evictionCandidatesCount: evictionCandidates.length,
    },
  })

  // Only evict non-pinned runtimes
  while (runtimes.size > MAX_RUNTIMES && evictionCandidates.length > 0) {
    const [oldestId] = evictionCandidates.shift()!

    void debugLog({
      component: 'RuntimeManager',
      action: 'evicting_runtime',
      metadata: {
        workspaceId: oldestId,
        reason: 'lru_limit_exceeded',
        isPinned: false,
      },
    })

    evictRuntime(oldestId)
  }

  // If we still exceed limit but all remaining are pinned, log warning
  if (runtimes.size > MAX_RUNTIMES) {
    void debugLog({
      component: 'RuntimeManager',
      action: 'eviction_blocked',
      metadata: {
        reason: 'all_remaining_runtimes_are_pinned',
        currentCount: runtimes.size,
        maxCount: MAX_RUNTIMES,
        pinnedCount: pinnedWorkspaceIds.size,
      },
    })
  }
}
```

### Step 5.3: Wire Up Pinned State Updates

In `DashboardInitializer.tsx` or `AnnotationAppShell.tsx`, call `updatePinnedWorkspaceIds` when pinned state changes:

```typescript
// In a useEffect that watches pinnedEntriesState
useEffect(() => {
  // Collect all pinned workspace IDs across all pinned entries
  const allPinnedWorkspaceIds = pinnedEntriesState.entries.flatMap(
    entry => entry.pinnedWorkspaceIds
  )

  // Update runtime manager
  updatePinnedWorkspaceIds(allPinnedWorkspaceIds)
}, [pinnedEntriesState.entries])
```

---

## 6. Files to Modify

| File | Layer | Changes |
|------|-------|---------|
| `components/workspace/multi-workspace-canvas-container.tsx` | 1 | Fix `isPinned` computation |
| `lib/workspace/runtime-manager.ts` | 2 | Add pinned protection, modify eviction |
| `components/dashboard/DashboardInitializer.tsx` | 2 | Wire up pinned state to runtime manager |

---

## 7. Testing Plan

### Manual Testing

#### Test Case 1: Open First, Pin Later (The Bug Scenario)
- [ ] Open entry, go to workspace
- [ ] Start a Timer (5 minutes)
- [ ] Pin the workspace from dropdown
- [ ] Switch to another entry
- [ ] Wait 30 seconds
- [ ] Switch back
- [ ] **Expected**: Timer shows ~4:30 remaining (not reset)

#### Test Case 2: Pin First, Open Later (Should Still Work)
- [ ] From dashboard, pin a workspace from dropdown
- [ ] Open that workspace
- [ ] Start a Timer
- [ ] Switch away and back
- [ ] **Expected**: Timer preserved

#### Test Case 3: LRU Pressure with Pinned Workspace
- [ ] Pin a workspace with active Timer
- [ ] Open 10+ other workspaces (to trigger LRU)
- [ ] Switch back to pinned workspace
- [ ] **Expected**: Timer still running (not evicted)

#### Test Case 4: Multiple Pinned Entries
- [ ] Pin Entry A with Workspace 1 (Timer running)
- [ ] Pin Entry B with Workspace 2 (Calculator with value)
- [ ] Switch between Entry A and B multiple times
- [ ] **Expected**: Both preserve state

### Debug Log Verification

```sql
-- Check filter classification is correct
SELECT * FROM debug_logs
WHERE component = 'MultiWorkspaceCanvas'
  AND action = 'filter_decision'
  AND metadata->>'isPinned' = 'false'
  AND metadata->>'workspaceId' IN (
    SELECT jsonb_array_elements_text(metadata->'pinnedWorkspaceIds')
    FROM debug_logs
    WHERE action = 'filter_inputs'
    ORDER BY created_at DESC
    LIMIT 1
  )
ORDER BY created_at DESC;

-- Should return 0 rows after fix (no misclassifications)
```

```sql
-- Check runtime eviction respects pinned
SELECT * FROM debug_logs
WHERE component = 'RuntimeManager'
  AND action IN ('evicting_runtime', 'eviction_blocked')
ORDER BY created_at DESC
LIMIT 20;

-- Pinned workspaces should never appear in 'evicting_runtime'
```

---

## 8. Acceptance Criteria

### Layer 1 (Filter Fix)
- [ ] `isPinned` correctly computed for all pinned workspaces
- [ ] No stale closure issues with `pinnedSet`
- [ ] Debug logs show `isPinned: true` for workspaces in `pinnedWorkspaceIds`

### Layer 2 (Runtime Protection)
- [ ] `updatePinnedWorkspaceIds` function exported from runtime-manager
- [ ] Eviction logic skips pinned workspace IDs
- [ ] Debug logs show `eviction_blocked` when all candidates are pinned

### End-to-End
- [ ] "Open first, pin later" scenario preserves Timer state
- [ ] "Pin first, open later" scenario still works
- [ ] Multiple pinned entries preserve state independently
- [ ] LRU pressure doesn't evict pinned runtimes

---

## 9. Implementation Order

1. **Layer 1 First** - Fix the immediate bug
   - Modify `multi-workspace-canvas-container.tsx`
   - Test the "open first, pin later" scenario

2. **Layer 2 Second** - Add defense-in-depth
   - Add pinned state to `runtime-manager.ts`
   - Modify eviction logic
   - Wire up from `DashboardInitializer.tsx`
   - Test LRU pressure scenarios

3. **Integration Testing** - Verify both layers work together

---

## 10. Rollback Plan

### Layer 1 Rollback
```bash
git checkout HEAD~1 -- components/workspace/multi-workspace-canvas-container.tsx
```

### Layer 2 Rollback
```bash
git checkout HEAD~1 -- lib/workspace/runtime-manager.ts
git checkout HEAD~1 -- components/dashboard/DashboardInitializer.tsx
```

---

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Layer 1 fix causes performance regression | Low | Medium | Use Set inside memo, not array.includes() |
| Layer 2 allows unlimited runtimes | Medium | High | Add MAX_PINNED_RUNTIMES cap |
| Memory leak from never-evicted runtimes | Low | Medium | Unpin when entry is unpinned |

### Safeguard: Maximum Pinned Runtimes

```typescript
const MAX_PINNED_RUNTIMES = 10  // Or from config

function enforceRuntimeLimit(): void {
  // If pinned count exceeds safety limit, warn but don't crash
  if (pinnedWorkspaceIds.size > MAX_PINNED_RUNTIMES) {
    console.warn(`[RuntimeManager] Too many pinned runtimes: ${pinnedWorkspaceIds.size}`)
  }
  // ... rest of eviction logic
}
```

---

## 12. References

- `components/workspace/multi-workspace-canvas-container.tsx` - Layer 1 fix location
- `lib/workspace/runtime-manager.ts` - Layer 2 fix location
- `components/dashboard/DashboardInitializer.tsx` - Wiring location
- `lib/navigation/pinned-entry-manager.ts` - Source of pinned state
- `docs/proposal/components/entry_dashboard/pin/IMPLEMENTATION_PLAN.md` - Related dashboard fix
