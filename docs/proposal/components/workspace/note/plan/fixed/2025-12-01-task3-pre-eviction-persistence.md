# Task 3: Pre-Eviction Persistence Implementation

**Date:** 2025-12-01
**Status:** Implemented
**Phase:** Phase 3 - Live-State Persistence Plan

---

## Overview

Task 3 ensures that when a workspace runtime is evicted due to LRU capacity limits, the workspace state is persisted before the runtime is removed from memory. This prevents data loss when users open more workspaces than the runtime capacity allows.

---

## Problem Statement

The `RuntimeManager` has a maximum capacity for live workspace runtimes (4 on desktop, 2 on tablet). When this capacity is exceeded, the least recently used (LRU) runtime is evicted. Previously, eviction happened synchronously without persisting the evicted workspace's state, potentially causing data loss.

### The Architectural Challenge

The main challenge was that `getWorkspaceRuntime()` is a **synchronous** function that triggers eviction, but persistence requires **asynchronous** operations. The previous approach had these issues:

1. `getWorkspaceRuntime()` triggers sync eviction via `removeWorkspaceRuntime()`
2. Pre-eviction callbacks need to be async to persist
3. Fire-and-forget callbacks run AFTER runtime deletion, causing them to fail

---

## Solution Architecture

### 1. Fire-and-Forget Callback Pattern

Added a new function `firePreEvictionCallbacksSync()` in `runtime-manager.ts` that:

1. **Captures runtime state synchronously** before any async operations
2. **Stores captured state** in a temporary Map (`capturedEvictionStates`)
3. **Fires callbacks** (fire-and-forget) that can access the captured state
4. **Returns immediately** so sync eviction can proceed
5. Callbacks persist state asynchronously in the background

### 2. Captured Eviction State Storage

```typescript
// Temporary storage for captured runtime state during fire-and-forget eviction
const capturedEvictionStates = new Map<string, {
  state: {
    openNotes: NoteWorkspaceSlot[]
    registeredComponents: Map<string, RegisteredComponent>
    dataStore: DataStore
    layerManager: LayerManager
  }
  capturedAt: number
}>()
```

This storage is accessible via `getCapturedEvictionState(workspaceId)` and auto-clears after 30 seconds.

### 3. Fallback in getWorkspaceOpenNotes

Modified `getWorkspaceOpenNotes()` in `use-note-workspaces.ts` to check for captured eviction state when the runtime returns empty:

```typescript
if (liveStateEnabled) {
  let runtimeSlots = getRuntimeOpenNotes(workspaceId)

  // Phase 3: Fall back to captured eviction state if runtime is empty/deleted
  if (runtimeSlots.length === 0) {
    const capturedState = getCapturedEvictionState(workspaceId)
    if (capturedState && capturedState.openNotes.length > 0) {
      runtimeSlots = capturedState.openNotes
    }
  }
  return runtimeSlots
}
```

---

## Files Modified

### 1. `lib/workspace/runtime-manager.ts`

**Added:**
- `firePreEvictionCallbacksSync()` - Fire-and-forget callback invocation
- `capturedEvictionStates` Map - Temporary state storage
- `getCapturedEvictionState()` - Export for accessing captured state

**Modified:**
- `getWorkspaceRuntime()` - Now calls `firePreEvictionCallbacksSync()` before sync eviction

```typescript
// Phase 3: Fire pre-eviction callbacks (fire-and-forget) to persist dirty state
firePreEvictionCallbacksSync(lruId, "capacity_eviction_sync")

// Remove the LRU runtime
removeWorkspaceRuntime(lruId)
```

### 2. `lib/hooks/annotation/use-note-workspaces.ts`

**Added:**
- Import for `getCapturedEvictionState`
- Pre-eviction callback registration (replaced DISABLED comment)
- Fallback logic in `getWorkspaceOpenNotes()` for captured eviction state

**Pre-eviction callback implementation:**
```typescript
useEffect(() => {
  if (!featureEnabled || !liveStateEnabled) return

  const preEvictionCallback: PreEvictionCallback = async (workspaceId, reason) => {
    // Capture snapshot and persist
    await captureCurrentWorkspaceSnapshot(workspaceId, {
      readinessReason: "pre_eviction_capture",
      skipReadiness: true,
    })

    await persistWorkspaceById(workspaceId, `pre_eviction_${reason}`, {
      skipReadinessCheck: true,
      isBackground: true,
    })
  }

  registerPreEvictionCallback(preEvictionCallback)
  return () => unregisterPreEvictionCallback(preEvictionCallback)
}, [featureEnabled, liveStateEnabled, captureCurrentWorkspaceSnapshot, persistWorkspaceById])
```

---

## Execution Flow

1. **User opens 5th workspace** (exceeds capacity of 4)
2. `getWorkspaceRuntime("workspace-5")` is called
3. System detects capacity exceeded, finds LRU workspace (e.g., "workspace-2")
4. `firePreEvictionCallbacksSync("workspace-2", "capacity_eviction_sync")` is called:
   - Captures `workspace-2` state synchronously
   - Stores in `capturedEvictionStates`
   - Fires pre-eviction callback (fire-and-forget)
5. `removeWorkspaceRuntime("workspace-2")` deletes the runtime
6. New runtime created for `workspace-5`
7. **In background:** Pre-eviction callback continues:
   - Calls `captureCurrentWorkspaceSnapshot("workspace-2")`
   - `getWorkspaceOpenNotes` finds runtime empty, uses `getCapturedEvictionState`
   - Calls `persistWorkspaceById("workspace-2")` to save state

---

## Debug Log Actions

Key debug log actions for troubleshooting:

| Action | Description |
|--------|-------------|
| `pre_eviction_callbacks_fire_and_forget` | Callbacks fired in fire-and-forget mode |
| `pre_eviction_callback_start` | Callback started processing |
| `pre_eviction_callback_complete` | Callback finished (success/failure) |
| `pre_eviction_callback_fire_and_forget_error` | Callback failed |
| `get_open_notes_from_captured_eviction_state` | Used captured state fallback |

---

## Testing Checklist

- [ ] Open 5 workspaces (exceeds capacity of 4)
- [ ] Verify LRU workspace is evicted with `runtime_evicted_for_capacity` log
- [ ] Verify `pre_eviction_callbacks_fire_and_forget` log appears
- [ ] Verify `pre_eviction_callback_complete` with `success: true`
- [ ] Reload app and verify evicted workspace's state was persisted
- [ ] Switch to evicted workspace - notes should be restored from DB

---

## Relationship to Other Tasks

- **Task 1 (persistWorkspaceById):** Used by pre-eviction callback to persist state
- **Task 2 (per-workspace Maps):** Dirty state tracking not yet integrated (Task 4 will use this)
- **Task 4 (Background autosave):** Not yet implemented

---

## Known Limitations

1. **Fire-and-forget timing:** Persistence may not complete before page unload if eviction happens right before user closes tab
2. **30-second cleanup:** Captured eviction state is cleared after 30 seconds; if callback takes longer, state is lost
3. **Snapshot readiness skipped:** We skip waiting for panel readiness during eviction to avoid blocking; some transient state may not be captured

---

## Future Improvements

1. Consider using `beforeunload` to flush pending eviction persistence
2. Track pending eviction callbacks and warn if page closes with incomplete saves
3. Integrate with Task 4 (background autosave) to ensure dirty workspaces are saved before eviction
