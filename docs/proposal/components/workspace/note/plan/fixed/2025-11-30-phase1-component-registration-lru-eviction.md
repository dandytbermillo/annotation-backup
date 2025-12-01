# Phase 1 Completion: Component Registration API & LRU Eviction

**Date:** 2025-11-30
**Status:** Implemented and Verified
**Plan Reference:** `docs/proposal/components/workspace/note/plan/note-workspace-live-state-plan.md`

---

## Summary

Implemented the remaining Phase 1 items from the Note Workspace Live-State Isolation Plan:

1. **Component Registration API** - Calculators, timers, and future widgets can now register/deregister with workspace runtimes
2. **Dev-mode Assertions** - Components without workspaceId throw errors in development mode
3. **MAX_LIVE_WORKSPACES Cap with LRU Eviction** - When exceeding 4 (desktop) or 2 (tablet) live runtimes, the least recently visible runtime is evicted

---

## Files Modified

### 1. `lib/workspace/runtime-manager.ts`

**New Types:**
```typescript
export type RegisteredComponent = {
  componentId: string
  componentType: "calculator" | "timer" | "alarm" | "widget" | string
  workspaceId: string
  registeredAt: number
}
```

**New Constants:**
```typescript
export const MAX_LIVE_WORKSPACES = {
  desktop: 4,
  tablet: 2,
} as const
```

**New WorkspaceRuntime Property:**
```typescript
registeredComponents: Map<string, RegisteredComponent>
```

**New Functions:**
- `registerComponent(workspaceId, componentId, componentType)` - Register a component on mount
- `deregisterComponent(workspaceId, componentId)` - Deregister on unmount
- `getRegisteredComponents(workspaceId)` - List all registered components
- `getRegisteredComponentCount(workspaceId)` - Get count of registered components
- `isComponentRegistered(workspaceId, componentId)` - Check if component is registered
- `evictLRURuntime()` - Manually evict least recently used runtime
- `ensureRuntimeCapacity()` - Check and evict if at capacity
- `getRuntimeCapacityInfo()` - Get current count and max info

**Automatic LRU Eviction:**
Modified `getWorkspaceRuntime()` to automatically evict LRU runtime when creating a new runtime and at capacity:
```typescript
// Phase 3: LRU eviction - ensure we don't exceed MAX_LIVE_WORKSPACES
const maxRuntimes = getMaxLiveRuntimes()
if (runtimes.size >= maxRuntimes) {
  const lruId = getLeastRecentlyVisibleRuntimeId()
  if (lruId) {
    // Log eviction and remove runtime
    removeWorkspaceRuntime(lruId)
  }
}
```

### 2. `lib/hooks/use-component-registration.ts` (NEW)

React hook for easy component registration:

```typescript
export function useComponentRegistration({
  workspaceId,
  componentId,
  componentType,
  strict = process.env.NODE_ENV === "development",
}: UseComponentRegistrationOptions): void
```

Features:
- Automatically registers on mount
- Automatically deregisters on unmount
- Handles workspace changes (deregister from old, register with new)
- Strict mode throws errors if workspaceId is missing (dev only)
- Non-strict mode silently skips registration (for legacy compatibility)

Also exports:
```typescript
export function assertWorkspaceId(
  workspaceId: string | null | undefined,
  componentId: string,
  componentType: string,
): asserts workspaceId is string
```

### 3. `components/canvas/components/calculator.tsx`

Added component registration:
```typescript
import { useComponentRegistration } from '@/lib/hooks/use-component-registration'

interface CalculatorProps {
  componentId: string
  workspaceId?: string | null  // NEW
  state?: any
  onStateUpdate?: (state: any) => void
}

export function Calculator({ componentId, workspaceId, state, onStateUpdate }: CalculatorProps) {
  useComponentRegistration({
    workspaceId,
    componentId,
    componentType: 'calculator',
    strict: false,  // Will be strict: true once all call sites pass workspaceId
  })
  // ...
}
```

### 4. `components/canvas/components/timer.tsx`

Added component registration (same pattern as Calculator):
```typescript
useComponentRegistration({
  workspaceId,
  componentId,
  componentType: 'timer',
  strict: false,
})
```

### 5. `components/canvas/component-panel.tsx`

Added `workspaceId` prop and passes it to child components:
```typescript
interface ComponentPanelProps {
  id: string
  type: ComponentType
  position: { x: number; y: number }
  workspaceId?: string | null  // NEW
  onClose?: (id: string) => void
  onPositionChange?: (id: string, position: { x: number; y: number }) => void
}

// In renderComponent():
case 'calculator':
  return <Calculator componentId={id} workspaceId={workspaceId} ... />
case 'timer':
  return <Timer componentId={id} workspaceId={workspaceId} ... />
```

### 6. `components/annotation-canvas-modern.tsx`

Passes `workspaceId` to ComponentPanel:
```typescript
<ComponentPanel
  key={component.id}
  id={component.id}
  type={component.componentType!}
  position={component.position}
  workspaceId={workspaceId}  // NEW
  onClose={handleComponentClose}
  onPositionChange={handleComponentPositionChange}
/>
```

---

## How It Works

### Component Registration Flow

```
1. ComponentPanel renders Calculator/Timer with workspaceId
2. Calculator/Timer calls useComponentRegistration hook
3. Hook validates workspaceId (throws in dev mode if missing & strict)
4. Hook calls registerComponent(workspaceId, componentId, componentType)
5. Component is added to runtime.registeredComponents Map
6. On unmount, hook calls deregisterComponent to clean up
```

### LRU Eviction Flow

```
1. User switches to a new workspace
2. System calls getWorkspaceRuntime(newWorkspaceId)
3. Runtime doesn't exist, so we check capacity:
   - getMaxLiveRuntimes() returns 4 (desktop) or 2 (tablet)
   - If runtimes.size >= max, we need to evict
4. getLeastRecentlyVisibleRuntimeId() finds the oldest hidden runtime
5. removeWorkspaceRuntime(lruId) removes it:
   - Clears pendingPanels, pendingComponents, openNotes, membership
   - Clears registeredComponents
   - Deletes from runtimes Map
   - Notifies listeners (triggers MultiWorkspaceCanvasContainer re-render)
6. New runtime is created for newWorkspaceId
```

### Telemetry Events

- `component_registered` - When a component registers with a runtime
- `component_deregistered` - When a component deregisters
- `runtime_evicted_for_capacity` - When a runtime is evicted due to MAX_LIVE_WORKSPACES

---

## Verification

### Type-Check
```bash
$ npm run type-check
> tsc --noEmit -p tsconfig.type-check.json
# (No errors)
```

### Expected Dev Console Output

When a component registers:
```
[WorkspaceRuntime] Component registered {
  workspaceId: "abc-123",
  componentId: "calc-456",
  componentType: "calculator",
  totalComponents: 1
}
```

When LRU eviction occurs:
```
[WorkspaceRuntime] Evicting LRU runtime for capacity {
  evictedWorkspaceId: "old-workspace",
  newWorkspaceId: "new-workspace",
  maxRuntimes: 4,
  currentCount: 4
}
```

---

## Migration Notes

### For Existing Components

Components that don't yet receive `workspaceId` will continue to work with `strict: false`. To enable strict mode:

1. Ensure the parent passes `workspaceId` prop
2. Change `strict: false` to `strict: true` (or remove it, as dev mode is default strict)

### For New Components

New widget/component types should:

1. Accept `workspaceId` prop
2. Use `useComponentRegistration` hook with `strict: true`
3. This ensures they're properly associated with workspace runtimes

---

## Plan Completion Status

Per `note-workspace-live-state-plan.md`:

| Phase 1 Item | Status |
|--------------|--------|
| Extend NoteWorkspace runtime model | Done (prior work) |
| WorkspaceRuntimeRegistry | Done (prior work) |
| Update canvas-workspace-context.tsx | Done (prior work) |
| **New component registration API** | **Done (this PR)** |
| **Dev-mode assertions for components** | **Done (this PR)** |
| Guard rails (feature flag) | Done (prior work) |
| Ownership plumbing | Done (prior work) |

| Phase 3 Item | Status |
|--------------|--------|
| **MAX_LIVE_WORKSPACES cap** | **Done (this PR)** |
| **LRU eviction** | **Done (this PR)** |
| Idle eviction telemetry | Done (this PR) |

---

## Related Documentation

- Plan: `docs/proposal/components/workspace/note/plan/note-workspace-live-state-plan.md`
- FIX 11: `docs/proposal/components/workspace/note/plan/fixed/2025-11-30-fix11-cold-start-stale-closure-in-v2-provider.md`
- FIX 12: `docs/proposal/components/workspace/note/plan/fixed/2025-11-30-fix12-empty-noteid-offline-queue-errors.md`
