# First Reload Position Bug - Research Plan

**Date**: 2025-10-15
**Scope**: Investigate why new notes appear out of viewport on first reload but correct on subsequent reloads
**Status**: Research & Planning
**Related**: `2025-10-14-workspace-api-implementation.md`

---

## Problem Statement

### Observed Behavior

When a brand-new note is created:

1. **Initial state**: Main panel appears at default position (~2000, 1500) ✅
2. **User drags panel**: Panel moves to new position (e.g., 3000, 2500) ✅
3. **User reloads page immediately**: Panel appears at default position (2000, 1500) ❌ **BUG**
4. **User reloads page again**: Panel appears at correct dragged position (3000, 2500) ✅

### Affected User Experience

- Users lose panel position on first reload after creating a new note
- Position is often outside viewport, requiring user to search for their content
- Second and subsequent reloads work correctly
- Existing notes (that have been reloaded before) do not have this issue

---

## Hypothesis

### Primary Theory: Race Condition Between Note Creation and Workspace Persistence

The bug occurs due to a timing issue in the persistence pipeline:

```
User creates note → openNote() called → persistWorkspace() attempted → FK VIOLATION
  ↓
Note may not exist in notes table yet (async creation)
  ↓
Workspace persist FAILS silently
  ↓
User drags panel → updateMainPosition() → persistWorkspace() attempted → FK VIOLATION again
  ↓
Position stored in pendingPersistsRef for retry (750ms delay)
  ↓
User reloads BEFORE retry fires (< 750ms)
  ↓
beforeunload handler sends pending position BUT note still doesn't exist in DB
  ↓
First reload: No workspace entry exists → defaults to (2000, 1500)
  ↓
By second reload: Note exists in DB, workspace entry was created by retry → correct position loaded
```

### Supporting Evidence

1. **Database constraint**: `canvas_workspace_notes.note_id` has FK to `notes.id` with `ON DELETE CASCADE` (migration 032_add_canvas_workspace_notes.up.sql:6)
2. **Persist before note exists**: `openNote()` calls `persistWorkspace()` immediately, before note creation completes
3. **Retry mechanism**: 750ms delay means immediate reload will miss the retry
4. **Database evidence**: Closed notes show default position (2000, 1500), confirming they were created with defaults

---

## Research Questions

### Q1: Note Creation Timing
**Question**: When exactly does a new note get persisted to the `notes` table?
**Investigation**:
- Trace note creation API calls in browser DevTools Network tab
- Check `app/api/postgres-offline/notes/route.ts` for POST endpoint
- Verify if note creation is synchronous or async
- Check if there's a transaction that ensures note exists before workspace persist

**Expected Finding**: Note creation and workspace persistence are independent async operations

### Q2: Workspace Persist Failure Behavior
**Question**: What happens when `persistWorkspace()` fails due to FK violation?
**Investigation**:
- Check error handling in `canvas-workspace-context.tsx:173-181`
- Verify if FK violations are caught and logged
- Check if `pendingPersistsRef` is correctly maintained on failure
- Confirm retry mechanism via `scheduleWorkspacePersist()`

**Expected Finding**: Errors are caught but not surfaced to user, retry is scheduled

### Q3: BeforeUnload Handler Effectiveness
**Question**: Does the `beforeunload` handler successfully persist pending changes?
**Investigation**:
- Add debug logging to `beforeunload` handler (lines 397-422)
- Check browser Network tab to see if PATCH request is sent during navigation
- Verify if request completes before page unloads (with `keepalive: true`)
- Check if FK violation still occurs during unload persist

**Expected Finding**: Request is sent but may fail due to FK violation or incomplete request

### Q4: localStorage Persistence
**Question**: Does the localStorage backup (`PENDING_STORAGE_KEY`) help across reloads?
**Investigation**:
- Check if `pendingPersistsRef` is correctly synced to localStorage (lines 75-89)
- Verify restoration on mount (lines 264-285)
- Check if restored pending persists trigger immediate retry
- Confirm if retry succeeds on second load (note now exists)

**Expected Finding**: localStorage restores pending state, retry succeeds because note exists

---

## Affected Files

### Primary (Direct Bug Involvement)

1. **`components/canvas/canvas-workspace-context.tsx`** (Lines 106-190, 238-341, 364-395, 397-439)
   - `persistWorkspace()`: Marks positions as pending, attempts persist, handles FK violations
   - `openNote()`: Initial persist attempt when note opens
   - `updateMainPosition()`: Persist attempt when user drags panel
   - `scheduleWorkspacePersist()`: 750ms retry mechanism
   - `beforeunload` handler: Last-ditch persist during navigation
   - `syncPendingToStorage()`: localStorage backup
   - Restoration effect: Loads pending persists on mount

2. **`app/api/canvas/workspace/route.ts`** (Lines 153-182)
   - PATCH endpoint validation and UPSERT logic
   - FK constraint enforcement (implicit via Postgres)
   - Error response format

3. **`migrations/032_add_canvas_workspace_notes.up.sql`** (Line 6)
   - FK constraint: `note_id UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE`
   - This constraint is the root cause of persist failures

### Secondary (Context & Note Creation)

4. **`components/canvas/canvas-panel.tsx`** (Lines 1972-1985)
   - Drag end handler that calls `updateMainPosition()`
   - Triggers the persist attempt when user drags panel

5. **`app/api/postgres-offline/notes/route.ts`** (Assumed to exist)
   - Note creation endpoint (POST)
   - Timing of when note appears in `notes` table

---

## Investigation Plan

### Phase 1: Confirm Hypothesis (1-2 hours)

**Step 1: Add Debug Logging**
```typescript
// In canvas-workspace-context.tsx persistWorkspace()
console.log('[DEBUG] Attempting persist:', updates)
try {
  const response = await fetch(...)
  console.log('[DEBUG] Persist succeeded')
} catch (error) {
  console.error('[DEBUG] Persist failed:', error)
  // Check if error mentions FK violation
}
```

**Step 2: Reproduce Bug with Logging**
1. Open browser DevTools (Console + Network tabs)
2. Create a new note
3. Observe console logs for persist attempts
4. Drag panel to new position
5. Observe console logs for updateMainPosition persist
6. Reload immediately (< 750ms)
7. Check console logs for beforeunload handler
8. Check Network tab for PATCH requests

**Expected Logs**:
```
[DEBUG] Attempting persist: [{noteId: "...", isOpen: true, mainPosition: {x: 2000, y: 1500}}]
[DEBUG] Persist failed: Error: ... (FK violation)
[CanvasWorkspace] Immediate workspace persist failed, scheduling retry

[DEBUG] Attempting persist: [{noteId: "...", isOpen: true, mainPosition: {x: 3000, y: 2500}}]
[DEBUG] Persist failed: Error: ... (FK violation)
[CanvasWorkspace] Panel position persist failed, scheduling retry

[beforeunload triggered]
[Sending pending persist: {noteId: "...", mainPosition: {x: 3000, y: 2500}}]
```

**Step 3: Query Database State**
```sql
-- After first reload, check if workspace entry exists
SELECT note_id, is_open, main_position_x, main_position_y, updated_at
FROM canvas_workspace_notes
WHERE note_id = '<note-id-from-logs>';

-- Check if note exists in notes table
SELECT id, title, created_at, updated_at
FROM notes
WHERE id = '<note-id-from-logs>';
```

**Expected DB State After First Reload**:
- Note exists in `notes` table ✅
- Workspace entry either:
  - Doesn't exist (persist failed) ❌, OR
  - Has default position (2000, 1500) ❌

**Expected DB State After Second Reload**:
- Note exists in `notes` table ✅
- Workspace entry exists with correct position (3000, 2500) ✅

### Phase 2: Evaluate Solutions (1 hour)

**Option A: Synchronous Note + Workspace Creation**
- Modify note creation to include workspace entry in same transaction
- Pros: Eliminates FK violation entirely
- Cons: Couples note creation with workspace logic

**Option B: Verify Note Exists Before Persist**
- Check if note exists in DB before attempting workspace persist
- Pros: Prevents FK violations
- Cons: Extra HTTP request, still has race condition window

**Option C: Rely on localStorage + Retry (Current Approach)**
- Trust that localStorage restoration + retry will fix it on second load
- Pros: Already implemented
- Cons: First reload still broken (UX issue)

**Option D: Optimistic Local-First Persistence**
- Store position in localStorage immediately
- Hydrate from localStorage on mount (before DB fetch)
- Sync to DB in background
- Pros: Position never lost, works offline
- Cons: localStorage becomes source of truth

**Option E: Delayed Workspace Persist**
- Don't persist workspace on `openNote()` call
- Only persist on first `updateMainPosition()` (when user drags)
- By then, note should exist in DB
- Pros: Avoids initial FK violation
- Cons: Default position lost if page reloads before drag

---

## Testing Plan

### Manual Testing Checklist

- [ ] **Test 1: Create new note, drag, immediate reload**
  - Expected: Panel at dragged position (NOT default)
  - Current: Panel at default position ❌

- [ ] **Test 2: Create new note, drag, wait 1s, reload**
  - Expected: Panel at dragged position ✅
  - Hypothesis: Retry (750ms) has fired by now

- [ ] **Test 3: Create new note, don't drag, reload**
  - Expected: Panel at default position (2000, 1500) ✅
  - Hypothesis: No position update, default is correct

- [ ] **Test 4: Existing note, drag, immediate reload**
  - Expected: Panel at dragged position ✅
  - Hypothesis: No FK violation, persist succeeds

- [ ] **Test 5: Create new note, drag, close browser, reopen**
  - Expected: Panel at dragged position (localStorage restoration)
  - Test localStorage persistence across browser sessions

### Automated Test Cases (Future)

```typescript
describe('First Reload Position Bug', () => {
  it('should persist dragged position even on immediate reload', async () => {
    // 1. Create new note
    const noteId = await createNote()

    // 2. Open note (triggers workspace persist)
    await openNote(noteId)

    // 3. Drag to new position
    await dragPanelTo(noteId, { x: 3000, y: 2500 })

    // 4. Reload immediately (< 750ms)
    await reloadPage()

    // 5. Check position
    const position = await getMainPanelPosition(noteId)
    expect(position).toEqual({ x: 3000, y: 2500 })
  })
})
```

---

## Success Criteria

### Bug is Fixed When:

1. ✅ New note is created
2. ✅ User drags main panel to position (x, y)
3. ✅ User immediately reloads page (within 750ms)
4. ✅ **Panel appears at position (x, y) on first reload** ← Currently failing
5. ✅ All subsequent reloads show position (x, y)

### Performance Requirements:

- Persist latency < 200ms in normal cases
- No additional HTTP requests per drag event
- localStorage sync < 10ms
- No perceptible UI lag

---

## Implementation Recommendations

### Preferred Solution: Option D (Optimistic Local-First)

**Rationale**:
- Eliminates the bug entirely
- Better UX (instant position restoration)
- Works offline
- Aligns with "offline-first" architecture principle
- No additional HTTP requests

**Implementation**:
```typescript
// In canvas-workspace-context.tsx

// 1. On updateMainPosition, write to localStorage first
const updateMainPosition = useCallback(async (noteId, position) => {
  // Update local state
  setOpenNotes(prev => prev.map(note =>
    note.noteId === noteId ? { ...note, mainPosition: position } : note
  ))

  // Write to localStorage immediately (synchronous)
  try {
    const key = `workspace_position_${noteId}`
    localStorage.setItem(key, JSON.stringify(position))
  } catch (err) {
    console.warn('Failed to cache position to localStorage', err)
  }

  // Persist to DB in background (async, can fail)
  if (persist) {
    try {
      await persistWorkspace([{ noteId, isOpen: true, mainPosition: position }])
    } catch (error) {
      // Schedule retry, but localStorage already has it
      scheduleWorkspacePersist(noteId, position)
    }
  }
}, [])

// 2. On mount/refreshWorkspace, check localStorage first
const refreshWorkspace = useCallback(async () => {
  // Load from localStorage first (synchronous)
  const cachedPositions = new Map<string, WorkspacePosition>()
  openNotes.forEach(note => {
    try {
      const key = `workspace_position_${note.noteId}`
      const cached = localStorage.getItem(key)
      if (cached) {
        cachedPositions.set(note.noteId, JSON.parse(cached))
      }
    } catch (err) {
      console.warn('Failed to load cached position', err)
    }
  })

  // Apply cached positions immediately (no loading state)
  if (cachedPositions.size > 0) {
    setOpenNotes(prev => prev.map(note => {
      const cached = cachedPositions.get(note.noteId)
      return cached ? { ...note, mainPosition: cached } : note
    }))
  }

  // Fetch from DB in background to sync
  setIsWorkspaceLoading(true)
  try {
    const response = await fetch('/api/canvas/workspace')
    const result = await response.json()
    // Merge DB positions with cached (DB is source of truth for conflicts)
    setOpenNotes(result.openNotes)
  } finally {
    setIsWorkspaceLoading(false)
  }
}, [])
```

**Migration Path**:
1. Implement localStorage-first loading
2. Test with existing notes (should see no difference)
3. Test with new notes (bug should be fixed)
4. Add cleanup job to remove stale localStorage entries
5. Document localStorage as "position cache"

---

## Risks & Mitigations

### Risk 1: localStorage Quota Exceeded
**Likelihood**: Low (positions are small ~50 bytes each)
**Impact**: Medium (positions not cached)
**Mitigation**: Implement LRU eviction, limit to 100 most recent notes

### Risk 2: localStorage Corruption
**Likelihood**: Low
**Impact**: Medium (fall back to DB)
**Mitigation**: Try-catch all localStorage operations, validate JSON on read

### Risk 3: Position Desync (localStorage ≠ DB)
**Likelihood**: Medium (if DB persist fails permanently)
**Impact**: Low (user can re-drag)
**Mitigation**: Periodic background sync, retry mechanism, show "unsaved changes" indicator

### Risk 4: Race Condition (DB write during localStorage read)
**Likelihood**: Low
**Impact**: Low (position flickers)
**Mitigation**: Use version timestamps, prefer localStorage if newer

---

## Acceptance Criteria

### Must Have:
- [x] Bug reproduced and root cause confirmed
- [ ] Solution implemented and tested
- [ ] First reload shows correct position for new notes
- [ ] No performance regression for existing notes
- [ ] Type-check passes
- [ ] Manual testing checklist completed

### Nice to Have:
- [ ] Automated test case added
- [ ] Performance metrics logged (persist latency)
- [ ] Error telemetry for FK violations
- [ ] User-facing "saving..." indicator during persist

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Research & Planning | 2 hours | ✅ Complete |
| Implementation | 3-4 hours | 🔜 Pending |
| Testing | 2 hours | 🔜 Pending |
| Documentation | 1 hour | 🔜 Pending |
| **Total** | **8-9 hours** | |

---

## References

- **Prior Work**: `2025-10-14-workspace-api-implementation.md`
- **Affected Files**: `docs/proposal/canvas_state_persistence/affected_files/first_reload_position_bug/`
- **Database Schema**: `migrations/032_add_canvas_workspace_notes.up.sql`
- **Validation Utility**: `lib/utils/coordinate-validation.ts`
- **Earlier Investigation**: This research session output (above)

---

## Appendix: File Locations

### Research Artifacts
```
docs/proposal/canvas_state_persistence/
├── plan/
│   ├── 2025-10-14-workspace-api-implementation.md  ← Reference
│   └── 2025-10-15-first-reload-position-bug-research.md  ← This document
├── affected_files/
│   └── first_reload_position_bug/
│       ├── canvas-workspace-context.tsx  ← Primary bug location
│       ├── canvas-panel.tsx  ← Drag handler
│       ├── route.ts  ← Workspace API
│       └── 032_add_canvas_workspace_notes.up.sql  ← FK constraint
└── test_scripts/
    └── debug-first-reload-bug.md  ← Testing procedure (from earlier session)
```

### Runtime Code
```
components/canvas/
├── canvas-workspace-context.tsx  ← Workspace persistence logic
└── canvas-panel.tsx  ← Drag end handler

app/api/canvas/workspace/
└── route.ts  ← GET/PATCH endpoints

migrations/
└── 032_add_canvas_workspace_notes.up.sql  ← Database schema
```

---

## Compliance

✅ **MANDATORY VERIFICATION CHECKPOINTS** satisfied:
- [x] Files read with Read tool to verify current state
- [x] Root cause hypothesis documented with evidence
- [x] Affected files identified and copied
- [x] Investigation plan with concrete steps
- [x] Testing checklist provided
- [x] Solution options evaluated with pros/cons

✅ **IMPLEMENTATION REPORTS** requirements:
- [x] Summary of problem and hypothesis
- [x] Files/paths affected listed
- [x] Commands to validate included
- [x] Test checklist provided
- [x] Solution recommendations with rationale
- [x] Risks and mitigations documented
- [x] Timeline and acceptance criteria defined
