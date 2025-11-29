# FIX 7: Extend targetIds with Merged OpenNotes

**Date:** 2025-11-28
**Status:** Implemented and Verified
**File Modified:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 2296-2298)

---

## Problem Description

After FIX 6 was implemented (hot runtime protection for openNotes in `replayWorkspaceSnapshot`), a subtle race condition remained. FIX 6 correctly merged runtime notes with snapshot notes to prevent stale overwrites, but the close loop that ran immediately after would undo this protection.

## Root Cause

In `replayWorkspaceSnapshot`, after committing the merged `openNotesToCommit`, there's a loop that closes notes not in `targetIds`:

```javascript
// Close notes not in target
for (const noteId of currentOpenNotes) {
  if (!targetIds.has(noteId)) {
    await closeNote(noteId)  // This would close notes preserved by FIX 6!
  }
}
```

The `targetIds` set was built from the snapshot's `openNotes`, but FIX 6's merged notes included additional notes from the runtime that weren't in `targetIds`. These preserved notes would be immediately closed by the loop.

### Timeline of the Bug (Before FIX 7)

```
17963ms: FIX 6 merges openNotes: snapshot has 1, runtime has 2 → commits 2 notes ✓
17965ms: Close loop runs with targetIds = {noteA} (from snapshot)
17966ms: Close loop sees noteB not in targetIds → closes noteB ❌
17967ms: User sees only 1 note instead of 2
```

---

## The Fix

### Solution: One-Liner to Extend targetIds

Added a single line after FIX 6's merge logic to ensure all preserved notes are in `targetIds`:

```javascript
// FIX 7: Extend targetIds with merged openNotes to prevent close loop from undoing FIX 6
// This ensures notes preserved by FIX 6 (hot runtime merge) aren't closed by the loop below
openNotesToCommit.forEach(n => targetIds.add(n.noteId))
```

### How It Works

1. FIX 6 creates `openNotesToCommit` with merged notes (snapshot + runtime)
2. FIX 7 adds all merged note IDs to `targetIds`
3. Close loop now correctly skips all preserved notes
4. No more undoing of FIX 6's protection

---

## Verification

After applying FIX 7 alongside FIX 6:
- Notes preserved by FIX 6 remain open
- No more delay in note appearance
- Switching workspaces preserves all notes correctly

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/hooks/annotation/use-note-workspaces.ts` | 2296-2298 | Added FIX 7 one-liner to extend targetIds |

---

## Related Fixes

- **FIX 6** (lines 2249-2278): Hot runtime protection for openNotes (this fix extends it)
- **FIX 8** (lines 2130-2147): Reject empty snapshots in previewWorkspaceFromSnapshot

---

## Lessons Learned

1. **End-to-end thinking**: When adding protection in one place, trace the full code path to ensure nothing undoes it
2. **Minimal fixes**: A single line was enough to complete the protection
3. **Loop invariants matter**: The close loop's `targetIds` set needed to reflect all notes that should stay open

