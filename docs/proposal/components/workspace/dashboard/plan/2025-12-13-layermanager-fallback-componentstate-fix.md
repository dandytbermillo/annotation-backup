# LayerManager Fallback Missing componentState Fix

**Date:** 2025-12-13
**Status:** Implementation Plan
**Priority:** High
**Related Issue:** Default workspace component state not persisting when other workspaces have only notes

---

## Executive Summary

When the runtime ledger is empty and the canvas falls back to LayerManager for component data, the `componentState` field is not extracted from `node.metadata`. This causes Timer/Calculator components to initialize with DEFAULT values, which then get persisted to the database, resulting in permanent data loss.

---

## Problem Statement

### User Report
> "If the 5 additional workspaces each have their component working in the background like timer or calculator, all workspaces will persist including the default workspace. But if those 5 workspaces have only notes (no components), when switching back the default workspace will not persist."

### Observed Behavior
- Default workspace "summary14" has Timer set to custom time (e.g., 10:00)
- User creates 5 additional workspaces, each with only a note (no components)
- User switches back to summary14
- Timer shows DEFAULT value (5:00) instead of persisted value (10:00)

### Database Evidence
```sql
SELECT name, jsonb_pretty(payload->'components') FROM note_workspaces
WHERE name = 'summary14';
```
Result shows:
- Timer: `minutes: 5, seconds: 0, isRunning: false` (DEFAULT)
- Calculator: `display: "0"` (DEFAULT)

---

## Root Cause Analysis

### Evidence: Debug Logs Confirm Fallback Execution

```sql
SELECT component, action, metadata FROM debug_logs
WHERE action = 'runtime_ledger_fallback_to_layermanager'
ORDER BY created_at DESC LIMIT 10;
```

Output confirms the fallback IS being triggered for summary14:
```
AnnotationCanvas | runtime_ledger_fallback_to_layermanager | {
  "reason": "runtime_ledger_empty_layermanager_has_components",
  "workspaceId": "6953461d-e4b0-4a93-83d2-73dd080b5f7b",  // summary14
  "componentIds": ["component-1765506961578-ggx6dzoma", "component-1765579891789-fx2xnxley"],
  "componentCount": 2,
  "deletedFilteredCount": 0
}
```

### The Bug Location

**File:** `components/annotation-canvas-modern.tsx`
**Lines:** 772-779 (inside the setCanvasItems callback in the LayerManager fallback effect)

```typescript
// CURRENT CODE (BUGGY) - lines 772-779
const nextComponents = nodes.map((node: any) => ({
  id: node.id,
  itemType: "component" as const,
  componentType: (node as any).metadata?.componentType ?? (node as any).type,
  position: node.position ?? { x: 0, y: 0 },
  zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined,
  dimensions: (node as any).dimensions ?? undefined,
  // BUG: componentState is NOT extracted from node.metadata!
}))
```

### Why This Causes Data Loss

1. **Runtime ledger becomes empty** (evicted or not populated due to race condition)
2. **Effect runs** in `annotation-canvas-modern.tsx` (lines 715-785)
3. **Primary path skipped** because `runtimeComponents.length === 0`
4. **Fallback to LayerManager** which has component nodes
5. **Canvas items created WITHOUT `componentState`**
6. **Timer component renders** with `initialState: undefined`
7. **Timer defaults** to `minutes: 5, seconds: 0` (from `state?.minutes ?? 5`)
8. **Timer updates runtime ledger** with DEFAULT values via `useComponentRegistration`
9. **Persistence captures DEFAULT values**

### The Race Condition (Underlying Cause)

```
Timeline:
┌─────────────────────────────────────────────────────────────────┐
│ 1. User switches to summary14                                   │
│ 2. hydrateWorkspace() called (ASYNC - awaits API)              │
│ 3. Canvas renders BEFORE hydration completes                    │
│ 4. Effect runs: runtimeComponents = [] (not yet populated)      │
│ 5. Fallback to LayerManager (MISSING componentState)            │
│ 6. Timer initializes with DEFAULTS                              │
│ 7. Timer updates runtime ledger with DEFAULTS                   │
│ 8. hydrateWorkspace completes (TOO LATE)                        │
│ 9. Persistence saves DEFAULTS to DB                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Fix

### Phase 1: Immediate Fix (This Document)

**File:** `components/annotation-canvas-modern.tsx`
**Lines:** 772-779

```typescript
// BEFORE (BUGGY)
const nextComponents = nodes.map((node: any) => ({
  id: node.id,
  itemType: "component" as const,
  componentType: (node as any).metadata?.componentType ?? (node as any).type,
  position: node.position ?? { x: 0, y: 0 },
  zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined,
  dimensions: (node as any).dimensions ?? undefined,
}))

// AFTER (FIXED)
const nextComponents = nodes.map((node: any) => ({
  id: node.id,
  itemType: "component" as const,
  componentType: (node as any).metadata?.componentType ?? (node as any).type,
  position: node.position ?? { x: 0, y: 0 },
  zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined,
  dimensions: (node as any).dimensions ?? undefined,
  componentState: (node as any).metadata,  // FIX: Extract state from metadata
}))
```

### Exact Diff

```diff
--- a/components/annotation-canvas-modern.tsx
+++ b/components/annotation-canvas-modern.tsx
@@ -776,6 +776,7 @@ export default function ModernAnnotationCanvas({
         position: node.position ?? { x: 0, y: 0 },
         zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined,
         dimensions: (node as any).dimensions ?? undefined,
+        componentState: (node as any).metadata,
       }))
       const byId = new Map<string, any>()
       nextComponents.forEach((c) => byId.set(c.id, c))
```

---

## Safety Analysis

### Risk Assessment Matrix

| Risk | Description | Mitigation | Verdict |
|------|-------------|------------|---------|
| **Extra fields in metadata** | LayerManager metadata includes `componentType` and other fields | Components only read specific fields (`state?.minutes ?? 5`), extra fields ignored | ✅ SAFE |
| **Null/undefined metadata** | `node.metadata` could be null | `componentState: undefined` → Timer uses defaults. Same as current behavior | ✅ SAFE |
| **Type mismatch** | Canvas item type might not accept componentState | Already defined as optional: `componentState?: Record<string, unknown>` | ✅ SAFE |
| **Circular updates** | Timer reads state, updates ledger, triggers re-render | Effect dependencies prevent loop. State unchanged = no re-render | ✅ SAFE |
| **Stale data** | LayerManager might have outdated state | Stale (4:30) is better than default (5:00). Strictly an improvement | ✅ SAFE |
| **Breaking existing code** | Fix might break other components | Only ADDS data, doesn't remove. Non-componentState users ignore it | ✅ SAFE |

### Behavior Comparison

| Scenario | Before Fix | After Fix |
|----------|------------|-----------|
| Fallback triggered, metadata exists | Timer resets to 5:00 ❌ | Timer keeps value ✅ |
| Fallback triggered, metadata null | Timer resets to 5:00 | Timer resets to 5:00 (unchanged) |
| Fallback triggered, metadata corrupted | Timer resets to 5:00 | Timer uses defaults (graceful) |
| Primary path (runtime ledger populated) | Works correctly | Works correctly (unchanged) |
| No components in workspace | No effect | No effect (unchanged) |

### Conclusion: **FIX IS SAFE**

- **Additive change**: Only provides MORE data, never removes anything
- **Graceful degradation**: Null metadata = same as current (defaults)
- **Non-breaking**: Existing code paths completely unchanged
- **Strictly better**: No scenario where fix makes things worse

---

## Implementation Steps

### Step 1: Apply the Fix

Edit `components/annotation-canvas-modern.tsx` lines 778-779.

**Find this code (lines 778-779):**
```typescript
        dimensions: (node as any).dimensions ?? undefined,
      }))
```

**Replace with:**
```typescript
        dimensions: (node as any).dimensions ?? undefined,
        componentState: (node as any).metadata,
      }))
```

**Full context (lines 770-784):**
```typescript
    setCanvasItems((prev: CanvasItem[]) => {
      const nonComponentItems = prev.filter((item: CanvasItem) => item.itemType !== "component")
      const nextComponents = nodes.map((node: any) => ({
        id: node.id,
        itemType: "component" as const,
        componentType: (node as any).metadata?.componentType ?? (node as any).type,
        position: node.position ?? { x: 0, y: 0 },
        zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined,
        dimensions: (node as any).dimensions ?? undefined,
        componentState: (node as any).metadata,  // <-- ADD THIS LINE
      }))
      const byId = new Map<string, any>()
      nextComponents.forEach((c) => byId.set(c.id, c))
      nonComponentItems.forEach((item) => byId.set(item.id, item))
      return Array.from(byId.values())
    })
```

### Step 2: Run Type Check

```bash
npm run type-check
```

Expected: No new type errors (componentState is already optional in CanvasItem type)

### Step 3: Test the Fix

1. Create entry "test-entry" with default workspace
2. Add Timer component, set to 10:00
3. Create 5 additional workspaces with only notes (no components)
4. Switch between workspaces
5. Switch back to default workspace
6. **Verify**: Timer should show 10:00, NOT 5:00

### Step 4: Verify Database

```sql
SELECT name, payload->'components'->0->'metadata'->'minutes' as timer_minutes
FROM note_workspaces
WHERE name LIKE '%test%';
```

Expected: `timer_minutes` should be `10`, not `5`

### Step 5: Check Debug Logs

After fix, the fallback may still trigger (race condition not fixed), but state should be preserved:

```sql
SELECT component, action, metadata FROM debug_logs
WHERE action = 'runtime_ledger_fallback_to_layermanager'
AND created_at > NOW() - INTERVAL '5 minutes';
```

If fallback triggers, verify components still have correct state in UI.

---

## Testing Checklist

### Manual Testing

- [ ] Timer persistence after workspace switches
- [ ] Calculator persistence after workspace switches
- [ ] Timer persistence with 5+ notes-only workspaces
- [ ] Calculator persistence with 5+ notes-only workspaces
- [ ] Timer state survives app reload
- [ ] Calculator state survives app reload
- [ ] Running timer continues after workspace switch and return
- [ ] Paused timer preserves time after workspace switch and return

### Edge Cases

- [ ] Empty workspace (no components) - should not error
- [ ] Workspace with only sticky notes - should not affect
- [ ] Rapid workspace switching - state should be consistent
- [ ] Browser refresh during workspace switch - should recover gracefully

### Regression Testing

- [ ] Existing component creation still works
- [ ] Component deletion still works
- [ ] Component drag/position still persists
- [ ] Component z-index ordering still works
- [ ] Workspace eviction still persists data correctly

---

## Future Work (Out of Scope for This Fix)

### Phase 2: Fix the Race Condition

The underlying issue is that hydration is async and canvas renders before it completes. Future fix:

```typescript
// Option A: Block rendering until hydration completes
const [isHydrating, setIsHydrating] = useState(true)

if (isHydrating) {
  return <CanvasLoadingState />
}
```

### Phase 3: Remove LayerManager Fallback

Once runtime ledger is reliable, remove the fallback entirely:

```typescript
// Remove lines 729-784 in annotation-canvas-modern.tsx
// Runtime ledger becomes the ONLY source of component data
```

### Phase 4: Event-Driven Sync

Replace polling with events for immediate sync:

```typescript
// runtime-manager.ts
export const populateRuntimeComponents = (...) => {
  // ... existing code ...
  runtimeUpdateEmitter.dispatchEvent(new CustomEvent('update', { detail: workspaceId }))
}
```

---

## Files Modified

| File | Change |
|------|--------|
| `components/annotation-canvas-modern.tsx` | Add `componentState` to LayerManager fallback (line 779) |

---

## Rollback Plan

If issues are discovered:

1. Remove the added line: `componentState: (node as any).metadata,`
2. Run `npm run type-check` to verify
3. Restart dev server

The fix is purely additive, so rollback is trivial.

---

## Appendix: Code Context

### Where componentState is Used

**ComponentPanel** (`components/canvas/component-panel.tsx`):
```typescript
<Timer
  componentId={id}
  workspaceId={workspaceId}
  position={renderPosition}
  state={componentState}  // ← This comes from initialState prop
  onStateUpdate={handleStateUpdate}
/>
```

**Timer** (`components/canvas/components/timer.tsx`):
```typescript
const [minutes, setMinutes] = useState<number>(state?.minutes ?? 5)
const [seconds, setSeconds] = useState<number>(state?.seconds ?? 0)
const [isRunning, setIsRunning] = useState<boolean>(state?.isRunning ?? false)
```

### Where LayerManager Stores Metadata

**applyPanelSnapshots** (`lib/hooks/annotation/workspace/use-workspace-snapshot.ts`):
```typescript
const componentMetadata = {
  ...(component.metadata ?? {}),  // Timer state is here
  componentType: component.type,
}
layerMgr.registerNode({
  id: component.id,
  type: "component",
  position: component.position,
  metadata: componentMetadata,  // Stored in LayerManager
})
```

### The Data Flow

```
Persistence (DB)
     ↓
payload.components[].metadata = { minutes: 10, seconds: 30, ... }
     ↓
applyPanelSnapshots()
     ↓
LayerManager.registerNode({ metadata: { minutes: 10, ... } })
     ↓
[FALLBACK PATH - CURRENTLY BROKEN]
     ↓
canvasItem.componentState = node.metadata  // FIX ADDS THIS
     ↓
ComponentPanel initialState={componentState}
     ↓
Timer state={componentState}
     ↓
Timer reads: state?.minutes ?? 5  →  10 (correct!)
```

---

## Sign-off

- [ ] Code review completed
- [ ] Type check passes
- [ ] Manual testing completed
- [ ] Regression testing completed
- [ ] Documentation updated
