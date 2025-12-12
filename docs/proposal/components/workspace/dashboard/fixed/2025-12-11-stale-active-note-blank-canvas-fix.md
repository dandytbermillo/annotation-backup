# Stale ActiveNoteId Causes Blank Canvas Fix

**Date:** 2025-12-11
**Status:** Fixed
**Severity:** High (Blank canvas after note deletion)

## Summary

Fixed a bug where deleting a note from a workspace caused a blank canvas on reload, while the workspace toolbar still displayed the deleted note's name and ID.

## Symptoms

1. User adds a note to Workspace 2
2. User deletes/closes the note
3. User reloads the app
4. **Result:**
   - Canvas is blank (shows "no notes" placeholder)
   - Workspace toolbar still shows the deleted note's name and ID
   - Clicking the note in toolbar does nothing (note doesn't exist)

## Root Cause Analysis

### Database State Discovery

Querying the `note_workspaces` table revealed:
```json
{
  "openNotes": [],                                          // ✅ CORRECT - empty
  "activeNoteId": "836678cb-7298-4e6a-b89c-07d9a0487c02"   // ❌ BUG - stale
}
```

### The Problem

When a note is closed/deleted from a workspace:
1. ✅ The note is correctly removed from `openNotes[]` array
2. ❌ `activeNoteId` is NOT cleared when the active note is removed

### Code Path Analysis

In `use-workspace-persistence.ts:514`, the `buildPayload()` function directly persisted `activeNoteId` without validation:

```typescript
const payload: NoteWorkspacePayload = {
  openNotes: workspaceOpenNotes.map((note) => { ... }),
  activeNoteId,  // ← Directly used without validation!
  camera: cameraTransform,
  ...
}
```

### Why Existing Logic Didn't Help

There was existing logic in `annotation-app-shell.tsx` (lines 974-977):
```typescript
} else if (activeNoteId && !isFocusedOpen) {
  const fallback = openNotes[0]?.noteId ?? null
  setActiveNoteId(fallback ?? null)
}
```

But this runs in a `useEffect`, which executes AFTER the render cycle. If `buildPayload` was called during the same cycle, the stale `activeNoteId` would already be persisted.

## Solution: Three-Part Fix (Defense in Depth)

### Fix 1: Clear `activeNoteId` at Close Time (Primary Fix)

When a note is closed, immediately clear `activeNoteId` if it was the closed note.

**File Modified:** `lib/hooks/annotation/use-workspace-note-selection.ts`

**Implementation:**
```typescript
const handleCloseNote = useCallback(
  (noteId: string) => {
    if (!noteId) return

    // FIX: Clear activeNoteId immediately when closing the active note.
    if (noteId === activeNoteId) {
      const remainingNotes = openNotes.filter(n => n.noteId !== noteId)
      const nextActiveNote = remainingNotes[0]?.noteId ?? null

      debugLog({
        component: "AnnotationApp",
        action: "clearing_active_note_on_close",
        metadata: {
          closedNoteId: noteId,
          previousActiveNoteId: activeNoteId,
          nextActiveNoteId: nextActiveNote,
          remainingNotesCount: remainingNotes.length,
        },
      })

      setActiveNoteId(nextActiveNote)
    }

    void closeWorkspaceNote(noteId, { persist: false, removeWorkspace: false })
  },
  [activeNoteId, closeWorkspaceNote, debugLog, openNotes, setActiveNoteId],
)
```

### Fix 2: Validate in `buildPayload()` (Safety Net)

Before persisting, validate that `activeNoteId` exists in `openNotes`.

**File Modified:** `lib/hooks/annotation/workspace/use-workspace-persistence.ts`

**Implementation:**
```typescript
// FIX: Validate activeNoteId exists in openNotes before persisting.
const openNoteIds = new Set(workspaceOpenNotes.map(n => n.noteId))
const validatedActiveNoteId = activeNoteId && openNoteIds.has(activeNoteId)
  ? activeNoteId
  : (workspaceOpenNotes[0]?.noteId ?? null)

// Log if we corrected a stale activeNoteId
if (activeNoteId && validatedActiveNoteId !== activeNoteId) {
  emitDebugLog({
    component: "NoteWorkspace",
    action: "build_payload_corrected_stale_active_note",
    metadata: {
      workspaceId: workspaceIdForComponents,
      staleActiveNoteId: activeNoteId,
      correctedActiveNoteId: validatedActiveNoteId,
      openNoteCount: workspaceOpenNotes.length,
      reason: "active_note_not_in_open_notes",
    },
  })
}

const payload: NoteWorkspacePayload = {
  // ...
  activeNoteId: validatedActiveNoteId,  // ← Now validated
  // ...
}
```

### Fix 3: Clear Closed Note from Cache (Critical Fix)

When a note is closed, immediately remove it from `workspaceSnapshotsRef` and `lastNonEmptySnapshotsRef` caches to prevent stale restoration during hot runtime hydration.

**The Real Root Cause:** While Fixes 1 & 2 addressed the `activeNoteId` persistence issue, the bug persisted because the closed note remained in the **in-memory workspace snapshot cache**. During hot runtime hydration (`preview_snapshot_skip_hot_runtime`), this cached snapshot was being replayed, causing the deleted note to reappear briefly before disappearing again.

**Files Modified:**
- `lib/hooks/annotation/use-note-workspaces.ts` - Added `clearClosedNoteFromCache` function
- `lib/hooks/annotation/workspace/workspace-types.ts` - Added type definition
- `lib/hooks/annotation/use-workspace-note-selection.ts` - Added parameter and call in `handleCloseNote`
- `components/annotation-app-shell.tsx` - Wired up the callback

**Implementation:**
```typescript
// use-note-workspaces.ts
const clearClosedNoteFromCache = useCallback(
  (workspaceId: string, noteId: string) => {
    let clearedFromOpenNotes = false
    let clearedFromPanels = false
    let clearedFromNonEmpty = false

    // Clear from workspaceSnapshotsRef.openNotes
    const cached = workspaceSnapshotsRef.current.get(workspaceId)
    if (cached) {
      const filteredOpenNotes = cached.openNotes.filter(n => n.noteId !== noteId)
      if (filteredOpenNotes.length !== cached.openNotes.length) {
        cached.openNotes = filteredOpenNotes
        clearedFromOpenNotes = true
      }

      // Also clear panels for this note
      const filteredPanels = cached.panels.filter(p => p.noteId !== noteId)
      if (filteredPanels.length !== cached.panels.length) {
        cached.panels = filteredPanels
        clearedFromPanels = true
      }
    }

    // Clear from lastNonEmptySnapshotsRef
    const nonEmpty = lastNonEmptySnapshotsRef.current.get(workspaceId)
    if (nonEmpty && nonEmpty.length > 0) {
      const filteredNonEmpty = nonEmpty.filter(p => p.noteId !== noteId)
      if (filteredNonEmpty.length !== nonEmpty.length) {
        lastNonEmptySnapshotsRef.current.set(workspaceId, filteredNonEmpty)
        clearedFromNonEmpty = true
      }
    }

    if (clearedFromOpenNotes || clearedFromPanels || clearedFromNonEmpty) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "cleared_closed_note_from_cache",
        metadata: {
          workspaceId,
          noteId,
          clearedFromOpenNotes,
          clearedFromPanels,
          clearedFromNonEmpty,
          remainingOpenNotes: cached?.openNotes.length ?? 0,
          remainingPanels: cached?.panels.length ?? 0,
        },
      })
    }
  },
  [emitDebugLog],
)

// use-workspace-note-selection.ts - handleCloseNote
// FIX: Clear the closed note from workspace cache to prevent stale restoration
// during hot runtime hydration (same pattern as clearDeletedComponentFromCache).
if (currentWorkspaceId && clearClosedNoteFromCache) {
  clearClosedNoteFromCache(currentWorkspaceId, noteId)
}
```

## Verification

After the fix, expected debug log behavior:

```
clearing_active_note_on_close              → activeNoteId cleared immediately on close
cleared_closed_note_from_cache             → Note removed from workspace snapshot cache (NEW!)
build_payload_corrected_stale_active_note  → Safety net correction (if timing issue)
```

## Safety Analysis

### Fix 1 (Primary - Clear on Close) - SAFE
- Immediate state update prevents race conditions
- Falls back to first remaining note or null
- Logged for debugging

### Fix 2 (Safety Net - Validate in buildPayload) - SAFE
- Backwards compatible: only corrects invalid state
- Self-healing: fixes existing stale data on next save
- Logged when correction occurs

### Fix 3 (Critical - Clear Cache on Close) - SAFE
- Same pattern as `clearDeletedComponentFromCache` for component deletion
- Workspace-scoped: only affects specific workspace cache
- Null-safe: returns early if no cache entry
- Logged when clearing occurs
- **This is the critical fix**: prevents stale cache from replaying during hot runtime hydration

### Defense in Depth Benefits
| Scenario | Fix 1 Only | Fix 2 Only | Fix 3 Only | All Three |
|----------|-----------|-----------|-----------|-----------|
| Normal close | ✅ | ✅ | ✅ | ✅ |
| Race condition | ❌ might miss | ✅ | ✅ | ✅ |
| Direct DB manipulation | ❌ | ✅ | ❌ | ✅ |
| Bug in close logic | ❌ | ✅ | ❌ | ✅ |
| Existing stale data | ❌ | ✅ | ❌ | ✅ |
| Hot runtime hydration | ❌ | ❌ | ✅ | ✅ |
| Stale in-memory cache | ❌ | ❌ | ✅ | ✅ |

- Fix 2 also repairs **existing stale data** in the database on next save.
- Fix 3 prevents **stale in-memory cache** from causing note resurrection during hot runtime hydration.

## Files Changed Summary

| File | Change |
|------|--------|
| `lib/hooks/annotation/use-workspace-note-selection.ts` | Added immediate `activeNoteId` clearing + cache clearing call in `handleCloseNote` |
| `lib/hooks/annotation/workspace/use-workspace-persistence.ts` | Added validation in `buildPayload()` |
| `lib/hooks/annotation/use-note-workspaces.ts` | Added `clearClosedNoteFromCache` function |
| `lib/hooks/annotation/workspace/workspace-types.ts` | Added `clearClosedNoteFromCache` type definition |
| `components/annotation-app-shell.tsx` | Wired up `clearClosedNoteFromCache` callback |

## Testing

To verify the fix:
1. Add a note to a workspace
2. Close/delete the note
3. Reload the app
4. **Expected:** Canvas shows "no notes" placeholder correctly, toolbar is empty

## Verification Evidence

### Debug Logs After Fix

The following debug logs confirm the fix is working:

```
AnnotationApp | clearing_active_note_on_close     | {
  "closedNoteId": "98a380f1-fcf4-4e9e-84ef-fb9936f30d20",
  "nextActiveNoteId": null,
  "remainingNotesCount": 0,
  "previousActiveNoteId": "98a380f1-fcf4-4e9e-84ef-fb9936f30d20"
}

NoteWorkspace | cleared_closed_note_from_cache    | {
  "noteId": "98a380f1-fcf4-4e9e-84ef-fb9936f30d20",
  "workspaceId": "167d6b28-e98c-446f-8cfd-671c25626bc6",
  "workspaceName": "Workspace 2",
  "remainingPanels": 0,
  "clearedFromPanels": true,
  "remainingOpenNotes": 0,
  "clearedFromNonEmpty": true,
  "clearedFromOpenNotes": true
}

NoteWorkspace | preview_snapshot_skip_hot_runtime | {
  "workspaceId": "167d6b28-e98c-446f-8cfd-671c25626bc6",
  "workspaceName": "Workspace 2",
  "panelsInSnapshot": 0,        ← Cache cleared!
  "openNotesInSnapshot": 0,     ← No stale notes!
  "componentsInSnapshot": 0,
  "runtimeComponentCount": 0
}
```

### Database State After Fix

```sql
SELECT id, name, payload->>'openNotes', payload->>'activeNoteId'
FROM note_workspaces WHERE name = 'Workspace 2';

-- Result:
-- 167d6b28-e98c-446f-8cfd-671c25626bc6 | Workspace 2 | [] | (null)
```

Both `openNotes` and `activeNoteId` are correctly empty after note closure.

### Before vs After Comparison

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| `openNotesInSnapshot` | 1 (stale) | 0 (correct) |
| `panelsInSnapshot` | 1 (stale) | 0 (correct) |
| DB `activeNoteId` | stale UUID | null |
| Cache cleared on close | ❌ | ✅ |
| Toolbar after reload | Shows deleted note | Empty (correct) |

## Investigation Timeline

### Initial Analysis (Fixes 1 & 2)

1. **Problem identified**: Stale `activeNoteId` in database after note deletion
2. **Fix 1 implemented**: Clear `activeNoteId` immediately in `handleCloseNote`
3. **Fix 2 implemented**: Validate `activeNoteId` in `buildPayload()` before persistence

### Bug Persisted - Deeper Analysis

After implementing Fixes 1 & 2, testing revealed the bug still occurred. Debug log analysis showed:

```
preview_snapshot_skip_hot_runtime | openNotesInSnapshot: 1  ← Still stale!
```

The logs showed that while `activeNoteId` was being corrected (Fix 1 & 2 working), the **in-memory workspace snapshot cache** still contained the deleted note. This cached data was being replayed during hot runtime hydration.

### Root Cause Discovery

The actual root cause was multi-layered:

1. **Layer 1 (Fixed by Fix 1 & 2)**: `activeNoteId` not cleared on close
2. **Layer 2 (Fixed by Fix 3)**: `workspaceSnapshotsRef` cache not cleared on close

The workspace system maintains in-memory caches for performance:
- `workspaceSnapshotsRef` - cached workspace snapshots
- `lastNonEmptySnapshotsRef` - last known non-empty panel state

When switching workspaces (hot runtime path), these caches are used to restore state without hitting the database. If the closed note remained in these caches, it would be restored during the next workspace switch, causing the brief "ghost" appearance before disappearing.

### Pattern Recognition

This exact pattern was previously identified and fixed for **component deletion** (`clearDeletedComponentFromCache`). The same defense-in-depth approach was applied:

1. Clear state immediately on action (close/delete)
2. Validate before persistence
3. Clear from all caches

## Related Issues

- **Component deletion infinite loop** (fixed 2025-12-11) - Same pattern
  - See: `2025-12-11-component-deletion-infinite-loop-fix.md`
- Both fixes use the same "clear cache on delete" pattern

## Lessons Learned

1. **Defense in depth is essential**: Multiple layers of protection prevent edge cases
2. **Cache invalidation matters**: Any delete operation should clear all related caches
3. **Debug logs are critical**: The `preview_snapshot_skip_hot_runtime` log revealed the true root cause
4. **Pattern consistency**: When fixing similar issues (component vs note deletion), apply the same proven patterns
