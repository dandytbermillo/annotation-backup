# Component Resurrection Bug Fix

**Date:** 2025-12-02
**Status:** Fixed
**Phase:** Phase 4 - Component Runtime Unification

---

## Issue Summary

Deleted components (calculator, timer, etc.) would reappear after:
1. Deleting components in a workspace
2. Switching to another workspace
3. Switching back to the original workspace

The deleted components would "resurrect" and appear on the canvas again.

---

## Root Cause Analysis

### The Problem Flow

1. **User deletes components** in Default Workspace
   - `markComponentDeleted()` adds component IDs to `runtime.deletedComponents` Set
   - `removeRuntimeComponent()` removes components from runtime ledger
   - Runtime ledger becomes empty

2. **User switches to another workspace** then **switches back**
   - Default Workspace is a "hot runtime" (still in memory)
   - Runtime ledger is empty (components were removed)

3. **Hydration attempts to restore components from cache**
   - `hydrate_hot_runtime_component_restore` detects empty runtime ledger
   - Falls back to `lastComponentsSnapshotRef` cache (which still has deleted components)
   - Calls `populateRuntimeComponents()` with cached components

4. **THE BUG: `populateRuntimeComponents()` did NOT check `deletedComponents`**
   - All cached components were added back to the runtime ledger
   - Deleted components resurrected

### Multiple Resurrection Paths Identified

| Path | Location | Status |
|------|----------|--------|
| `buildPayload` LayerManager fallback | `use-note-workspaces.ts` | Fixed earlier |
| `buildPayload` cache fallback | `use-note-workspaces.ts` | Fixed earlier |
| Canvas LayerManager fallback | `annotation-canvas-modern.tsx` | Fixed earlier |
| **`populateRuntimeComponents` hydration** | `runtime-manager.ts` | **THE MISSING FIX** |

---

## The Fix

### File Modified

`lib/workspace/runtime-manager.ts` - `populateRuntimeComponents()` function

### Code Change

```typescript
// BEFORE (lines 1289-1305)
for (const comp of components) {
  if (!comp.id || !comp.type) continue

  const existing = runtime.components.get(comp.id)
  const component: RuntimeComponent = {
    componentId: comp.id,
    componentType: comp.type,
    // ...
  }

  runtime.components.set(comp.id, component)
}

// AFTER (lines 1289-1324)
for (const comp of components) {
  if (!comp.id || !comp.type) continue

  // Phase 4: Skip components that were marked as deleted
  // This prevents resurrection of deleted components during hydration/workspace switch
  if (runtime.deletedComponents.has(comp.id)) {
    skippedDeletedCount++
    void debugLog({
      component: "WorkspaceRuntime",
      action: "populate_skipped_deleted_component",
      metadata: {
        workspaceId,
        componentId: comp.id,
        componentType: comp.type,
      },
    })
    continue  // Skip this component!
  }

  const existing = runtime.components.get(comp.id)
  const component: RuntimeComponent = {
    componentId: comp.id,
    componentType: comp.type,
    // ...
  }

  runtime.components.set(comp.id, component)
  populatedCount++
}
```

### Why This Fix Location

1. **Single point of change** - All callers of `populateRuntimeComponents()` automatically benefit
2. **`deletedComponents` Set persists in runtime** - As long as workspace is hot, deleted tracking remains
3. **Clean separation of concerns** - The function that adds components checks if they should be added
4. **Doesn't break save path** - `buildPayload` reads from runtime ledger; if components are removed, fallbacks kick in (which are already filtered)

---

## All Phase 4 Fixes Applied

### 1. Deleted Component Tracking (`runtime-manager.ts`)

```typescript
// Added to WorkspaceRuntime interface
deletedComponents: Set<string>

// Helper functions added
export const markComponentDeleted = (workspaceId: string, componentId: string): void
export const isComponentDeleted = (workspaceId: string, componentId: string): boolean
export const getDeletedComponents = (workspaceId: string): Set<string>
export const clearDeletedComponents = (workspaceId: string): void
```

### 2. Component Close Handler (`use-component-creation-handler.ts`)

```typescript
const handleComponentClose = useCallback((id: string) => {
  // Phase 4: Mark as deleted FIRST
  if (workspaceKey) {
    markComponentDeleted(workspaceKey, id)
  }
  // Phase 4: Remove from runtime ledger
  if (workspaceKey) {
    removeRuntimeComponent(workspaceKey, id)
  }
  // Phase 4: Remove from LayerManager
  if (layerMgr) {
    try {
      layerMgr.removeNode(id)
    } catch {}
  }
  // Remove from canvas items
  setCanvasItems(prev => prev.filter(item => item.id !== id))
}, [...])
```

### 3. buildPayload Fallbacks (`use-note-workspaces.ts`)

```typescript
// Get deleted components to exclude from fallback
const deletedComponents = getDeletedComponents(workspaceIdForComponents)

// Fallback 1: LayerManager - filter out deleted
components = Array.from(lm.getNodes().values())
  .filter((node: any) => node.type === "component")
  .filter((node: any) => !deletedComponents.has(node.id))  // Phase 4
  .map(...)

// Fallback 2: Cache - filter out deleted
components = cachedComponents.filter((c) => !deletedComponents.has(c.id))  // Phase 4
```

### 4. Canvas LayerManager Fallback (`annotation-canvas-modern.tsx`)

```typescript
// Phase 4: Get deleted components to exclude from fallback resurrection
const deletedComponents = workspaceId ? getDeletedComponents(workspaceId) : new Set<string>()

// Filter out deleted components from LayerManager nodes
const allNodes = Array.from(lm.getNodes().values()).filter((node: any) => node.type === "component")
const nodes = allNodes.filter((node: any) => !deletedComponents.has(node.id))
```

### 5. Clear After Save (`use-note-workspaces.ts`)

```typescript
// After successful save
clearDeletedComponents(workspaceId)
```

### 6. Populate Runtime Components Filter (`runtime-manager.ts`) - **THIS FIX**

```typescript
// Skip components that were marked as deleted
if (runtime.deletedComponents.has(comp.id)) {
  skippedDeletedCount++
  continue
}
```

---

## Verification

### Log Evidence After Fix

```
hydrate_hot_runtime_component_restore:
  source: "lastComponentsSnapshotRef"
  componentCount: 2              ← Cache has 2 components
  runtimeLedgerCount: 0          ← Runtime ledger is empty

populate_skipped_deleted_component: "component-xxx" (timer)      ← SKIPPED!
populate_skipped_deleted_component: "component-yyy" (calculator) ← SKIPPED!

runtime_components_populated:
  requestedCount: 2              ← Tried to populate 2
  populatedCount: 0              ← Actually populated 0!
  skippedDeletedCount: 2         ← Skipped 2 because deleted!
  totalComponents: 0             ← Runtime ledger stays empty
```

### Test Scenario

1. Create note and components (calculator, timer) in Default Workspace
2. Create another workspace with note/component
3. Delete components in Default Workspace
4. Switch to other workspace
5. Switch back to Default Workspace
6. **Expected:** Deleted components do NOT reappear
7. **Result:** PASS - Components stay deleted

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/workspace/runtime-manager.ts` | Added `deletedComponents` Set, helper functions, and filter in `populateRuntimeComponents` |
| `lib/hooks/annotation/use-component-creation-handler.ts` | Updated `handleComponentClose` to mark deleted and remove from LayerManager |
| `lib/hooks/annotation/use-note-workspaces.ts` | Added deleted filtering to buildPayload fallbacks, clear after save |
| `components/annotation-canvas-modern.tsx` | Added deleted filtering to canvas LayerManager fallback |

---

## Related Documents

- `docs/proposal/components/workspace/note/sample-component-runtime-compatibility-plan.md` - Section 2a: Component Removal Contract
