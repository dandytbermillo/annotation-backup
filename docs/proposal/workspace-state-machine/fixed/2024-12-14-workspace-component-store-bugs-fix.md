# Workspace Component Store - Critical Bug Fixes

**Date:** December 14, 2024
**Status:** FIXED
**Affected Components:** Timer, Calculator, StickyNote
**Root Cause:** Phase 5 migration issues in workspace state machine architecture

---

## Executive Summary

Four critical bugs were identified and fixed in the workspace component store system that prevented Timer and Calculator components from functioning correctly. The bugs affected:

1. **State persistence** - Component state was being nested recursively on each save/restore cycle
2. **Timer operation** - Timer self-blocked when starting due to race condition
3. **Component initialization** - New components were not being added to the store
4. **Store population** - Stores existed but remained empty (consequence of Bug 3)

All bugs have been fixed and verified through testing.

---

## Bug 1: State Nesting on Persist/Restore Cycle

### Symptom
After each page reload, component state became increasingly nested:
```json
{
  "state": {
    "state": {
      "state": {
        "state": {
          "minutes": 5,
          "seconds": 0,
          "isRunning": false
        },
        "schemaVersion": 1,
        "isOpaque": false
      },
      "schemaVersion": 1
    }
  }
}
```

### Root Cause
`processComponentStateForRestore()` was being called **twice** during the restore flow:

1. **First call** in `store-runtime-bridge.ts` (`restoreComponentsToWorkspace`):
   ```typescript
   const processedState = processComponentStateForRestore(
     c.type,
     1,
     (c.metadata ?? {}) as Record<string, unknown>,
     restoreType
   )
   return {
     ...
     metadata: processedState,  // BUG: stores {state, schemaVersion, isOpaque}
   }
   ```

2. **Second call** in `workspace-component-store.ts` (`restore` method):
   ```typescript
   const processed = processComponentStateForRestore(
     comp.type,
     incomingSchemaVersion,
     comp.metadata ?? {},  // Already processed! Contains {state, schemaVersion, isOpaque}
     options.restoreType
   )
   nextComponents.set(comp.id, {
     ...
     state: processed.state,  // Double-wrapped!
   })
   ```

The `processComponentStateForRestore` function returns:
```typescript
{ state: Record<string, unknown>, schemaVersion: number, isOpaque: boolean }
```

When the first call stored the **entire return object** as `metadata`, and the second call processed that metadata again, it created nested state.

### Fix Applied

**File:** `lib/workspace/store-runtime-bridge.ts` (lines 218-231)

**Before:**
```typescript
const storeComponents = components
  .filter((c) => c.id && c.type)
  .map((c) => {
    const processedState = processComponentStateForRestore(
      c.type,
      1,
      (c.metadata ?? {}) as Record<string, unknown>,
      restoreType
    )

    return {
      id: c.id,
      type: c.type,
      schemaVersion: 1,
      position: c.position ?? { x: 0, y: 0 },
      size: c.size ?? null,
      zIndex: c.zIndex ?? 100,
      metadata: processedState,
    }
  })
```

**After:**
```typescript
// NOTE: Do NOT call processComponentStateForRestore here - store.restore() handles it.
// Calling it here AND in store.restore() causes state nesting: {state: {state: {...}}}
const storeComponents = components
  .filter((c) => c.id && c.type)
  .map((c) => ({
    id: c.id,
    type: c.type,
    schemaVersion: 1,
    position: c.position ?? { x: 0, y: 0 },
    size: c.size ?? null,
    zIndex: c.zIndex ?? 100,
    metadata: (c.metadata ?? {}) as Record<string, unknown>, // Pass raw metadata
  }))
```

### Verification
After fix, persisted metadata is flat:
```json
{"minutes": 4, "seconds": 3, "isRunning": true, "inputMinutes": "5"}
{"display": "8", "operation": null, "previousValue": null, "waitingForNewValue": false}
```

---

## Bug 2: Timer Self-Blocks in `startTimerOperation`

### Symptom
Clicking "Start" on the Timer did nothing. The timer would not tick.

### Root Cause
In `timer.tsx`, the `handleStart` callback set `isRunning: true` **before** calling `startTimerOperation`:

```typescript
const handleStart = useCallback(() => {
  // Step 1: Sets isRunning: true synchronously
  actions.updateComponentState<TimerState>(componentId, { isRunning: true })

  // Step 2: Calls startTimerOperation which checks isRunning
  actions.startTimerOperation(componentId)
}, ...)
```

In `workspace-component-store.ts`, `startTimerOperation` has a guard:
```typescript
startTimerOperation(componentId: string): void {
  const compState = components.get(componentId)
  if (!compState) return

  // This check fails because isRunning was just set to true!
  if (compState.state.isRunning || activeOperations.has(componentId)) {
    return  // <-- EARLY EXIT - interval never starts!
  }

  // ... interval creation code never reached
}
```

Since `updateComponentState` is **synchronous** (`component.state = { ...component.state, ...patch }`), when `startTimerOperation` checked `compState.state.isRunning`, it was already `true`, causing early return.

**Key insight:** `startTimerOperation` already sets `isRunning: true` internally (line 653) after starting the interval. The component shouldn't set it.

### Fix Applied

**File:** `components/canvas/components/timer.tsx` (lines 156-193)

**Before:**
```typescript
const handleStart = useCallback(() => {
  if (!workspaceId) return

  if (minutes === 0 && seconds === 0) {
    const mins = parseInt(inputMinutes) || 5
    actions.updateComponentState<TimerState>(componentId, {
      minutes: mins,
      seconds: 0,
      isRunning: true,  // BUG: causes self-block
    })
  } else {
    actions.updateComponentState<TimerState>(componentId, { isRunning: true })  // BUG
  }

  actions.startTimerOperation(componentId)
}, [workspaceId, componentId, minutes, seconds, inputMinutes, actions])
```

**After:**
```typescript
const handleStart = useCallback(() => {
  if (!workspaceId) return

  // If timer is at 0:00, reset to input minutes first
  if (minutes === 0 && seconds === 0) {
    const mins = parseInt(inputMinutes) || 5
    actions.updateComponentState<TimerState>(componentId, {
      minutes: mins,
      seconds: 0,
      // NOTE: Don't set isRunning here - startTimerOperation sets it internally.
      // Setting it here causes self-blocking: startTimerOperation checks isRunning
      // and exits early if already true.
    })
  }

  // startTimerOperation sets isRunning: true internally after starting the interval
  actions.startTimerOperation(componentId)
}, [workspaceId, componentId, minutes, seconds, inputMinutes, actions])
```

### Verification
Debug logs show timer starting and ticking:
```
timer_started | workspaceId: 6953461d-e4b0-4a93-83d2-73dd080b5f7b
timer_render_state | storeState: {"minutes": 4, "seconds": 3, "isRunning": true}
timer_render_state | storeState: {"minutes": 4, "seconds": 2, "isRunning": true}
```

---

## Bug 3: New Components Not Added to Store

### Symptom
Newly added Timer and Calculator components did not respond to user interaction. Button clicks did nothing.

### Root Cause
Components used `updateComponentState` to initialize their state:

```typescript
useEffect(() => {
  if (storeState === null) {
    actions.updateComponentState<TimerState>(componentId, initialState)  // Silent failure!
  }
}, ...)
```

However, `updateComponentState` in `workspace-component-store.ts` requires the component to **already exist**:

```typescript
updateComponentState(componentId, update) {
  const component = components.get(componentId)
  if (!component) return  // <-- SILENT EARLY EXIT

  // Update logic never runs for new components
}
```

For new components, the component doesn't exist in the store's `components` Map, so `updateComponentState` silently returns without doing anything. The component should use `addComponent` to create itself first.

### Fix Applied

**Part A: Make `addComponent` idempotent** (prevent accidental overwrites)

**File:** `lib/workspace/workspace-component-store.ts` (lines 252-279)

**Before:**
```typescript
addComponent(componentId: string, component: DurableComponentState): void {
  components.set(componentId, component)
  // ...
}
```

**After:**
```typescript
addComponent(componentId: string, component: DurableComponentState): void {
  // Idempotent: don't overwrite existing components
  if (components.has(componentId)) {
    void debugLog({
      component: 'WorkspaceComponentStore',
      action: 'component_add_skipped',
      metadata: { workspaceId, componentId, reason: 'already_exists' },
    })
    return
  }

  components.set(componentId, component)
  // ...
}
```

**Part B: Components use `addComponent` for initialization**

**File:** `components/canvas/components/timer.tsx` (lines 82-118)

**Before:**
```typescript
useEffect(() => {
  if (!workspaceId) return

  if (storeState === null) {
    const initialState: TimerState = { ... }
    actions.updateComponentState<TimerState>(componentId, initialState)  // Silent failure
  }
}, [workspaceId, componentId, storeState, state, actions])
```

**After:**
```typescript
useEffect(() => {
  if (!workspaceId) return

  if (storeState === null) {
    const initialState: TimerState = {
      minutes: state?.minutes ?? DEFAULT_TIMER_STATE.minutes,
      seconds: state?.seconds ?? DEFAULT_TIMER_STATE.seconds,
      isRunning: false, // Always false for new components
      inputMinutes: state?.inputMinutes ?? String(state?.minutes ?? DEFAULT_TIMER_STATE.inputMinutes),
    }

    // addComponent is idempotent - safe if component already exists
    actions.addComponent(componentId, {
      type: 'timer',
      schemaVersion: 1,
      position: position ?? { x: 0, y: 0 },
      size: null,
      zIndex: 100,
      state: initialState as unknown as Record<string, unknown>,
    })
  }
}, [workspaceId, componentId, storeState, state, actions, position])
```

**Same pattern applied to:**
- `components/canvas/components/calculator.tsx`
- `components/canvas/components/sticky-note.tsx`

### Verification
Calculator button clicks now register:
```
calculator_inputNumber_called | num: "8", workspaceId: 6953461d...
```

Timer has store state:
```
timer_render_state | hasStoreState: true, storeState: {"minutes": 4, ...}
```

---

## Bug 4: Store Never Created (Misdiagnosis)

### Original Hypothesis
The store might not be created for some workspaces.

### Actual Finding
The store **was** being created (via `getWorkspaceComponentStore` which creates if not exists), but it was **empty** because of Bug 3.

When `useComponentState` is called, it triggers `getWorkspaceComponentStore`:
```typescript
const store = useMemo(
  () => (workspaceId ? getWorkspaceComponentStore(workspaceId) : null),
  [workspaceId]
)
```

And `getWorkspaceComponentStore` creates the store if it doesn't exist:
```typescript
export function getWorkspaceComponentStore(workspaceId) {
  let store = stores.get(workspaceId)
  if (!store) {
    store = createWorkspaceComponentStore(workspaceId)
    stores.set(workspaceId, store)
  }
  return store
}
```

### Resolution
No separate fix needed - this was resolved by fixing Bug 3. Once components properly add themselves to the store via `addComponent`, the stores contain components.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/workspace/workspace-component-store.ts` | Made `addComponent` idempotent |
| `lib/workspace/store-runtime-bridge.ts` | Removed duplicate `processComponentStateForRestore` call |
| `components/canvas/components/timer.tsx` | Removed `isRunning: true` from `handleStart`, use `addComponent` for init |
| `components/canvas/components/calculator.tsx` | Use `addComponent` for initialization |
| `components/canvas/components/sticky-note.tsx` | Use `addComponent` for initialization |

---

## Testing Verification

### Test Scenario
1. Created Timer and Calculator in workspace "summary14"
2. Created new workspace "Workspace 2" with Timer and Calculator
3. Started both timers
4. Clicked calculator buttons in both workspaces
5. Switched between workspaces
6. Verified state persisted on switch

### Results

| Test | Result |
|------|--------|
| Timer starts on button click | PASS |
| Timer ticks (seconds decrement) | PASS |
| Calculator buttons update display | PASS |
| State persists on workspace switch | PASS |
| State structure is flat (not nested) | PASS |
| Hot workspace switching preserves running timer | PASS |

### Database Evidence

**Before fix (corrupted nested state):**
```json
{"state": {"state": {"state": {"state": {"minutes": 5, "seconds": 0, ...}}}}}
```

**After fix (flat state):**
```json
{"minutes": 4, "seconds": 3, "isRunning": true, "inputMinutes": "5"}
{"display": "9", "operation": null, "previousValue": null, "waitingForNewValue": false}
```

---

## Lessons Learned

1. **Single responsibility for state processing**: State transformation should happen in exactly one place. Having `processComponentStateForRestore` called in both the bridge and store led to state corruption.

2. **Careful ordering of synchronous operations**: When a guard checks a value that's about to be set, the order matters. `startTimerOperation` checking `isRunning` right after it was synchronously set caused self-blocking.

3. **`updateComponentState` vs `addComponent`**: These have different semantics:
   - `updateComponentState`: Updates existing component (no-op if doesn't exist)
   - `addComponent`: Creates new component entry

   For new components, always use `addComponent` first.

4. **Make idempotent operations idempotent**: `addComponent` should be safe to call multiple times. Adding a guard prevents accidental state overwrites from React re-renders or race conditions.

---

## Related Documentation

- Implementation Plan: `docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md`
- Component Type Registry: `lib/workspace/component-type-registry.ts`
- Store Runtime Bridge: `lib/workspace/store-runtime-bridge.ts`
