# FIX 8: Reject Empty Snapshots When Runtime Has Notes

**Date:** 2025-11-28
**Status:** Implemented and Verified
**File Modified:** `lib/hooks/annotation/use-note-workspaces.ts` (lines 2130-2147)

---

## Problem Description

When workspaces contained interactive components (calculator, alarm), users experienced **complete data loss** - the entire workspace would become empty after switching between workspaces.

## Symptoms Observed

1. User creates a note and adds a calculator component
2. User adds a second note with non-main panel
3. User creates a new workspace and adds notes with alarm component
4. User switches between workspaces several times
5. After a few switches, one workspace becomes **completely empty**
6. All notes, panels, and components are gone

## Root Cause Analysis

### Investigation Process

1. **Added debug instrumentation** to trace snapshot operations
2. **Analyzed debug logs** and discovered the following pattern:

### The Bug Timeline

```
T+0ms:    User has 2 notes open in Default Workspace
T+100ms:  Calculator component triggers a rapid snapshot save
T+150ms:  Transitional state captured: openNotes = [] (empty during re-render)
T+200ms:  Snapshot cached with empty openNotes
T+5000ms: User switches to New Workspace
T+10000ms: User switches back to Default Workspace
T+10050ms: previewWorkspaceFromSnapshot applies cached snapshot
T+10051ms: Empty openNotes applied → runtime cleared → membership cleared
T+10052ms: Workspace is now empty ❌ DATA LOSS
```

### Root Cause Identified

Interactive components (calculator, alarm) have their own state management that triggers React re-renders. During these re-renders:
1. A snapshot capture can occur
2. The capture happens during a transitional state where `openNotes` is temporarily empty
3. This empty snapshot gets cached
4. When switching back to the workspace, `previewWorkspaceFromSnapshot` applies the stale empty snapshot
5. The runtime's `openNotes` and `membership` are set to empty
6. Complete data loss occurs

### Initial Fix Proposal (Rejected)

Initially considered blocking empty membership updates in `setWorkspaceNoteMembership`:
```javascript
// REJECTED: Too broad - would break legitimate workspace clears
if (members.size === 0 && existingMembership.size > 0) {
  return // Don't clear membership
}
```

This was **too broad** because:
- Legitimate workspace switching needs to clear membership
- Creating a new empty workspace needs to start with empty membership
- Only **stale snapshot replays** should be blocked

### Refined Solution

Target the specific function where stale snapshots cause harm: `previewWorkspaceFromSnapshot`.

---

## The Fix

### Solution: Reject Empty Snapshots When Runtime Has Notes

Added protection at the start of `previewWorkspaceFromSnapshot`:

```javascript
// FIX 8: Don't apply empty snapshot if runtime has notes
// This protects against stale/transitional snapshots overwriting live state
const snapshotOpenNotesCount = snapshot.openNotes?.length ?? 0
if (snapshotOpenNotesCount === 0 && liveStateEnabled && hasWorkspaceRuntime(workspaceId)) {
  const runtimeOpenNotes = getRuntimeOpenNotes(workspaceId)
  if (runtimeOpenNotes && runtimeOpenNotes.length > 0) {
    emitDebugLog({
      component: "NoteWorkspace",
      action: "fix8_rejected_empty_snapshot",
      metadata: {
        workspaceId,
        runtimeNoteCount: runtimeOpenNotes.length,
        reason: "runtime_has_notes_would_lose_data",
      },
    })
    return // Don't apply - would lose notes
  }
}
```

### How It Works

1. **Check snapshot content**: Is the snapshot's `openNotes` empty?
2. **Check runtime state**: Is `liveStateEnabled` and does a runtime exist for this workspace?
3. **Check runtime notes**: Does the runtime have notes currently open?
4. **Protect if needed**: If snapshot is empty but runtime has notes, reject the snapshot
5. **Log for debugging**: Emit `fix8_rejected_empty_snapshot` so we can verify protection is working

### Why This Is Safe

- **Empty workspaces**: If runtime has no notes, empty snapshot is applied (correct behavior)
- **New workspaces**: Runtime doesn't exist yet, so check passes (correct behavior)
- **Legitimate clears**: Clears happen through other code paths, not previewWorkspaceFromSnapshot
- **Only targets stale snapshots**: Only blocks when we would lose data

---

## Verification

### Debug Log Evidence

After applying the fix, tested with the exact reproduction steps. The logs show FIX 8 working:

```sql
SELECT action, metadata, created_at
FROM debug_logs
WHERE action = 'fix8_rejected_empty_snapshot'
ORDER BY created_at DESC LIMIT 10;
```

Results showed 4 instances of empty snapshots being rejected:

| Time | Runtime Notes | Reason |
|------|---------------|--------|
| 21:45:12 | 1 | runtime_has_notes_would_lose_data |
| 21:45:08 | 1 | runtime_has_notes_would_lose_data |
| 21:44:55 | 2 | runtime_has_notes_would_lose_data |
| 21:44:51 | 1 | runtime_has_notes_would_lose_data |

### User Testing Results

After FIX 8:
- Created notes with non-main panels ✓
- Added calculator components ✓
- Added second notes ✓
- Created new workspaces ✓
- Added notes with alarm components ✓
- Switched between workspaces repeatedly ✓
- **No empty workspace or missing notes** ✓

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/hooks/annotation/use-note-workspaces.ts` | 2130-2147 | Added FIX 8 empty snapshot rejection |

---

## Debug Query

To check if the protection is working:

```sql
SELECT action,
       metadata->>'workspaceId' as workspace_id,
       metadata->>'runtimeNoteCount' as runtime_notes,
       metadata->>'reason' as reason,
       created_at
FROM debug_logs
WHERE action = 'fix8_rejected_empty_snapshot'
ORDER BY created_at DESC
LIMIT 20;
```

---

## Related Fixes

- **FIX 6** (lines 2249-2278): Hot runtime protection for openNotes in replayWorkspaceSnapshot
- **FIX 7** (lines 2296-2298): Extend targetIds to prevent close loop from undoing FIX 6
- **FIX 8** (lines 2130-2147): Reject empty snapshots in previewWorkspaceFromSnapshot (this fix)

---

## Lessons Learned

1. **Component side effects are dangerous**: Interactive components can trigger state captures at unexpected times
2. **Question initial solutions**: The initial fix was too broad; taking time to reconsider led to a better solution
3. **Target the specific code path**: Instead of blocking all empty updates, block only the problematic path (stale snapshot replay)
4. **Runtime as source of truth**: When runtime has live data, don't let cached snapshots overwrite it
5. **Debug logging is essential**: The `fix8_rejected_empty_snapshot` log proves the fix is working

---

## Prevention of Similar Issues

For future features:
1. **Be careful with snapshot capture timing**: Avoid capturing during component re-renders
2. **Add staleness checks**: Compare timestamps or version numbers before applying cached data
3. **Prefer merge over overwrite**: When in doubt, merge data rather than replacing it
4. **Test with interactive components**: Include calculator, alarm, and similar components in test scenarios

