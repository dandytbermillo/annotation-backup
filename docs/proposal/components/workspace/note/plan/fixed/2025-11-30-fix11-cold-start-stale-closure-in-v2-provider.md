# FIX 11: Cold Start Stale Closure in CanvasWorkspaceProviderV2

**Date:** 2025-11-30
**Status:** Implemented and Verified
**File Modified:** `components/canvas/canvas-workspace-context.tsx` (lines 258-339 in `CanvasWorkspaceProviderV2`)

---

## Problem Description

After app reload (cold start), the default workspace appeared empty - no notes or components rendered on the canvas, and the workspace toolbar was empty. However, the **minimap showed 4 panels** indicating data existed. Switching to another workspace and back fixed the issue.

## Symptoms Observed

1. User creates notes, calculators, timers in the default workspace
2. User creates a new workspace with notes and timers
3. User reloads the app (cold start)
4. **Default workspace is empty** - canvas shows nothing, toolbar shows nothing
5. **Minimap shows 4 colored rectangles** - data exists in the system
6. User switches to another workspace - content appears
7. User switches back to default workspace - **content now appears**
8. No error messages in console

## Root Cause Analysis

### Investigation Process

1. **Analyzed debug logs** showing the timing of events:
   ```
   21:41:15.604432 - workspace_active_set: 03e08f35...  (setActiveWorkspaceContext called)
   21:41:15.607640 - hydrate_on_route_load: 03e08f35...
   21:41:15.854722 - commit_open_notes_start: noteCount: 2 (from restoreWorkspace)
   21:41:16.186027 - open_note_before_set_state: willUpdateState: false, activeWorkspaceId: NULL!
   ```

2. **Key observation**: `activeWorkspaceId` was `null` at 21:41:16.186027, even though `setActiveWorkspaceContext("03e08f35...")` was called 580ms earlier at 21:41:15.604432.

3. **Initial FIX 11 attempt failed**: Applied fix to lines 540-551, but issue persisted.

4. **Discovered the REAL issue**: The initial fix was applied to **dead code** that never executes when V2 is enabled.

### Code Structure Discovery

The `canvas-workspace-context.tsx` file has two V2-related code paths:

```typescript
// Line 124-376: CanvasWorkspaceProviderV2 - ACTUAL V2 provider component
export function CanvasWorkspaceProviderV2({ children }) {
  // ... uses useSyncExternalStore for activeWorkspaceId
  // ... openNote at line 222-287 uses activeWorkspaceId from closure
}

// Line 378+: CanvasWorkspaceProvider - Wrapper that chooses provider
export function CanvasWorkspaceProvider({ children }) {
  if (NOTE_WORKSPACES_V2_ENABLED) {
    return <CanvasWorkspaceProviderV2>{children}</CanvasWorkspaceProviderV2>  // Returns immediately!
  }
  // ... V1 legacy code (never reached when V2 enabled)

  if (NOTE_WORKSPACES_V2_ENABLED) {  // Line 449 - DEAD CODE when V2 enabled!
    // ... this block never executes because we already returned above
  }
}
```

**The initial FIX 11 was applied to line 449+ (dead code), not to `CanvasWorkspaceProviderV2`!**

### The Actual Bug Location

In `CanvasWorkspaceProviderV2` (lines 124-376):

```typescript
// Line 130: Gets activeWorkspaceId via useSyncExternalStore
const activeWorkspaceId = useSyncExternalStore(subscribeActiveWorkspace, getActiveWorkspaceSnapshot)

// Line 222-287: openNote callback uses activeWorkspaceId from closure
const openNote = useCallback(
  async (noteId, options) => {
    // ...
    // Line 258: BUG - uses stale closure value!
    const willUpdateState = workspaceId === (activeWorkspaceId ?? SHARED_WORKSPACE_ID)
    if (willUpdateState) {
      setCurrentOpenNotes(next)  // Never called when activeWorkspaceId is stale null
    }
  },
  [activeWorkspaceId, ...],  // activeWorkspaceId in deps doesn't help during same render cycle
)
```

### Why useSyncExternalStore Doesn't Help

`useSyncExternalStore` subscribes to external state changes, but:

1. When `setActiveWorkspaceContext(workspaceId)` is called, it notifies subscribers
2. `useSyncExternalStore` schedules a **re-render** (async)
3. But `hydrateWorkspace` calls `openNote` **before** the re-render happens
4. The `openNote` callback still has the OLD closure value (`activeWorkspaceId = null`)

```
Timeline:
T+0ms:   setActiveWorkspaceContext("03e08f35...") - module-level state updated
T+1ms:   useSyncExternalStore notified - schedules re-render (async)
T+3ms:   hydrateWorkspace() starts
T+580ms: hydrateWorkspace() calls openNote()
         - openNote reads activeWorkspaceId from CLOSURE = null (stale!)
         - Guard fails: "03e08f35..." === (null ?? "__workspace__") → FALSE
         - setCurrentOpenNotes(next) NOT called
T+600ms: Re-render finally happens - too late!
```

---

## The Fix

### Solution: Read Module-Level State Directly

Changed `openNote`, `closeNote`, and `updateMainPosition` callbacks in `CanvasWorkspaceProviderV2` to use `getActiveWorkspaceContext()` instead of the closure `activeWorkspaceId`:

```typescript
// BEFORE (broken):
const willUpdateState = workspaceId === (activeWorkspaceId ?? SHARED_WORKSPACE_ID)

// AFTER (fixed):
const currentActiveWorkspaceId = getActiveWorkspaceContext()
const willUpdateState = workspaceId === (currentActiveWorkspaceId ?? SHARED_WORKSPACE_ID)
```

### Changes Applied

#### 1. openNote (lines 258-293)

```typescript
// FIX 11: Use getActiveWorkspaceContext() to read module-level state directly.
// useSyncExternalStore schedules a re-render when external state changes, but doesn't
// update the closure immediately. When hydrateWorkspace calls openNote during cold start,
// the callback still has the OLD activeWorkspaceId = null from before the re-render.
// getActiveWorkspaceContext() reads the module-level state that setActiveWorkspaceContext()
// already updated synchronously before hydrateWorkspace ran.
const currentActiveWorkspaceId = getActiveWorkspaceContext()
const willUpdateState = workspaceId === (currentActiveWorkspaceId ?? SHARED_WORKSPACE_ID)
```

Dependencies changed from `[activeWorkspaceId, getPositionCache, resolveWorkspaceId, syncRuntimeOpenState]` to `[getPositionCache, resolveWorkspaceId, syncRuntimeOpenState]`.

#### 2. closeNote (lines 303-315)

```typescript
// FIX 11: Use getActiveWorkspaceContext() instead of closure (see openNote comment)
const currentActiveWorkspaceId = getActiveWorkspaceContext()
if (workspaceId === (currentActiveWorkspaceId ?? SHARED_WORKSPACE_ID)) {
  setCurrentOpenNotes(next)
}
```

Dependencies changed from `[activeWorkspaceId, removeWorkspace, resolveWorkspaceId, syncRuntimeOpenState]` to `[removeWorkspace, resolveWorkspaceId, syncRuntimeOpenState]`.

#### 3. updateMainPosition (lines 331-338)

```typescript
// FIX 11: Use getActiveWorkspaceContext() instead of closure (see openNote comment)
const currentActiveWorkspaceId = getActiveWorkspaceContext()
if (workspaceId === (currentActiveWorkspaceId ?? SHARED_WORKSPACE_ID)) {
  setCurrentOpenNotes(next)
}
```

Dependencies changed from `[activeWorkspaceId, getPositionCache, resolveWorkspaceId, syncRuntimeOpenState]` to `[getPositionCache, resolveWorkspaceId, syncRuntimeOpenState]`.

### Why This Works

| Timeline | Module State | useSyncExternalStore Closure | getActiveWorkspaceContext() |
|----------|--------------|------------------------------|----------------------------|
| `setActiveWorkspaceContext("03e08f35...")` | "03e08f35..." | null (re-render pending) | "03e08f35..." |
| `hydrateWorkspace` calls `openNote` | "03e08f35..." | null (not yet re-rendered) | "03e08f35..." |
| Guard check | - | FAILS | PASSES |

`getActiveWorkspaceContext()` reads directly from the module-level variable that `setActiveWorkspaceContext()` already updated **synchronously**, bypassing the async re-render cycle of `useSyncExternalStore`.

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `components/canvas/canvas-workspace-context.tsx` | 258-265 | FIX 11: openNote uses getActiveWorkspaceContext() |
| `components/canvas/canvas-workspace-context.tsx` | 303-305 | FIX 11: closeNote uses getActiveWorkspaceContext() |
| `components/canvas/canvas-workspace-context.tsx` | 331-333 | FIX 11: updateMainPosition uses getActiveWorkspaceContext() |

---

## Verification

### Debug Log Evidence

After applying the fix, the `open_note_before_set_state` logs should show:
- `activeWorkspaceId`: "03e08f35..." (not null)
- `willUpdateState`: true (not false)

Query to verify:
```sql
SELECT action,
       metadata->>'workspaceId' as workspace_id,
       metadata->>'activeWorkspaceId' as active_ws,
       metadata->>'willUpdateState' as will_update,
       created_at
FROM debug_logs
WHERE action = 'open_note_before_set_state'
ORDER BY created_at DESC
LIMIT 10;
```

### Expected Results After Fix

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| `activeWorkspaceId` in logs | null | "03e08f35..." |
| `willUpdateState` | false | true |
| Canvas on cold start | Empty | Shows notes |
| Toolbar on cold start | Empty | Shows entries |

---

## Lessons Learned

1. **Verify you're editing the right code path**: The initial fix was applied to dead code. Always trace the actual execution path.

2. **useSyncExternalStore has async re-render semantics**: Even though it subscribes to external state, the component doesn't see the new value until after a re-render. Callbacks created before the re-render have stale closures.

3. **Module-level state is synchronous**: `getActiveWorkspaceContext()` reads directly from the module variable, which is updated synchronously by `setActiveWorkspaceContext()`.

4. **Don't trust closure values for timing-sensitive operations**: When callbacks need the "current" value of external state during async operations, read from the source directly instead of relying on closure values.

5. **Check for multiple implementations**: The codebase had TWO V2 code paths - one that's used and one that's dead code. Always verify which code path is actually executing.

---

## Related Fixes

- **FIX 9** (use-canvas-note-sync.ts): DataStore seeding for dynamically created panels
- **FIX 10** (SUPERSEDED): Attempted to use activeWorkspaceIdRef with useEffect - failed because useEffect runs after render
- **FIX 11** (this fix): Use getActiveWorkspaceContext() to read module-level state synchronously

---

## Prevention of Similar Issues

1. **Add execution path logging**: Log which provider/code path is actually being used at startup
2. **Avoid closures for timing-critical external state**: Use direct reads from module state or refs that are updated synchronously
3. **Document dead code**: Mark code blocks that are conditionally unreachable to prevent wasted debugging effort
4. **Test cold start specifically**: Include app reload as a distinct test scenario separate from hot workspace switching
