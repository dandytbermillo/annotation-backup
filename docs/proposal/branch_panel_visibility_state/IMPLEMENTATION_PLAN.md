# Implementation Plan: Branch Panel Visibility State

**Feature Slug:** `branch_panel_visibility_state`
**Date:** 2025-10-20
**Status:** Planned (Not Started)
**Type:** Enhancement to Phase 1 Canvas State Persistence

---

## Problem Statement

Currently, branch panels are persisted to the database but are **intentionally not restored on page reload**. This is a Phase 1 design decision, not a missing Phase 2 feature.

**Current behavior:**
1. User opens branch panels → Saved to DB ✅
2. User refreshes page → Only main panel restored, branch panels gone ❌
3. User must manually reopen all branch panels

**Desired behavior:**
1. User opens branch panels → Saved to DB with `state='open'` ✅
2. User refreshes page → All open panels restored ✅
3. User closes branch panel → Saved to DB with `state='closed'` ✅
4. Closed panels don't reappear on refresh ✅

---

## Goals

1. **Track panel visibility state** in database
2. **Persist state changes** when panels are opened/closed
3. **Restore only open panels** on page reload
4. **Maintain backward compatibility** with existing panels
5. **No breaking changes** to existing functionality

---

## Non-Goals

- Multi-note unified canvas (that's Phase 2)
- Panel minimization/maximization
- Panel grouping or tabs
- Panel history/undo

---

## Solution Overview

Add a `state` column to the `panels` table to track panel visibility. Update hydration logic to filter by state='open' instead of filtering by panel type.

**Key insight:** This is purely a Phase 1 enhancement - no Phase 2 dependencies.

---

## Technical Design

### 1. Database Schema Changes

**Migration:** `032_add_panel_visibility_state.up.sql`

```sql
-- Add state column to track panel visibility
ALTER TABLE panels ADD COLUMN state TEXT NOT NULL DEFAULT 'open';

-- Add check constraint for valid states
ALTER TABLE panels ADD CONSTRAINT panels_state_check
  CHECK (state IN ('open', 'closed', 'minimized'));

-- Add index for filtering open panels
CREATE INDEX idx_panels_state ON panels(note_id, state) WHERE state = 'open';

-- Backfill: Mark main panels as 'open', others as 'closed' by default
UPDATE panels SET state = 'open' WHERE panel_id = 'main';
UPDATE panels SET state = 'closed' WHERE panel_id != 'main';

COMMENT ON COLUMN panels.state IS 'Panel visibility state: open (visible on canvas), closed (hidden), minimized (future feature)';
```

**Migration:** `032_add_panel_visibility_state.down.sql`

```sql
-- Reverse migration
DROP INDEX IF EXISTS idx_panels_state;
ALTER TABLE panels DROP CONSTRAINT IF EXISTS panels_state_check;
ALTER TABLE panels DROP COLUMN IF EXISTS state;
```

### 2. API Endpoint Changes

**File:** `app/api/canvas/panels/route.ts` (POST handler)

**Change:** Accept `state` parameter in panel creation

```typescript
interface CreatePanelRequest {
  id: string
  noteId: string
  type: 'editor' | 'branch' | 'context' | 'toolbar' | 'annotation'
  position: { x: number; y: number }
  size: { width: number; height: number }
  zIndex?: number
  state?: 'open' | 'closed' | 'minimized' // NEW
  title?: string
  metadata?: Record<string, any>
}

// In INSERT query:
INSERT INTO panels (
  panel_id, note_id, type,
  position_x_world, position_y_world,
  width_world, height_world,
  z_index, state, // NEW
  title, metadata
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
```

**File:** `app/api/canvas/panels/[panelId]/route.ts` (PATCH handler)

**Change:** Allow updating panel state

```typescript
// Add to UPDATE query
UPDATE panels
SET
  state = COALESCE($1, state), // NEW - allow state updates
  position_x_world = COALESCE($2, position_x_world),
  position_y_world = COALESCE($3, position_y_world),
  ...
WHERE panel_id = $N AND note_id = $M
```

**New endpoint:** `PATCH /api/canvas/panels/[panelId]/state`

Fast path for state-only updates (no position/size data):

```typescript
export async function PATCH(
  request: Request,
  { params }: { params: { panelId: string } }
) {
  const { noteId, state } = await request.json()

  // Validate state
  if (!['open', 'closed', 'minimized'].includes(state)) {
    return Response.json({ error: 'Invalid state' }, { status: 400 })
  }

  // Update state only
  const result = await pool.query(
    'UPDATE panels SET state = $1, updated_at = NOW() WHERE panel_id = $2 AND note_id = $3 RETURNING *',
    [state, params.panelId, noteId]
  )

  return Response.json({ success: true, panel: result.rows[0] })
}
```

### 3. Hydration Logic Changes

**File:** `components/annotation-canvas-modern.tsx` (lines 628-632)

**Before:**
```typescript
const panelsToHydrate = skipHydration
  ? []
  : (isInitialHydration || !isSameNote
      ? (isInitialHydration ? hydrationStatus.panels : hydrationStatus.panels.filter(panel => panel.id === 'main'))
      : hydrationStatus.panels.filter(panel => panel.id === 'main'))
```

**After:**
```typescript
const panelsToHydrate = skipHydration
  ? []
  : (isInitialHydration || !isSameNote
      ? hydrationStatus.panels.filter(panel => panel.state === 'open') // NEW - filter by state
      : hydrationStatus.panels.filter(panel => panel.id === 'main'))
```

**Add debug logging:**
```typescript
debugLog({
  component: 'AnnotationCanvas',
  action: 'filtering_panels_by_state',
  metadata: {
    totalPanels: hydrationStatus.panels.length,
    openPanels: hydrationStatus.panels.filter(p => p.state === 'open').length,
    closedPanels: hydrationStatus.panels.filter(p => p.state === 'closed').length,
    willHydrate: panelsToHydrate.length
  }
})
```

### 4. Panel Creation Changes

**File:** `components/annotation-canvas-modern.tsx` (handleCreatePanel)

**Change:** Set state='open' when creating panels

```typescript
const payload = {
  id: panelId,
  noteId: effectiveNoteId,
  type: dbPanelType,
  position: worldPosition,
  size: worldSize,
  zIndex,
  state: 'open', // NEW - explicitly mark as open
  title: panelTitle,
  metadata: metadata
}

await persistPanelCreate(payload)
```

### 5. Panel Close Changes

**File:** `components/annotation-canvas-modern.tsx` (handlePanelClose)

**Change:** Update state to 'closed' instead of deleting panel

**Before:**
```typescript
const handlePanelClose = (panelId: string, panelNoteId?: string) => {
  // Remove from canvasItems
  setCanvasItems(prev => prev.filter(...))

  // Remove from state.panels
  dispatch({ type: 'REMOVE_PANEL', payload: { id: panelId } })

  // Delete from database
  persistPanelDelete(panelId, storeKey)
}
```

**After:**
```typescript
const handlePanelClose = (panelId: string, panelNoteId?: string) => {
  // Remove from canvasItems (UI)
  setCanvasItems(prev => prev.filter(...))

  // Remove from state.panels (legacy state)
  dispatch({ type: 'REMOVE_PANEL', payload: { id: panelId } })

  // NEW: Update state to 'closed' instead of deleting
  const targetNoteId = panelNoteId || noteId
  const storeKey = ensurePanelKey(targetNoteId, panelId)

  // Option A: Use new fast endpoint
  fetch(`/api/canvas/panels/${panelId}/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteId: targetNoteId, state: 'closed' })
  }).catch(err => {
    debugLog({
      component: 'AnnotationCanvas',
      action: 'panel_state_update_failed',
      metadata: { panelId, noteId: targetNoteId, error: err.message }
    })
  })

  debugLog({
    component: 'AnnotationCanvas',
    action: 'panel_state_set_to_closed',
    metadata: { panelId, noteId: targetNoteId, storeKey }
  })
}
```

**Important:** Keep branch data in dataStore (don't delete it) so content persists.

### 6. TypeScript Type Updates

**File:** `types/canvas-items.ts` or relevant type definition file

```typescript
export type PanelState = 'open' | 'closed' | 'minimized'

export interface PanelData {
  id: string
  noteId: string
  type: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  zIndex: number
  state: PanelState // NEW
  title?: string
  metadata?: Record<string, any>
}
```

### 7. Hydration Hook Updates

**File:** `lib/hooks/use-canvas-hydration.ts`

**Change:** Include state in returned panel data

```typescript
export interface HydrationStatus {
  loading: boolean
  error: Error | null
  success: boolean
  panelsLoaded: number
  cameraLoaded: boolean
  panels: Array<{
    id: string
    noteId: string
    storeKey?: string
    type: string
    position: { x: number; y: number }
    size: { width: number; height: number }
    zIndex: number
    state: 'open' | 'closed' | 'minimized' // NEW
    title?: string
    metadata?: Record<string, any>
  }>
}
```

**In loadPanelLayout function:**
```typescript
const validPanels = result.panels.map((panel: any) => ({
  ...panel,
  state: panel.state || 'open' // Default for backward compatibility
}))
```

---

## Implementation Steps

### Phase 1: Database & API (Backend)

**Priority:** P0
**Estimated Time:** 2 hours

1. **Create migration files**
   - [ ] Write `032_add_panel_visibility_state.up.sql`
   - [ ] Write `032_add_panel_visibility_state.down.sql`
   - [ ] Test migration forward (UP)
   - [ ] Test migration backward (DOWN)
   - [ ] Test migration forward again (idempotent)

2. **Update API endpoints**
   - [ ] Modify `POST /api/canvas/panels` to accept `state` parameter
   - [ ] Modify `PATCH /api/canvas/panels/[panelId]` to allow state updates
   - [ ] Create `PATCH /api/canvas/panels/[panelId]/state` endpoint
   - [ ] Add validation for state values
   - [ ] Update API response types

3. **Test API changes**
   - [ ] Test creating panel with state='open'
   - [ ] Test creating panel with state='closed'
   - [ ] Test updating panel state via PATCH
   - [ ] Test backward compatibility (panels without state)

### Phase 2: Hydration Logic (Frontend)

**Priority:** P0
**Estimated Time:** 2 hours

1. **Update TypeScript types**
   - [ ] Add `PanelState` type
   - [ ] Update `PanelData` interface
   - [ ] Update `HydrationStatus` interface
   - [ ] Run type check: `npm run type-check`

2. **Update hydration hook**
   - [ ] Add `state` to returned panel data
   - [ ] Add backward compatibility handling (default to 'open')
   - [ ] Add debug logging for state filtering

3. **Update hydration logic in annotation-canvas-modern.tsx**
   - [ ] Replace panel type filter with state filter (line 631)
   - [ ] Add debug logging for filtered panels
   - [ ] Test that main panel always hydrates
   - [ ] Test that open branch panels hydrate
   - [ ] Test that closed branch panels don't hydrate

### Phase 3: Panel Lifecycle (Frontend)

**Priority:** P0
**Estimated Time:** 1 hour

1. **Update panel creation**
   - [ ] Set `state='open'` in `handleCreatePanel`
   - [ ] Pass state to `persistPanelCreate`
   - [ ] Add debug logging

2. **Update panel close**
   - [ ] Change from delete to state update in `handlePanelClose`
   - [ ] Call new state endpoint
   - [ ] Keep branch data in dataStore
   - [ ] Add debug logging

3. **Test panel lifecycle**
   - [ ] Open panel → Check DB (state='open')
   - [ ] Close panel → Check DB (state='closed')
   - [ ] Refresh page → Only open panels appear
   - [ ] Reopen closed panel → Check DB (state='open')

### Phase 4: Testing & Validation

**Priority:** P0
**Estimated Time:** 2 hours

1. **Manual testing**
   - [ ] Test with no panels (fresh note)
   - [ ] Test opening branch panels
   - [ ] Test closing branch panels
   - [ ] Test refresh with open panels
   - [ ] Test refresh with closed panels
   - [ ] Test mixed open/closed state
   - [ ] Test note switching
   - [ ] Test multiple notes with same panel IDs

2. **Database verification**
   - [ ] Query panels table, verify state column exists
   - [ ] Verify state transitions (open ↔ closed)
   - [ ] Verify index is being used
   - [ ] Verify backward compatibility with old panels

3. **Debug log analysis**
   - [ ] Check hydration logs show correct filtering
   - [ ] Check state update logs on panel close
   - [ ] Check state creation logs on panel open
   - [ ] No errors in console

### Phase 5: Documentation & Cleanup

**Priority:** P1
**Estimated Time:** 1 hour

1. **Update documentation**
   - [ ] Document new state column in schema docs
   - [ ] Update API endpoint documentation
   - [ ] Add state lifecycle diagram
   - [ ] Update INTEGRATION_GUIDE.md

2. **Code cleanup**
   - [ ] Remove any commented-out code
   - [ ] Ensure consistent debug logging
   - [ ] Add inline comments for state transitions
   - [ ] Run linter: `npm run lint`

---

## Edge Cases & Considerations

### 1. Backward Compatibility

**Issue:** Existing panels in database don't have `state` column

**Solution:**
- Migration sets default state based on panel type
- API defaults to 'open' if state is null
- Hydration hook defaults to 'open' for missing state

### 2. Main Panel Always Visible

**Issue:** Main panel should always be visible, regardless of state

**Solution:**
Keep existing logic for main panel:
```typescript
hydrationStatus.panels.filter(panel => panel.id === 'main' || panel.state === 'open')
```

### 3. Panel State Conflicts

**Issue:** User has panel open in two tabs, closes in one tab

**Solution:**
- Last write wins (current behavior)
- State is per-note, not per-session
- Closing in one tab affects all tabs (intentional)

### 4. Branch Data Persistence

**Issue:** If we don't delete panels, branch data might get stale

**Solution:**
- Keep existing branch data update mechanisms
- Branch loader updates content when panel is reopened
- State only controls visibility, not data freshness

### 5. Performance with Many Closed Panels

**Issue:** Database might accumulate many closed panels over time

**Solution:**
- Add cleanup job to delete closed panels older than 30 days (future enhancement)
- For now, closed panels are minimal overhead (just rows with state='closed')
- Index on state ensures fast filtering

---

## Testing Checklist

### Unit Tests (Create New)

- [ ] Test state validation in API
- [ ] Test state filtering in hydration logic
- [ ] Test backward compatibility defaults
- [ ] Test state transitions (open → closed → open)

### Integration Tests (Create New)

- [ ] Test full panel lifecycle with state tracking
- [ ] Test hydration with mixed states
- [ ] Test state updates via API
- [ ] Test migration forward/backward

### Manual Tests (Required Before Merge)

- [ ] Fresh note → Open branch → Refresh → Branch reappears
- [ ] Open branch → Close → Refresh → Branch stays closed
- [ ] Multiple branches → Mix of open/closed → Refresh → Correct restoration
- [ ] Two notes with same panel IDs → State tracked separately
- [ ] Panel reopening after close → Content still there

---

## Success Criteria

### Must Have (P0)

- [ ] Branch panels with state='open' restore on page refresh
- [ ] Branch panels with state='closed' don't restore on page refresh
- [ ] Main panel always restores (backward compatible)
- [ ] No data loss (branch content preserved even when closed)
- [ ] No breaking changes to existing functionality

### Should Have (P1)

- [ ] Debug logging at all state transition points
- [ ] API documentation updated
- [ ] Schema documentation updated
- [ ] Manual testing completed and documented

### Nice to Have (P2)

- [ ] Unit tests for new functionality
- [ ] Integration tests for state transitions
- [ ] Performance benchmarks (hydration with 100+ closed panels)

---

## Rollback Plan

If issues are found after deployment:

1. **Immediate:** Revert hydration filter change (restore line 631 to original)
   - This makes all panels behave like before (only main hydrates)
   - No data loss, just disabled feature

2. **Database:** Run down migration to remove state column
   - All panels return to previous behavior
   - No data loss (state column is additive)

3. **API:** Keep new endpoints but make state optional
   - Old code ignores state parameter
   - New code can use state if available

---

## Future Enhancements (Out of Scope)

- **Panel minimization:** Use state='minimized' to collapse panels
- **Panel grouping:** Group related panels together
- **Panel history:** Track panel open/close events over time
- **Workspace presets:** Save/restore entire canvas layouts
- **Per-user state:** Different users see different panel states (requires user_id)

---

## Files to Create/Modify

### New Files (2)

1. `migrations/032_add_panel_visibility_state.up.sql`
2. `migrations/032_add_panel_visibility_state.down.sql`

### Modified Files (5)

1. `app/api/canvas/panels/route.ts` - Add state to POST handler
2. `app/api/canvas/panels/[panelId]/route.ts` - Add state to PATCH, create state endpoint
3. `components/annotation-canvas-modern.tsx` - Update hydration filter, handleCreatePanel, handlePanelClose
4. `lib/hooks/use-canvas-hydration.ts` - Add state to panel data
5. `types/canvas-items.ts` - Add PanelState type

---

## Risks & Mitigation

### Risk 1: Migration Fails on Production

**Likelihood:** Low
**Impact:** High
**Mitigation:**
- Test migration on copy of production DB first
- Migration is reversible (DOWN script)
- Default values ensure no null columns

### Risk 2: Performance Impact from State Index

**Likelihood:** Low
**Impact:** Medium
**Mitigation:**
- Index is partial (only 'open' panels)
- Most panels are 'closed' (not indexed)
- Test with 1000+ closed panels

### Risk 3: User Confusion (Why did my panels disappear?)

**Likelihood:** Medium
**Impact:** Low
**Mitigation:**
- This is actually the desired behavior (closed panels stay closed)
- Add UI indicator showing panel is closed (future enhancement)
- Document behavior in user guide

---

## Dependencies

- ✅ Phase 1 canvas persistence (already complete)
- ✅ Panel creation/deletion hooks (already complete)
- ✅ Hydration system (already complete)
- ❌ **No Phase 2 dependencies**

---

## Timeline

**Total Estimated Time:** ~8 hours (1 day of focused work)

- Phase 1 (Database & API): 2 hours
- Phase 2 (Hydration Logic): 2 hours
- Phase 3 (Panel Lifecycle): 1 hour
- Phase 4 (Testing): 2 hours
- Phase 5 (Documentation): 1 hour

**Target Completion:** 1-2 days

---

## References

- **Problem Analysis:** `/docs/proposal/canvas_state_persistence/fixes/branch_panel_not_appearing_when_closed/BRANCH_PANEL_PERSISTENCE_STATUS.md`
- **Phase 1 Implementation:** `/docs/proposal/canvas_state_persistence/reports/IMPLEMENTATION_COMPLETE.md`
- **Phase 2 Plan:** `/docs/proposal/canvas_state_persistence/phase2-unified-canvas-plan.md`
- **Original Bug Fix:** `/docs/proposal/canvas_state_persistence/fixes/branch_panel_not_appearing_when_closed/FIX_DOCUMENTATION.md`
