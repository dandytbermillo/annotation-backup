# Fix: Deleted Notes Reappearing After App Reload

**Date:** 2025-12-11
**Severity:** High
**Status:** Fixed
**Files Modified:**
- `lib/hooks/annotation/use-note-workspaces.ts`
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts`

---

## Symptom

When a user deleted notes from a workspace and then reloaded the app, the deleted notes would reappear. This occurred in two reported workspaces:
- **summary14** - First occurrence (workspace ID: `6953461d-e4b0-4a93-83d2-73dd080b5f7b`)
- **summary15** (default workspace) - Second occurrence (workspace ID: `c5ded2dc-a8a4-4d6b-858e-53f9a1b559ae`)

Even when the user deleted all notes repeatedly, they kept coming back after reload.

---

## Root Cause Analysis

The bug was caused by **multiple entry points** where stale cached data could override the authoritative runtime state and get persisted to the database.

### The Core Problem

In `liveStateEnabled` mode, the **runtime** is supposed to be the single source of truth for which notes are open. However, several code paths were:
1. Reading from stale caches (panel snapshots, membership, fallback caches)
2. Using that stale data to "restore" notes that the user had deleted
3. Persisting this corrupted state to the database
4. On reload, hydrating from the corrupted database state

### Entry Point 1: Stale Panel Cache in `workspaceSnapshotsRef`

When notes are closed/deleted, the `workspaceSnapshotsRef.current` cache was **not** being cleared of those deleted notes' panel data. The merge logic preserved these stale panels.

**Location:** `use-note-workspaces.ts` (panel snapshot update logic)

```typescript
// BEFORE: The merge logic preserves existing panels that aren't in the update set
const existingPanels = workspaceSnapshotsRef.current.get(ownerId)?.panels ?? []
const preservedPanels = existingPanels.filter((panel) => {
  return !updatedNoteIds.has(panel.noteId)  // This preserved closed note panels!
})
```

### Entry Point 2: Stale Fallback Cache in `lastNonEmptySnapshotsRef`

The `lastNonEmptySnapshotsRef` cache serves as a fallback when panel snapshots are empty. This cache retained panels for closed notes and would restore them.

**Location:** `use-note-workspaces.ts` (fallback panel logic)

### Entry Point 3: `snapshotOpenNoteSeed` Re-adding Closed Notes

The `captureCurrentWorkspaceSnapshot` function has logic that detects notes in DataStore panels (`observedNoteIds`) that aren't in the workspace's open notes (`openNoteIds`) and "seeds" them back.

**Location:** `use-note-workspaces.ts` and `use-workspace-snapshot.ts`

**Bug Flow (summary14):**
1. User closes notes (runtime updated to 0 notes)
2. Database persisted with 0 notes ✅
3. User creates a new note
4. `collectPanelSnapshotsFromDataStore()` returns 5 panels (4 stale + 1 new)
5. `missingOpenNotes` = 4 (the closed notes)
6. `snapshotOpenNoteSeed` adds them back! ❌
7. Persist overwrites with 5 notes ❌

### Entry Point 4: `buildPayload_inferred` from Stale Membership

In `buildWorkspacePayload`, there was code that inferred open notes from `workspaceMembership` when runtime returned 0 notes. The membership cache was stale.

**Location:** `use-note-workspaces.ts` (buildPayload function, ~line 2916)

**Bug Flow (summary15):**
1. User deleted notes → runtime openNotes = 0
2. Persist #1 succeeded with `openCount: 0` ✅
3. Another persist triggered (components_changed)
4. `getWorkspaceOpenNotes()` returned 0 notes (correct from runtime)
5. BUT `workspaceMembership` still had 2 notes (stale cache!)
6. Code inferred notes from membership → committed 2 stale notes ❌
7. Persist #2 succeeded with `openCount: 2` ❌ (overwrote good data!)
8. On reload → hydration reads stale 2-note data from database

---

## Bug Timelines (from debug logs)

### summary14 Workspace Timeline

| Timestamp | Event | Data |
|-----------|-------|------|
| 22:51:24.34 | User deletes notes, persist succeeds | `openCount: 0, panelCount: 4` |
| 22:51:24.55 | User creates new note | `noteId: 24666ced...` |
| 22:51:25.73 | `panel_snapshot_merge_existing` | Merges 5 noteIds (4 old + 1 new) |
| 22:51:25.74 | `fix8_rejected_empty_snapshot` | Rejects empty snapshot |
| 22:51:26.79 | `snapshotOpenNoteSeed` | Commits 5 notes via `commitWorkspaceOpenNotes` |
| 22:51:28.78 | Persist overwrites empty state | `openCount: 5` (bug!) |

### summary15 Workspace Timeline

| Timestamp | Event | Data |
|-----------|-------|------|
| 23:11:44.583 | `persist_by_id_start` | `openCount: 0` |
| 23:11:44.620 | `persist_by_id_success` | `openCount: 0` ✅ |
| 23:11:47.171 | `persist_by_id_start` | `openCount: 0` (components_changed) |
| 23:11:47.190 | `get_open_notes_result_live_state` | `noteCount: 0` ✅ |
| 23:11:47.199 | `commit_open_notes_start` | `noteCount: 2, callSite: buildPayload_inferred` ❌ |
| 23:11:47.203 | `openNotes_becoming_populated` | Runtime contaminated! |
| 23:11:47.215 | `persist_by_id_used_build_payload` | `openCount: 2` ❌ |
| 23:11:47.611 | `persist_by_id_success` | `openCount: 2` (overwrote good data!) |

---

## The Fixes

### Fix 1: Filter Fallback Panels

Filter `lastNonEmptySnapshotsRef` fallback panels to only include notes that are still open in runtime.

**File:** `use-note-workspaces.ts` and `use-workspace-panel-snapshots.ts`

```typescript
const rawFallbackPanels = ownerId
  ? getLastNonEmptySnapshot(ownerId, lastNonEmptySnapshotsRef.current, workspaceSnapshotsRef.current)
  : []

// FIX: Filter fallback panels to only include notes that are still open
const currentOpenNotesForFallback = ownerId ? getWorkspaceOpenNotes(ownerId) : []
const currentOpenNoteIdsForFallback = new Set(
  currentOpenNotesForFallback.map((n) => n.noteId).filter((id): id is string => Boolean(id)),
)
const fallbackPanels = rawFallbackPanels.filter((panel) => {
  if (!panel.noteId) return false
  if (!currentOpenNoteIdsForFallback.has(panel.noteId)) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "panel_snapshot_fallback_skipped_closed_note",
      metadata: { workspaceId: ownerId, noteId: panel.noteId, reason: "note_no_longer_open" },
    })
    return false
  }
  return true
})
```

### Fix 2: Filter Merge With Existing Panels

When merging new panels with existing cached panels, filter out panels for notes that are no longer open.

**File:** `use-note-workspaces.ts` and `use-workspace-panel-snapshots.ts`

```typescript
// FIX: Get current open notes to filter out panels for notes that were closed
const currentOpenNotes = getWorkspaceOpenNotes(ownerId)
const currentOpenNoteIds = new Set(
  currentOpenNotes.map((n) => n.noteId).filter((id): id is string => Boolean(id)),
)
const preservedPanels = existingPanels.filter((panel) => {
  if (!panel.noteId) return false
  if (updatedNoteIds.has(panel.noteId)) return false  // Being updated
  // FIX: Don't preserve if this panel's note is no longer open
  if (!currentOpenNoteIds.has(panel.noteId)) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "panel_snapshot_merge_skipped_closed_note",
      metadata: { workspaceId: ownerId, noteId: panel.noteId, reason: "note_no_longer_open" },
    })
    return false
  }
  return true
})
```

### Fix 3: Disable `snapshotOpenNoteSeed` in Live-State Mode

In `liveStateEnabled` mode, don't seed notes from stale DataStore panels. The runtime is authoritative.

**File:** `use-note-workspaces.ts` and `use-workspace-snapshot.ts`

```typescript
// FIX: In live-state mode, runtime is the source of truth for open notes.
// Notes in DataStore panels that aren't in runtime were likely closed.
// Don't seed them back - that would restore deleted notes.
const missingOpenNotes = liveStateEnabled
  ? [] // In live-state mode, runtime is authoritative - don't seed from stale DataStore
  : Array.from(observedNoteIds).filter((noteId) => !openNoteIds.has(noteId))

if (liveStateEnabled && observedNoteIds.size > openNoteIds.size) {
  const skippedNotes = Array.from(observedNoteIds).filter((noteId) => !openNoteIds.has(noteId))
  if (skippedNotes.length > 0) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "snapshot_open_note_seed_skipped_live_state",
      metadata: {
        workspaceId,
        skippedNoteIds: skippedNotes,
        runtimeOpenNoteIds: Array.from(openNoteIds),
        reason: "runtime_is_authoritative_in_live_state",
      },
    })
  }
}
```

### Fix 4: Disable `buildPayload_inferred` in Live-State Mode

In `buildWorkspacePayload`, don't infer open notes from stale `workspaceMembership`. This was the root cause of the summary15 bug.

**File:** `use-note-workspaces.ts` (lines ~2916-2943)

```typescript
let workspaceOpenNotes = getWorkspaceOpenNotes(workspaceIdForComponents)
// FIX: In live-state mode, runtime is the authoritative source of truth for open notes.
// Don't infer from stale membership - that would restore deleted notes.
// Only infer from membership when NOT in live-state mode (legacy fallback).
if (workspaceOpenNotes.length === 0 && workspaceMembership && workspaceMembership.size > 0) {
  if (!liveStateEnabled) {
    const inferredSlots = Array.from(workspaceMembership).map((noteId) => ({
      noteId,
      mainPosition: resolveMainPanelPosition(noteId),
    }))
    workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceIdForComponents, inferredSlots, {
      updateCache: false,
      callSite: "buildPayload_inferred",
    })
  } else {
    // Log that we skipped inference in live-state mode
    emitDebugLog({
      component: "NoteWorkspace",
      action: "build_payload_inferred_skipped_live_state",
      metadata: {
        workspaceId: workspaceIdForComponents,
        membershipSize: workspaceMembership.size,
        membershipNoteIds: Array.from(workspaceMembership),
        reason: "runtime_is_authoritative_in_live_state",
      },
    })
  }
}
```

---

## Verification

### Type-check
```bash
npm run type-check  # Passes
```

### Debug Logs to Monitor

After the fix, you should see these new log actions when the bug would have occurred:

| Log Action | Meaning |
|------------|---------|
| `panel_snapshot_fallback_skipped_closed_note` | Fallback panel filtered out (Fix 1) |
| `panel_snapshot_merge_skipped_closed_note` | Merge panel filtered out (Fix 2) |
| `snapshot_open_note_seed_skipped_live_state` | Seed skipped in live-state mode (Fix 3) |
| `build_payload_inferred_skipped_live_state` | Membership inference skipped (Fix 4) |

### Manual Test Steps

1. Open a workspace with multiple notes
2. Close/delete all notes in the workspace
3. Verify persist log shows `openCount: 0`
4. Wait a few seconds (for any background persists)
5. Reload the app
6. **Expected:** The workspace should be empty (no deleted notes reappearing)

Alternative test:
1. Delete notes, create a new note
2. Reload the app
3. **Expected:** Only the new note should appear, not the deleted ones

---

## Why the Original Design Existed

The `snapshotOpenNoteSeed`, merge logic, and membership inference were originally designed to:

1. **Recover from race conditions** - Where panels render before openNotes is updated
2. **Preserve panel state** - During workspace switches
3. **Handle sync delays** - Where DataStore has panel data but openNotes hasn't synced yet
4. **Legacy fallback** - For non-live-state mode where caches were the source of truth

However, in `liveStateEnabled` mode, the **runtime** is the single source of truth for open notes. The original logic incorrectly treated caches (DataStore panels, membership, fallback snapshots) as authoritative, causing closed notes to be restored.

---

## The Fix Pattern

All four fixes follow the same pattern:

```typescript
if (liveStateEnabled) {
  // Runtime is authoritative - don't use stale cache data
  // Just log that we skipped the legacy fallback
} else {
  // Legacy mode - use cache data as fallback
}
```

This ensures that in live-state mode:
- **Runtime state is never overwritten** by stale cache data
- **Deleted notes stay deleted** because we don't restore from caches
- **Database receives correct data** because buildPayload uses runtime state

---

## Related Files

- `lib/workspace/runtime-manager.ts` - Runtime state management
- `lib/hooks/annotation/workspace/use-workspace-membership.ts` - Open notes management
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts` - Snapshot capture (also fixed)
- `lib/hooks/annotation/workspace/use-workspace-panel-snapshots.ts` - Panel snapshot management

---

## Future Improvements

Consider adding explicit "closed notes" tracking in the runtime to differentiate between:
1. Notes that are legitimately new (should be seeded in legacy mode)
2. Notes that were explicitly closed (should NEVER be seeded)

This would provide a more robust solution than relying on runtime state alone, and would also help with debugging by making the note lifecycle explicit.

---

## Summary of Changes

| Fix | Location | Issue Fixed |
|-----|----------|-------------|
| Fix 1 | Panel fallback logic | Stale panels from `lastNonEmptySnapshotsRef` |
| Fix 2 | Panel merge logic | Stale panels from `workspaceSnapshotsRef` |
| Fix 3 | `captureCurrentWorkspaceSnapshot` | `snapshotOpenNoteSeed` restoring closed notes |
| Fix 4 | `buildWorkspacePayload` | `buildPayload_inferred` using stale membership |
