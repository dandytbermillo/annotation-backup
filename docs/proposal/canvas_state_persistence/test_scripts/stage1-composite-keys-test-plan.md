# Stage 1 Composite Keys - Test Plan

**Date**: 2025-10-14
**Purpose**: Verify that composite keys (`noteId::panelId`) are correctly implemented and used throughout the panel persistence system.

---

## Test Environment

- **Server**: http://localhost:3002
- **Database**: annotation_dev (PostgreSQL)
- **Test Note**: todo-3 (ID: `3c0cf09d-8d45-44a1-8654-9dfb12374339`)

---

## Pre-Test Verification

### 1. Code Review Checklist
- [x] `lib/canvas/composite-id.ts` - Helper functions exist
- [x] `use-panel-persistence.ts` - Accepts `storeKey` parameter
- [x] `use-canvas-hydration.ts` - Generates composite keys
- [x] `canvas-panel.tsx:1955` - Passes `storeKey` to `persistPanelUpdate()`
- [x] `annotation-canvas-modern.tsx:335` - Passes `storeKey` to `persistPanelCreate()` (main panel)
- [x] `annotation-canvas-modern.tsx:1264` - Passes `storeKey` to `persistPanelCreate()` (new panels)
- [x] `npm run test:composite-keys` — Static regression suite passes (no plain `panelId` access)

### 2. Database State Before Testing
```sql
-- Check existing panels for test note
SELECT panel_id, note_id, type, title, position_x_world, position_y_world
FROM panels
WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339';

-- Clear debug logs for clean test
DELETE FROM debug_logs WHERE created_at < NOW() - INTERVAL '1 hour';
```

---

## Test Cases

### Test Case 1: Initial Panel Creation
**Objective**: Verify that new panels are created with composite keys.

**Steps**:
1. Navigate to http://localhost:3002/note/todo-3
2. Wait for page to load completely
3. Open browser DevTools Console
4. Check for "main" panel creation

**Expected Results**:
- Debug log should show: `PanelPersistence - attempting_panel_create` with composite key
- DataStore should contain entry with key: `3c0cf09d-8d45-44a1-8654-9dfb12374339::main`
- Database `panels` table should have entry with `panel_id='main'` and `note_id='3c0cf09d-8d45-44a1-8654-9dfb12374339'`

**Verification Queries**:
```sql
-- Check debug logs
SELECT action, metadata
FROM debug_logs
WHERE component = 'PanelPersistence'
  AND action = 'attempting_panel_create'
ORDER BY created_at DESC LIMIT 5;

-- Check panels table
SELECT panel_id, note_id, type, position_x_world, position_y_world
FROM panels
WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339'
  AND panel_id = 'main';
```

---

### Test Case 2: Panel Position Update
**Objective**: Verify that panel drag operations use composite keys for persistence.

**Steps**:
1. With note open, drag the "main" panel to a new position
2. Release the panel (triggering save)
3. Wait 2 seconds for persistence to complete
4. Check debug logs

**Expected Results**:
- Debug log should show: `PanelPersistence - persisted_to_api` with panelId and noteId
- StateTransaction should update stores using composite key `3c0cf09d-8d45-44a1-8654-9dfb12374339::main`
- Database should reflect new position in world coordinates

**Verification Queries**:
```sql
-- Check persistence logs
SELECT action, metadata
FROM debug_logs
WHERE component = 'PanelPersistence'
  AND action IN ('persisted_to_api', 'persistence_failed')
ORDER BY created_at DESC LIMIT 5;

-- Check updated position
SELECT panel_id, position_x_world, position_y_world, updated_at
FROM panels
WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339'
  AND panel_id = 'main'
ORDER BY updated_at DESC LIMIT 1;
```

---

### Test Case 3: Panel Hydration on Reload
**Objective**: Verify that panels are hydrated with composite keys on page reload.

**Steps**:
1. Note the current position of the main panel
2. Refresh the page (Cmd+R / Ctrl+R)
3. Wait for page to load
4. Verify panel appears at the same position

**Expected Results**:
- Debug log should show: `CanvasHydration - hydration_started` and `hydration_completed`
- `applyPanelLayout()` should generate composite key using `makePanelKey(noteId, panelId)`
- DataStore should be populated with composite keys
- Panel should render at the saved position

**Verification Queries**:
```sql
-- Check hydration logs
SELECT action, metadata
FROM debug_logs
WHERE component = 'CanvasHydration'
  AND action IN ('hydration_started', 'hydration_completed', 'applying_panel_layout')
ORDER BY created_at DESC LIMIT 5;
```

---

### Test Case 4: Multiple Panels with Composite Keys
**Objective**: Verify that multiple panels on the same note use distinct composite keys.

**Steps**:
1. With note open, create a branch annotation panel
2. Drag both the main panel and branch panel
3. Check that both persist correctly

**Expected Results**:
- DataStore should contain two entries:
  - `3c0cf09d-8d45-44a1-8654-9dfb12374339::main`
  - `3c0cf09d-8d45-44a1-8654-9dfb12374339::<branch-panel-id>`
- Database should have two distinct panel records
- No key collisions or overwrites

**Verification Queries**:
```sql
-- Check all panels for this note
SELECT panel_id, note_id, type, position_x_world, position_y_world
FROM panels
WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339'
ORDER BY created_at DESC;
```

---

### Test Case 5: Backward Compatibility
**Objective**: Verify that the system handles missing `storeKey` gracefully (fallback to plain panelId).

**Steps**:
1. Check `use-panel-persistence.ts` line 67: `const key = storeKey || panelId`
2. Verify that if `storeKey` is not provided, it falls back to `panelId`

**Expected Results**:
- If caller doesn't provide `storeKey`, system should still work using plain `panelId`
- No runtime errors or crashes

---

## Success Criteria

Stage 1 is considered successful if:

- [ ] All panels are created with composite keys passed to persistence hooks
- [ ] Panel drag operations use composite keys in StateTransaction
- [ ] Database updates succeed with correct noteId and panelId
- [ ] Page reload restores panels to correct positions
- [ ] Debug logs confirm composite key usage throughout the flow
- [ ] No key collisions occur between panels on the same note
- [ ] No regression in single-note functionality

---

## Failure Scenarios

If any of these occur, Stage 1 has failed:

- Panels persist using plain IDs instead of composite keys
- StateTransaction updates wrong stores due to key mismatch
- Panel positions are lost on reload
- Multiple panels overwrite each other's data
- Runtime errors related to key format
- Database records missing noteId or panelId

---

## Next Steps After Testing

- If tests pass: Document results and proceed to Stage 2 (Unified Canvas Rendering)
- If tests fail: Document failures, root cause analysis, and fix before proceeding
