# Fix: Prune Transient Mismatch Guard

**Date:** 2025-12-18
**Status:** Implemented
**Issue:** Workspace notes incorrectly pruned during transient render gaps, causing data loss

---

## Problem

The `pruneWorkspaceEntries` function marks notes as "stale" if they exist in the runtime but are not observed on the canvas. During transient windows (cold opens, render delays, visibility changes, snapshot cache gaps), the canvas may report 0 observed notes while the runtime correctly holds N notes.

In this window, the prune logic incorrectly removes all runtime notes as "stale", which then gets persisted as `openNotes: []`, causing permanent data loss.

## Evidence

Debug logs from 2025-12-18 01:49:43 show the exact failure:

```
01:49:43.762 | persist_by_id_start          | open_count: 1    ← Started with 1 note
01:49:43.799 | workspace_prune_stale_notes  | observed: 0, runtime: 1  ← BUG: Pruned!
01:49:43.811 | panel_snapshot_skip_duplicate| panel_count: 0   ← Panels now 0
01:49:43.831 | persist_by_id_used_build_payload | open_count: 0, panel_count: 0 ← Empty!
```

Database confirmed: `Workspace 8 | openNotes: []`

## Root Cause

In `pruneWorkspaceEntries` (lib/hooks/annotation/use-note-workspaces.ts:559-563):

```typescript
runtimeOpenNotes.forEach((slot) => {
  if (slot.noteId && !observedNoteIds.has(slot.noteId)) {
    staleNoteIds.add(slot.noteId)  // Marks as stale if not on canvas
  }
})
```

When `observedNoteIds` is temporarily empty (canvas hasn't rendered), all runtime notes are marked stale.

## Why Existing Guards Didn't Help

1. **lastPendingTimestamp guard** (lines 515-518): Only protects when component/panel pending events have been received. Not set during cold opens or entry switches.

2. **"openNotes=0 but panels>0" durability guard**: Can't catch this because the prune produces BOTH `openNotes=0` AND `panels=0`. By the time this guard checks, both are zero.

## Fix

Added a transient mismatch guard before the prune logic:

```typescript
// TRANSIENT MISMATCH GUARD: If canvas is empty but runtime has notes, skip pruning.
// This can occur during cold opens, render delays, visibility changes, or snapshot cache gaps.
// Pruning here would incorrectly mark runtime notes as "stale" and remove them, causing data loss.
// This is safe because when users intentionally close all notes, closeWorkspaceNote updates
// the runtime immediately (runtimeNoteIds becomes 0), which is caught by the guard above.
if (observedNoteIds.size === 0 && runtimeNoteIds.size > 0) {
  emitDebugLog({
    component: "NoteWorkspace",
    action: "workspace_prune_skipped_transient_mismatch",
    metadata: { workspaceId, reason, observedNoteCount: 0, runtimeOpenCount: runtimeNoteIds.size },
  })
  return false
}
```

## Why This Is Safe

When users intentionally close all notes:
1. `closeWorkspaceNote` updates the runtime immediately
2. `runtimeNoteIds.size` becomes 0
3. The existing guard at lines 519-531 catches this case (`runtimeNoteIds.size === 0`)

The only time `observed=0 && runtime>0` occurs is during transient mismatches where the canvas hasn't caught up to the runtime state.

## File Modified

- `lib/hooks/annotation/use-note-workspaces.ts:533-550` (new guard)

## Validation

- Type-check passes
- New debug log `workspace_prune_skipped_transient_mismatch` will appear when guard triggers
- The bug scenario from 01:49:43 would now be prevented

## Related

- `docs/proposal/workspace-state-machine/fixed/2025-12-16-persisted-empty-open-notes-guard.md` (related but different guard layer)
