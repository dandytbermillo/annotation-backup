# setState During Render Error Fix

**Date:** 2025-12-02
**Status:** Fixed
**Phase:** Phase 4 - Component Runtime Unification

---

## Issue Summary

React error appeared in console:
```
Cannot update a component (`ForwardRef(MultiWorkspaceCanvasContainer)`)
while rendering a different component (`AnnotationAppContent`).
To locate the bad setState() call inside `AnnotationAppContent`,
follow the stack trace as described in https://react.dev/link/setstate-in-render
```

Stack trace pointed to:
```
lib/workspace/runtime-manager.ts (249:7) @ eval
  247 |   runtimeChangeListeners.forEach((listener) => {
  248 |     try {
> 249 |       listener()
      |       ^
  250 |     } catch {

notifyRuntimeChanges
performRuntimeRemoval
lib/workspace/runtime-manager.ts (403:3)
```

---

## Root Cause Analysis

### The Architecture

1. `MultiWorkspaceCanvasContainer` uses React's `useSyncExternalStore` to subscribe to runtime changes:
   ```typescript
   const hotRuntimeIds = useSyncExternalStore(
     subscribeToRuntimeChanges,  // Registers a listener
     getRuntimeSnapshot,          // Returns runtimeVersion
     getRuntimeSnapshot,          // SSR snapshot
   )
   ```

2. `subscribeToRuntimeChanges` adds a listener to `runtimeChangeListeners` Set

3. When `notifyRuntimeChanges()` is called, it:
   - Increments `runtimeVersion`
   - Calls all registered listeners

4. The listener callback triggers React to schedule a re-render

### The Problem

```typescript
// BEFORE (problematic)
export const notifyRuntimeChanges = () => {
  runtimeVersion++

  // Called SYNCHRONOUSLY - this is the problem!
  runtimeChangeListeners.forEach((listener) => {
    try {
      listener()  // ← Triggers React update
    } catch {
      // Ignore listener errors
    }
  })
}
```

**The flow that caused the error:**

1. `AnnotationAppContent` is rendering
2. During render, some code path triggers `performRuntimeRemoval()` (e.g., workspace eviction)
3. `performRuntimeRemoval()` calls `notifyRuntimeChanges()` synchronously
4. `notifyRuntimeChanges()` calls `listener()` synchronously
5. The listener triggers React to update `MultiWorkspaceCanvasContainer`
6. **React error:** Can't setState during another component's render phase

### Trigger Points

From debug logs, `performRuntimeRemoval` was triggered by:
```
evictWorkspaceRuntime (use-note-workspace-runtime-manager.ts:75)
  → ensureRuntimePrepared (use-note-workspace-runtime-manager.ts:124)
    → handleCreateWorkspace / handleSelectWorkspace
```

---

## The Fix

### File Modified

`lib/workspace/runtime-manager.ts` - `notifyRuntimeChanges()` function

### Code Change

```typescript
// AFTER (fixed)

// Track pending notification to batch multiple calls
let notificationPending = false

export const notifyRuntimeChanges = () => {
  // Increment version so useSyncExternalStore detects the change
  // This must happen synchronously so getSnapshot() returns the current value
  runtimeVersion++

  // Defer listener notification to avoid setState-during-render errors
  // When notifyRuntimeChanges() is called during another component's render phase,
  // calling listeners synchronously would trigger React to update subscribed components
  // (via useSyncExternalStore), which violates React's rules.
  // Using queueMicrotask ensures listeners are called after the current execution context.
  if (!notificationPending) {
    notificationPending = true
    queueMicrotask(() => {
      notificationPending = false
      runtimeChangeListeners.forEach((listener) => {
        try {
          listener()
        } catch {
          // Ignore listener errors
        }
      })
    })
  }
}
```

---

## Why This Fix Works

### Key Design Decisions

1. **Version increments synchronously**
   - `runtimeVersion++` happens immediately
   - Any component calling `getRuntimeSnapshot()` during render gets the current value
   - This is critical for `useSyncExternalStore` correctness

2. **Listeners deferred via `queueMicrotask`**
   - `queueMicrotask` schedules execution after the current synchronous code completes
   - This ensures listeners are called outside any render phase
   - React can safely schedule re-renders when listeners fire

3. **Batching optimization**
   - `notificationPending` flag prevents redundant microtasks
   - Multiple rapid calls to `notifyRuntimeChanges()` share one listener notification
   - Reduces overhead without affecting correctness

### Why `queueMicrotask` vs Alternatives

| Option | Timing | Use Case |
|--------|--------|----------|
| `queueMicrotask` | After current task, before next task | Best for this case - fast, outside render |
| `setTimeout(..., 0)` | Next task (after renders) | Too delayed |
| `requestAnimationFrame` | Before next paint | For visual updates, too delayed here |

### How `useSyncExternalStore` Works With This Fix

1. `notifyRuntimeChanges()` is called
2. `runtimeVersion++` (immediate)
3. Current execution continues (no listener call yet)
4. Microtask runs after current task
5. Listeners are called
6. React is notified store changed
7. React calls `getRuntimeSnapshot()`, gets current version
8. If version changed, React re-renders subscribed components

---

## Verification

**Before fix:** Console showed the error when switching workspaces or creating new workspaces.

**After fix:** No error appears. Workspace operations work correctly.

---

## Related Information

### Files That Call `notifyRuntimeChanges()`

The function is called from `performRuntimeRemoval()` at line 403, which is called by:
- `removeWorkspaceRuntime()`
- `removeWorkspaceRuntimeAsync()`

These are triggered during workspace eviction when the runtime capacity is exceeded.

### Components Using `useSyncExternalStore`

- `MultiWorkspaceCanvasContainer` - Subscribes to runtime changes for hot workspace rendering

---

## Standard Pattern Reference

This is a standard pattern for external stores in React. The React documentation recommends that stores be careful about when they notify subscribers to avoid setState-during-render issues. Deferring notifications with `queueMicrotask` is the recommended approach.
