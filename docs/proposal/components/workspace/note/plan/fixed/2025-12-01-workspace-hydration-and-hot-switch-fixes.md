# Workspace Hydration and HOT Switch Fixes

**Date:** 2025-12-01
**Status:** Fixed
**Files Modified:**
- `lib/hooks/annotation/use-note-workspaces.ts`
- `components/annotation-app-shell.tsx`

---

## Overview

This document describes the investigation and fixes for two related issues in the workspace management system:

1. **Issue #1:** Notes missing when switching back to a previously visited workspace
2. **Issue #2:** All workspaces empty when the app is reloaded

Both issues stemmed from problems in the workspace hydration logic and how the system distinguishes between "HOT" (in-memory) and "COLD" (needs DB load) workspace switches.

---

## Issue #1: Notes Missing When Switching Back to Workspace

### Symptoms
- User creates a note in Workspace A
- User switches to Workspace B
- User switches back to Workspace A
- The note in Workspace A is missing (canvas is empty)

### Root Cause Analysis

The issue had multiple contributing factors:

#### Factor 1: `skipSnapshotForNote` Not Cleared on Workspace Switch

**File:** `components/annotation-app-shell.tsx`

The `skipSnapshotForNote` mechanism was designed to prevent snapshot restoration when clicking on an already-open note tab. However, this value was persisting across workspace switches, causing snapshot restoration to be incorrectly skipped.

**Problem Flow:**
1. User opens note in Workspace A → `skipSnapshotForNote` set to that noteId
2. User switches to Workspace B
3. User switches back to Workspace A
4. `skipSnapshotForNote` still contains the old noteId
5. Snapshot restoration is skipped
6. Note appears as "new" with no panel data

#### Factor 2: `hydrateWorkspace` Called on Every Workspace Switch

**File:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 3455-3505)

The hydration effect was calling `hydrateWorkspace` on every workspace switch, including HOT switches where the runtime already maintained state in memory.

**Problem Flow:**
1. Workspace A has a HOT runtime with notes in memory
2. User switches to Workspace B, then back to Workspace A
3. Effect fires: `hydrateWorkspace(workspaceA)` is called
4. `hydrateWorkspace` calls `updatePanelSnapshotMap` with `allowEmpty: true`
5. This clears panel caches that the HOT runtime was relying on
6. Notes "appear and instantly disappear" as caches are destroyed

### Fix Applied

#### Fix 1: Clear `skipSnapshotForNote` on Workspace Change

**Location:** `components/annotation-app-shell.tsx` (line ~1109)

```typescript
// FIX: Clear skipSnapshotForNote when workspace changes
// The skipSnapshotForNote mechanism is designed for clicking on an already-open note tab
// (to preserve in-memory state), NOT for workspace switches. When switching workspaces,
// we WANT to restore from snapshot. Without this, a stale skipSnapshotForNote value
// from a previous note selection could cause snapshot restoration to be skipped,
// leading to cache mismatch and notes being treated as new (losing their panel data).
useEffect(() => {
  setSkipSnapshotForNote(null)
}, [noteWorkspaceState.currentWorkspaceId])
```

#### Fix 2: Skip Hydration for HOT Runtimes WITH Notes

**Location:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 3471-3494)

```typescript
if (liveStateEnabled && hasWorkspaceRuntime(currentWorkspaceId)) {
  const runtimeOpenNotes = getRuntimeOpenNotes(currentWorkspaceId)
  if (runtimeOpenNotes.length > 0) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "hydrate_skipped_hot_runtime",
      metadata: {
        workspaceId: currentWorkspaceId,
        reason: "workspace_has_hot_runtime_with_notes",
        runtimeNoteCount: runtimeOpenNotes.length,
      },
    })
    return
  }
  // Runtime exists but is empty - fall through to hydration
  emitDebugLog({
    component: "NoteWorkspace",
    action: "hydrate_empty_runtime",
    metadata: {
      workspaceId: currentWorkspaceId,
      reason: "runtime_exists_but_empty_will_hydrate",
    },
  })
}
```

---

## Issue #2: All Workspaces Empty When App is Reloaded

### Symptoms
- User has notes in multiple workspaces
- User reloads the app (F5 or browser refresh)
- All workspaces appear empty
- Database still contains the saved workspace data

### Root Cause Analysis

**File:** `lib/hooks/annotation/use-note-workspaces.ts`

The initial fix for Issue #1 was too aggressive. It checked `hasWorkspaceRuntime(workspaceId)` to skip hydration, but this check returns `true` even for **empty** runtimes that were just created on app startup.

**The RuntimeManager Behavior:**

When any component calls `getWorkspaceRuntime(workspaceId)`, the RuntimeManager creates a new empty runtime if one doesn't exist:

```typescript
// From runtime-manager.ts, getWorkspaceRuntime()
const runtime: WorkspaceRuntime = {
  // ...
  openNotes: [],  // <-- Empty on creation
  // ...
}
runtimes.set(workspaceId, runtime)
```

**Problem Flow on App Reload:**
1. App starts fresh (no runtimes in memory)
2. Component accesses `getWorkspaceRuntime(defaultWorkspaceId)`
3. RuntimeManager creates an **empty** runtime (`openNotes: []`)
4. Hydration effect fires
5. `hasWorkspaceRuntime(defaultWorkspaceId)` returns `true`
6. Original fix: hydration is skipped
7. Workspace stays empty (never loaded from DB)
8. Empty state is saved back to DB (data loss risk)

### Evidence from Debug Logs

```
getHotRuntimesInfo_empty_runtimes |
  workspaceId: "03e08f35-d3cb-41ed-93d3-38a0332ee044", noteCount: 0  ← EMPTY!

hydrate_skipped_hot_runtime | workspaceId: "03e08f35-d3cb-41ed-93d3-38a0332ee044"

persist_by_id_used_build_payload | openCount: 0, panelCount: 0  ← Trying to save empty!

persist_by_id_error | "Failed to save workspace: 412"  ← Revision conflict prevented data loss
```

### Fix Applied

**Location:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 3473-3499)

The fix now checks if the runtime has **actual notes OR components** before skipping hydration:

```typescript
if (liveStateEnabled && hasWorkspaceRuntime(currentWorkspaceId)) {
  const runtimeOpenNotes = getRuntimeOpenNotes(currentWorkspaceId)
  const runtimeComponentCount = getRegisteredComponentCount(currentWorkspaceId)
  // Skip hydration if runtime has notes OR components (either indicates meaningful state)
  if (runtimeOpenNotes.length > 0 || runtimeComponentCount > 0) {
    // Skip hydration - runtime has meaningful state to preserve
    return
  }
  // Runtime exists but is empty (no notes, no components) - fall through to hydration from DB
}
// Continue with hydrateWorkspace(currentWorkspaceId)
```

**Behavior After Fix:**
- **App reload:** Runtime exists but empty (`openNotes: []`, no components) → hydrates from DB ✓
- **Workspace switch (HOT with notes):** Runtime has notes → skips hydration ✓
- **Workspace switch (HOT with components only):** Runtime has components → skips hydration ✓

---

## Summary of All Fixes

### Fix 1: Preserve Fallback Cache During Hydration
**File:** `lib/hooks/annotation/use-note-workspaces.ts` (line ~1098)

Removed deletion of `lastNonEmptySnapshotsRef` during hydration to preserve the fallback cache for panel recovery.

### Fix 2: Generate Main Panel Snapshots from Open Notes
**File:** `lib/hooks/annotation/use-note-workspaces.ts` (lines ~2504-2542)

Added fallback to generate main panel snapshots from `openNotes` when DataStore and cache are empty but notes exist.

### Fix 3: Clear `skipSnapshotForNote` on Workspace Change
**File:** `components/annotation-app-shell.tsx` (line ~1109)

Added `useEffect` to clear `skipSnapshotForNote` when workspace changes to ensure proper snapshot restoration.

### Fix 4: Check Runtime State Before Skipping Hydration
**File:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 3473-3499)

Modified the hydration skip logic to check both notes AND components before skipping:
- `getRuntimeOpenNotes(workspaceId).length > 0` - runtime has notes
- `getRegisteredComponentCount(workspaceId) > 0` - runtime has components (calculator, timer, etc.)

Only skip hydration if the runtime has meaningful state (notes OR components) to preserve. This handles:
- App reload: Empty runtime → hydrates from DB
- HOT switch with notes: Skip hydration, preserve in-memory notes
- HOT switch with components only: Skip hydration, preserve in-memory components

---

## Key Concepts

### HOT vs COLD Workspace Switches

- **HOT Switch:** Workspace has an active runtime in memory with notes. The runtime maintains its own state and doesn't need DB hydration.
- **COLD Switch:** Workspace has no runtime, or runtime is empty. Needs to load state from database via `hydrateWorkspace()`.

### RuntimeManager Behavior

The `RuntimeManager` (`lib/workspace/runtime-manager.ts`) manages workspace runtimes:
- `getWorkspaceRuntime(id)` - Creates empty runtime if none exists
- `hasWorkspaceRuntime(id)` - Returns true if ANY runtime exists (even empty)
- `getRuntimeOpenNotes(id)` - Returns the runtime's open notes array

### Debug Log Actions

Key debug log actions for troubleshooting:
- `hydrate_on_route_load` - Hydration from DB is happening
- `hydrate_skipped_hot_runtime` - Hydration skipped (runtime has notes)
- `hydrate_empty_runtime` - Runtime exists but empty, will hydrate
- `getHotRuntimesInfo_empty_runtimes` - Shows which runtimes are empty

---

## Testing Checklist

- [ ] Create note in Default Workspace
- [ ] Create Workspace A, add note
- [ ] Create Workspace B, add note
- [ ] Switch between workspaces - notes should persist
- [ ] Reload app - all workspaces should have their notes
- [ ] Switch workspaces after reload - notes should persist
