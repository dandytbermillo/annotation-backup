# Phase 1: Ownership Plumbing Implementation

**Status**: ✅ Implemented
**Date**: 2025-11-27
**Plan Reference**: `note-workspace-live-state-plan.md` Phase 1

## Overview

Implemented Phase 1 ownership plumbing to make `WorkspaceRuntime` the authoritative source of truth for workspace ownership data (`openNotes` and `membership`), preventing stale snapshot overwrites.

## Problem Statement

### Before Phase 1
- `workspaceOpenNotesRef` and `workspaceNoteMembershipRef` were global React refs
- `setWorkspaceOpenNotes` wrote to ref FIRST, then runtime (if enabled)
- `setWorkspaceNoteMembership` wrote to ref FIRST, then runtime (if enabled)
- This created dual sources of truth
- Stale snapshot restores could overwrite current runtime data

### The Stale Overwrite Issue

**Scenario**:
1. User switches to workspace B
2. Snapshot restore calls `setWorkspaceNoteMembership(workspaceB, oldNoteIds)` from a stale snapshot
3. This writes to `workspaceNoteMembershipRef` before runtime exists
4. Later, runtime is created with empty `membership`
5. `getWorkspaceNoteMembership` reads from empty runtime instead of ref
6. **Result**: Workspace membership data lost

## Solution: Runtime-First Writes with Timestamp Tracking

### 1. Enhanced `WorkspaceRuntime` Type

**File**: `lib/workspace/runtime-manager.ts:9-21`

Added timestamp tracking to detect and reject stale writes:

```typescript
export type WorkspaceRuntime = {
  id: string
  dataStore: DataStore
  layerManager: LayerManager
  pendingPanels: Set<string>
  pendingComponents: Set<string>
  status: "idle" | "active" | "paused"
  openNotes: NoteWorkspaceSlot[]
  membership: Set<string>
  // Phase 1: Timestamps to prevent stale overwrites
  openNotesUpdatedAt: number
  membershipUpdatedAt: number
}
```

### 2. Stale Write Rejection Logic

**File**: `lib/workspace/runtime-manager.ts:84-111, 117-144`

Both `setRuntimeOpenNotes` and `setRuntimeMembership` now:

1. Accept optional `timestamp` parameter (defaults to `Date.now()`)
2. Compare write timestamp against current runtime timestamp
3. Reject writes with older timestamps (stale writes)
4. Log warning in dev mode when rejecting stale writes
5. Update timestamp when accepting writes

**Example** (`setRuntimeOpenNotes`):

```typescript
export const setRuntimeOpenNotes = (
  workspaceId: string,
  slots: NoteWorkspaceSlot[],
  timestamp?: number,
) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  const writeTimestamp = timestamp ?? Date.now()

  // Phase 1: Reject stale writes to prevent snapshot overwrites
  if (writeTimestamp < runtime.openNotesUpdatedAt) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Rejected stale openNotes write for workspace ${workspaceId}`,
        {
          attemptedTimestamp: writeTimestamp,
          currentTimestamp: runtime.openNotesUpdatedAt,
          staleness: runtime.openNotesUpdatedAt - writeTimestamp,
          attemptedSlots: slots,
          currentSlots: runtime.openNotes,
        },
      )
    }
    return
  }

  runtime.openNotes = slots
  runtime.openNotesUpdatedAt = writeTimestamp
}
```

### 3. Runtime-First Write Order

**File**: `lib/hooks/annotation/use-note-workspaces.ts:501-546`

Modified `commitWorkspaceOpenNotes` to:

1. Write to runtime FIRST when `liveStateEnabled`
2. Write to ref as backup/legacy fallback
3. Pass timestamp through the call chain

**Before** (❌ wrong order):
```typescript
// Old code - ref first, runtime second
if (changed) {
  workspaceOpenNotesRef.current.set(workspaceId, normalized)  // ❌ Ref first
}
if (liveStateEnabled) {
  setRuntimeOpenNotes(workspaceId, normalized)  // Runtime second
}
```

**After** (✅ correct order):
```typescript
const writeTimestamp = options?.timestamp ?? Date.now()

// Phase 1: Write to runtime FIRST when live state enabled (prevents stale overwrites)
if (liveStateEnabled) {
  setRuntimeOpenNotes(workspaceId, normalized, writeTimestamp)  // ✅ Runtime first
}

// Keep ref in sync as backup/legacy fallback
const previous = workspaceOpenNotesRef.current.get(workspaceId)
const changed = !areWorkspaceSlotsEqual(previous, normalized)
if (changed) {
  workspaceOpenNotesRef.current.set(workspaceId, normalized)  // Ref as backup
}
```

### 4. Updated `setWorkspaceNoteMembership`

**File**: `lib/hooks/annotation/use-note-workspaces.ts:360-431`

Same pattern as `commitWorkspaceOpenNotes`:

1. Added `timestamp` parameter
2. Write to runtime FIRST when `liveStateEnabled`
3. Write to ref as backup
4. Pass timestamp to runtime setter

```typescript
const writeTimestamp = timestamp ?? Date.now()

// Phase 1: Write to runtime FIRST when live state enabled (prevents stale overwrites)
if (liveStateEnabled) {
  setRuntimeMembership(workspaceId, normalized, writeTimestamp)
}

// Keep ref in sync as backup/legacy fallback
// ... ref update logic ...
```

### 5. Dev-Mode Assertions

**File**: `lib/workspace/runtime-manager.ts:25-65`

Added validation in `getWorkspaceRuntime`:

```typescript
// Dev-mode assertion: workspace ID must be valid
if (process.env.NODE_ENV === "development") {
  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
    console.error("[WorkspaceRuntime] Invalid workspace ID:", workspaceId)
    throw new Error(`Invalid workspace ID: ${workspaceId}`)
  }
}

// ... create runtime ...

if (process.env.NODE_ENV === "development") {
  console.log(`[WorkspaceRuntime] Created new runtime for workspace: ${workspaceId}`, {
    totalRuntimes: runtimes.size,
    runtimeIds: Array.from(runtimes.keys()),
  })
}
```

## Files Modified

1. **`lib/workspace/runtime-manager.ts`**:
   - Added `openNotesUpdatedAt` and `membershipUpdatedAt` to `WorkspaceRuntime` type
   - Updated runtime initialization to set initial timestamps
   - Enhanced `setRuntimeOpenNotes` with timestamp tracking and stale write rejection
   - Enhanced `setRuntimeMembership` with timestamp tracking and stale write rejection
   - Added dev-mode assertions in `getWorkspaceRuntime`

2. **`lib/hooks/annotation/use-note-workspaces.ts`**:
   - Modified `commitWorkspaceOpenNotes` to write runtime FIRST, ref SECOND
   - Added `timestamp` parameter to options
   - Modified `setWorkspaceNoteMembership` to write runtime FIRST, ref SECOND
   - Added `timestamp` parameter to function signature
   - Both functions pass timestamp to runtime setters

## How It Works

### Normal Operation (Fresh Write)

```
1. User adds note to workspace B
2. commitWorkspaceOpenNotes(workspaceB, [note1, note2], { timestamp: 1000 })
3. setRuntimeOpenNotes(workspaceB, [note1, note2], 1000)
   - runtime.openNotesUpdatedAt = 0 (initial)
   - writeTimestamp = 1000
   - 1000 >= 0 → Accept write ✅
   - runtime.openNotes = [note1, note2]
   - runtime.openNotesUpdatedAt = 1000
4. workspaceOpenNotesRef.current.set(workspaceB, [note1, note2]) (backup)
```

### Stale Snapshot Overwrite (Prevented)

```
1. Workspace B runtime exists with:
   - runtime.openNotes = [note1, note2]
   - runtime.openNotesUpdatedAt = 1000

2. Stale snapshot restore calls:
   commitWorkspaceOpenNotes(workspaceB, [note1], { timestamp: 500 })

3. setRuntimeOpenNotes(workspaceB, [note1], 500)
   - runtime.openNotesUpdatedAt = 1000 (current)
   - writeTimestamp = 500 (from stale snapshot)
   - 500 < 1000 → Reject write ❌
   - console.warn("[WorkspaceRuntime] Rejected stale openNotes write...")
   - Runtime data unchanged

4. Result: Current data [note1, note2] preserved, stale data [note1] rejected
```

## Validation

### Type-Check Status

Ran `npm run type-check`:
- No new type errors introduced by Phase 1 changes
- Existing type errors in other files are unrelated

### Dev-Mode Warnings

When running with `NOTE_WORKSPACES_LIVE_STATE` enabled, dev console will show:

1. **Runtime creation**:
   ```
   [WorkspaceRuntime] Created new runtime for workspace: workspace-123
   { totalRuntimes: 1, runtimeIds: ['workspace-123'] }
   ```

2. **Stale write rejection** (if it occurs):
   ```
   [WorkspaceRuntime] Rejected stale openNotes write for workspace workspace-123
   {
     attemptedTimestamp: 500,
     currentTimestamp: 1000,
     staleness: 500,
     attemptedSlots: [...],
     currentSlots: [...]
   }
   ```

## Backward Compatibility

1. **When `liveStateEnabled` is false**:
   - Uses ref-based storage (legacy behavior)
   - No runtime writes occur
   - No behavior change

2. **When `liveStateEnabled` is true**:
   - Runtime is primary source
   - Ref is kept in sync as backup
   - Stale writes rejected
   - Data integrity improved

3. **Timestamp parameter is optional**:
   - Existing calls without timestamp still work
   - Defaults to `Date.now()` for current time

## Next Steps (Remaining Plan Phases)

### Phase 2: Keep Inactive Canvases Alive
- Replace "wipe and replay" with visibility toggle
- Refactor snapshot capture/apply to be runtime-scoped
- Pause expensive renders for non-visible runtimes

### Phase 3: Lifecycle Management & Persistence
- Implement LRU eviction (4 desktop / 2 tablet cap)
- Add memory tracking and telemetry
- Serialize least-recently-used workspaces

### Phase 4: Testing & Rollout
- Integration tests for multi-workspace flows
- Telemetry watchdogs with auto-disable
- Gradual rollout with go/no-go criteria

## Acceptance Criteria (Phase 1)

- [x] Runtime owns `openNotes` and `membership` data
- [x] Stale writes rejected based on timestamp
- [x] Runtime writes occur BEFORE ref writes
- [x] Dev-mode assertions catch invalid workspace IDs
- [x] Dev-mode warnings show stale write rejections
- [x] Backward compatible with `liveStateEnabled` flag
- [x] No new type errors introduced

## References

- Plan: `docs/proposal/components/workspace/note/plan/note-workspace-live-state-plan.md`
- Research: `docs/proposal/components/workspace/note/plan/research/live-state/`
- Related Fixes: `note-workspace-live-state-plan-documentation.md` (workspace switching fixes)
