# FIX 6: Hot Runtime Protection for OpenNotes in replaySnapshot

**Date:** 2025-11-28
**Status:** Implemented and Verified
**File Modified:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 2229-2260)

---

## Problem Description

When adding notes to a workspace, users experienced a **2-5 second delay** before newly added notes appeared in the UI. The delay was intermittent and particularly noticeable when:
- Adding a second or third note to a workspace
- The workspace had background snapshot replay activity

## Symptoms Observed

1. User adds a note via the UI
2. `openNote` function completes quickly (~0.3ms)
3. Component receives the update with correct note count
4. Note **does not appear** in the UI
5. After 2-5 seconds, the note suddenly appears

## Root Cause Analysis

### Investigation Process

1. **Added timing instrumentation** using `debugLog` to trace:
   - `open_note_start` / `open_note_end` - when openNote is called
   - `component_received_open_notes_update` - when React component receives state
   - `commit_open_notes_start` / `commit_open_notes_end` - when notes are committed to runtime
   - Added `callSite` parameter to identify which code path triggered each commit

2. **Analyzed debug logs** and discovered a race condition:

### Timeline of the Bug (Before Fix)

```
17527ms: open_note_start for second note (ff2cf8f0)
17549ms: open_note_end - function completed
17963ms: component_received_open_notes_update with 2 notes ✓
17963ms: useEffect_openNotesSync commits 2 notes ✓
17994ms: replaySnapshot commits 1 note ❌ STALE OVERWRITE!
18238ms: get_open_notes returns... (missing result, state corrupted)
20272ms: get_open_notes returns 2 notes (state recovered ~2.3s later)
```

### Root Cause Identified

The `replayWorkspaceSnapshot` function (around line 2232) was **unconditionally overwriting** the runtime's openNotes with snapshot data, even when:
- The runtime was "hot" (live state enabled)
- The snapshot contained **stale data** (captured before the user added a new note)

The snapshot replay happened 31ms AFTER the correct 2-note state was committed, but it contained only 1 note (captured earlier), effectively **reverting** the user's action.

### Existing Pattern Not Applied

The codebase already had protection for **membership** in hot runtimes (FIX 2, lines 2142-2186):
```javascript
// FIX 2: Prevent membership regression from partial snapshots in hot runtimes
const runtimeState = liveStateEnabled && hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"
if (runtimeState === "hot") {
  // Merge membership instead of overwriting...
}
```

However, this protection was **NOT applied to openNotes**, which suffered from the same race condition.

---

## The Fix

### Solution: Apply Hot Runtime Protection to OpenNotes

Added the same protection pattern used for membership to openNotes in `replayWorkspaceSnapshot`:

```javascript
// FIX 6: Apply same hot runtime protection to openNotes as we do for membership
// When runtime is hot, merge openNotes instead of overwriting with stale snapshot data
let openNotesToCommit: { noteId: string; mainPosition: { x: number; y: number } | null }[] = normalizedOpenNotes
if (runtimeState === "hot") {
  const currentOpenNotes = getRuntimeOpenNotes(workspaceId)
  if (currentOpenNotes && currentOpenNotes.length > 0) {
    const snapshotNoteIds = new Set(normalizedOpenNotes.map((n) => n.noteId))
    const missingFromSnapshot = currentOpenNotes.filter((n) => !snapshotNoteIds.has(n.noteId))
    if (missingFromSnapshot.length > 0) {
      // Merge: keep existing open notes + add new ones from snapshot
      const normalizedCurrent = currentOpenNotes.map((n) => ({
        noteId: n.noteId,
        mainPosition: n.mainPosition ?? null,
      }))
      const existingIds = new Set(normalizedCurrent.map((n) => n.noteId))
      openNotesToCommit = [...normalizedCurrent, ...normalizedOpenNotes.filter((n) => !existingIds.has(n.noteId))]
      emitDebugLog({
        component: "NoteWorkspace",
        action: "preview_snapshot_open_notes_preserved",
        metadata: {
          workspaceId,
          runtimeState,
          snapshotNoteCount: normalizedOpenNotes.length,
          currentOpenNotesCount: currentOpenNotes.length,
          missingFromSnapshot: missingFromSnapshot.map((n) => n.noteId),
          mergedCount: openNotesToCommit.length,
        },
      })
    }
  }
}
cache.openNotes = openNotesToCommit
commitWorkspaceOpenNotes(workspaceId, openNotesToCommit, { updateMembership: false, callSite: "replaySnapshot" })
```

### How It Works

1. **Detect hot runtime**: Check if `liveStateEnabled` and runtime exists
2. **Get current state**: Read the runtime's current openNotes
3. **Compare with snapshot**: Find notes in runtime that are missing from snapshot
4. **Merge if needed**: If runtime has notes not in snapshot, merge them instead of overwriting
5. **Log for debugging**: Emit `preview_snapshot_open_notes_preserved` when protection triggers

---

## Verification

### Debug Log Evidence

After applying the fix, the `preview_snapshot_open_notes_preserved` log shows the protection working:

| Time | Snapshot Notes | Runtime Notes | Merged | Preserved Notes |
|------|----------------|---------------|--------|-----------------|
| 21:38:09 | 0 | 1 | 1 | 1b1a7a83... |
| 21:38:44 | 2 | 3 | 3 | e996d1c8... |
| 21:40:39 | 0 | 1 | 1 | 3eee07a4... |

### Timeline After Fix

```
22138ms: open_note_start for second note (2abe0b2d)
22156ms: open_note_end - function completed (18ms)
22590ms: component_received_open_notes_update with 2 notes ✓
22598ms: useEffect_openNotesSync commits 2 notes ✓
24700ms: captureSnapshot commits 2 notes ✓
24911ms: replaySnapshot commits 2 notes ✓ NO REGRESSION!
```

### User Testing Results

- Notes now appear **immediately** when added
- No delay when switching between workspaces
- Second and third notes appear without any visible lag

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/hooks/annotation/use-note-workspaces.ts` | 2229-2260 | Added FIX 6 hot runtime protection for openNotes |
| `lib/hooks/annotation/use-note-workspaces.ts` | 536 | Added `callSite` option to `commitWorkspaceOpenNotes` |
| `lib/hooks/annotation/use-note-workspaces.ts` | Various | Added `callSite` to all `commitWorkspaceOpenNotes` calls |

---

## Debug Instrumentation Added

For future debugging, the following instrumentation was added:

### NoteDelay Component Logs

| Action | Description |
|--------|-------------|
| `open_note_start` | When `openNote` function begins |
| `open_note_before_set_state` | Just before calling setState |
| `open_note_end` | When `openNote` function completes |
| `commit_open_notes_start` | When committing notes to runtime (includes `callSite`) |
| `commit_open_notes_end` | When commit completes |
| `get_open_notes_called` | When reading notes from runtime |
| `get_open_notes_result_live_state` | Result of reading notes |
| `component_received_open_notes_update` | When React component receives update |

### Call Sites Tracked

| Call Site | Location | Description |
|-----------|----------|-------------|
| `useEffect_openNotesSync` | Line 2363 | Syncs provider openNotes to runtime |
| `replaySnapshot` | Line 2260 | Replays workspace snapshot |
| `captureSnapshot` | Line 1943 | Captures current state |
| `restoreWorkspace` | Line 2856 | Restores workspace from API |
| `createWorkspace` | Line 3231 | Creates new workspace |
| `evictStaleNotes` | Line 790 | Removes stale notes |
| `snapshotRuntimeSync` | Line 1654 | Syncs snapshot to runtime |
| `snapshotOpenNoteSeed` | Line 1811 | Seeds from snapshot |
| `buildPayload_inferred` | Line 2483 | Builds payload from membership |
| `getOpenNotes_*` | Lines 644-660 | Various fallback paths |

---

## Query for Debugging

To check if the protection is working:

```sql
SELECT action, metadata, created_at
FROM debug_logs
WHERE action = 'preview_snapshot_open_notes_preserved'
ORDER BY created_at DESC
LIMIT 10;
```

To trace note addition timing:

```sql
SELECT action,
       metadata->>'noteCount' as note_count,
       metadata->>'callSite' as call_site,
       metadata->>'noteId' as note_id,
       created_at
FROM debug_logs
WHERE component = 'NoteDelay'
ORDER BY created_at DESC
LIMIT 50;
```

---

## Related Fixes

- **FIX 2** (lines 2142-2186): Hot runtime protection for membership
- **FIX 5** (lines 2257-2259): Prevent membership overwrite during replay
- **FIX 6** (lines 2229-2260): Hot runtime protection for openNotes (this fix)

---

## Lessons Learned

1. **Consistency matters**: When adding protection for one data type (membership), apply the same protection to related data types (openNotes)
2. **Race conditions are subtle**: The 31ms gap between correct commit and stale overwrite was enough to cause visible delays
3. **Debug instrumentation is essential**: The `callSite` tracking made it possible to identify exactly which code path caused the regression
4. **Hot runtime detection**: The pattern of checking `liveStateEnabled && hasWorkspaceRuntime()` is effective for detecting when extra protection is needed
