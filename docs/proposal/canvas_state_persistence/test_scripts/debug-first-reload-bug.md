# Debugging First-Reload Position Bug

## Bug Description
When a brand-new note is created and its main panel is dragged to a new position, the first reload shows the panel at the default origin, but subsequent reloads correctly restore the dragged position.

## Test Procedure

### Step 1: Create a New Note
1. Start the application: `npm run dev`
2. Create a brand-new note (one that doesn't exist in the database yet)
3. Observe the main panel position (should be at default ~2000, 1500)

### Step 2: Drag and Immediate Reload
1. Drag the main panel to a significantly different position (e.g., x:3000, y:2500)
2. **Immediately** reload the page (within 750ms, before retry timer fires)
3. Open browser console and look for these logs:

**Expected logs on drag:**
```
[CanvasWorkspace] persistWorkspace called: [{noteId: "...", isOpen: true, mainPosition: {x: 3000, y: 2500}}]
[CanvasWorkspace] Marked <note-id> as pending: {x: 3000, y: 2500}
```

**Expected logs if persist fails:**
```
[CanvasWorkspace] Persist error: <error message>
[CanvasWorkspace] Panel position persist failed, scheduling retry
```

**Expected logs on reload/navigation:**
```
[CanvasWorkspace] beforeunload/visibilitychange triggered
[CanvasWorkspace] Pending persists: [[<note-id>, {x: 3000, y: 2500}]]
[CanvasWorkspace] Sending unload persist: [{noteId: "...", isOpen: true, mainPosition: {x: 3000, y: 2500}}]
```

### Step 3: Verify First Reload
1. After page reloads, check the main panel position
2. **EXPECTED BEHAVIOR**: Panel should be at the dragged position (3000, 2500)
3. **BUG BEHAVIOR**: Panel appears at default position (2000, 1500)

### Step 4: Check Database
Query the database to see what was actually persisted:

```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT note_id, is_open, main_position_x, main_position_y, updated_at
   FROM canvas_workspace_notes
   WHERE note_id = '<note-id-from-logs>';"
```

**Expected if fix works:**
- Row exists with x=3000, y=2500

**Expected if bug persists:**
- Row doesn't exist, OR
- Row exists with default position (2000, 1500)

### Step 5: Subsequent Reloads
1. If first reload showed wrong position, drag again to new position (e.g., x:3500, y:2000)
2. Reload page again
3. **EXPECTED**: This time it should work (because note now exists in database)

## Root Cause Hypothesis

The bug occurs due to a race condition:

1. New note created → may not be in `notes` table yet
2. `openNote()` tries to persist workspace → **FK violation** (note doesn't exist)
3. User drags panel → `updateMainPosition()` called
4. Persist attempt → **FAILS** again (note still doesn't exist)
5. Position stored in `pendingPersistsRef` for retry
6. User reloads **before 750ms retry timer fires**
7. `beforeunload` handler should send the pending position
8. **Issue**: Either the fetch doesn't complete, or note still doesn't exist

## Implemented Fix

### Changes Made

1. **Track pending persists** (`pendingPersistsRef`)
   - Set before persist attempt
   - Clear only on successful persist
   - Kept on failed persist for retry

2. **Remove premature refreshWorkspace() calls**
   - Don't call `refreshWorkspace()` after failed persist in `updateMainPosition`
   - Prevents overwriting local state with stale database state

3. **Strengthen beforeunload handler**
   - Sends all pending persists with `keepalive: true`
   - Added comprehensive logging to trace execution

### Debug Logging Added

- `persistWorkspace`: Logs when marking/clearing pending, success/failure
- `beforeunload`: Logs when triggered, what's pending, what's being sent
- `updateMainPosition`: Already had warnings for failures

## What to Look For

### If Fix Works
1. Console shows `beforeunload/visibilitychange triggered` with pending persists
2. Database query shows correct position after first reload
3. UI shows correct position after first reload

### If Fix Doesn't Work
1. **Check console logs**: Is `beforeunload` firing?
2. **Check console logs**: Does `pendingPersistsRef` have the position?
3. **Check console logs**: Is the fetch being sent?
4. **Check database**: Did the position get saved?
5. **Check network tab**: Did the PATCH request complete before navigation?

### Possible Remaining Issues

1. **Timing**: Even with `keepalive`, browser might cancel the request
2. **FK still fails**: Note might still not exist in database by the time beforeunload fires
3. **Browser differences**: Safari/Firefox may handle `beforeunload` differently than Chrome

## Next Steps if Still Broken

### Option A: Wait for note to exist
Before opening a note, verify it exists in the database:
```typescript
const noteCheck = await fetch(`/api/postgres-offline/notes/${noteId}`)
if (!noteCheck.ok) {
  // Delay workspace persist until note exists
  scheduleWorkspacePersist(noteId, position)
  return
}
```

### Option B: Create workspace entry synchronously
Ensure the note and workspace entry are created in a single transaction, so FK can never fail.

### Option C: Eliminate FK constraint temporarily
Remove the FK constraint during initial creation, add it later after note is confirmed saved.

## Test Results

**Date:** [TO BE FILLED]
**Tester:** [TO BE FILLED]
**Status:** [PASS/FAIL]

**Console logs:**
```
[Paste relevant console output here]
```

**Database state:**
```
[Paste database query results here]
```

**UI behavior:**
- First reload position: [x, y]
- Expected position: [x, y]
- Match: [YES/NO]

**Conclusion:**
[Analysis of why it passed or failed]
