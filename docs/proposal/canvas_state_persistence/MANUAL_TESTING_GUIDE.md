# Manual Testing Guide - Stage 1 Composite Keys

**Purpose**: This guide provides step-by-step instructions for manually testing the Stage 1 composite key implementation in a browser.

**Prerequisites**:
- Dev server running at http://localhost:3002
- PostgreSQL database running (docker compose up -d postgres)
- Test note available: "todo 3" (ID: `3c0cf09d-8d45-44a1-8654-9dfb12374339`)

---

## Setup

1. **Ensure services are running**:
   ```bash
   # Check PostgreSQL
   docker compose ps postgres

   # Start dev server if not already running
   npm run dev
   ```

2. **Open browser DevTools**:
   - Chrome/Edge: Press `F12` or `Cmd+Opt+I` (Mac) / `Ctrl+Shift+I` (Windows)
   - Safari: Enable Developer menu, then `Cmd+Opt+I`
   - Firefox: Press `F12` or `Cmd+Opt+I` (Mac) / `Ctrl+Shift+I` (Windows)

3. **Navigate to console tab** to see debug logs

---

## Test Case 1: Initial Panel Creation

### Steps:
1. Clear browser console (click trash icon or right-click > Clear)
2. Navigate to: http://localhost:3002/note/todo-3
3. Wait for page to fully load
4. Observe the canvas area - you should see a "Main" panel appear

### Expected Results:
- Main panel appears on canvas
- No errors in browser console
- Page loads without crashing

### Verification:
Open a new terminal and run:
```bash
# Check if main panel was created in database
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, note_id, type, title, position_x_world, position_y_world, created_at
   FROM panels
   WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339'
   AND panel_id = 'main'
   ORDER BY created_at DESC LIMIT 1;"
```

**Expected output**: One row showing the main panel with correct note_id

---

## Test Case 2: Panel Drag and Position Update

### Steps:
1. With the note still open, locate the "Main" panel
2. Click and hold on the panel header
3. Drag it to a different position on the canvas
4. Release the mouse button
5. Wait 2-3 seconds for autosave

### Expected Results:
- Panel follows your mouse as you drag
- Panel remains at new position after release
- No errors in console

### Verification:
```bash
# Check debug logs for persistence
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, metadata
   FROM debug_logs
   WHERE component = 'PanelPersistence'
   AND action IN ('persisted_to_api', 'persistence_failed')
   ORDER BY created_at DESC LIMIT 3;"
```

**Expected output**: Should show `persisted_to_api` action with panel metadata

```bash
# Check updated position in database
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, position_x_world, position_y_world, updated_at
   FROM panels
   WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339'
   AND panel_id = 'main'
   ORDER BY updated_at DESC LIMIT 1;"
```

**Expected output**: Position values should be different from initial values

---

## Test Case 3: Panel Position Persistence (Reload)

### Steps:
1. Note the current position of the Main panel (approximate visual position)
2. Press `Cmd+R` (Mac) or `Ctrl+R` (Windows) to reload the page
3. Wait for page to fully load
4. Observe where the Main panel appears

### Expected Results:
- Panel appears at the SAME position as before reload
- No errors during hydration
- Page loads successfully

### Verification:
```bash
# Check hydration debug logs
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, metadata
   FROM debug_logs
   WHERE component = 'CanvasHydration'
   AND action IN ('hydration_started', 'hydration_completed', 'applying_panel_layout')
   ORDER BY created_at DESC LIMIT 5;"
```

**Expected output**: Should show hydration cycle completing successfully

---

## Test Case 4: Multiple Panels (Branch Annotation)

### Steps:
1. With note open, select some text in the Main panel
2. Click the "Explore" or "Promote" button to create a branch annotation
3. A new panel should appear on the canvas
4. Drag the new branch panel to a different position
5. Wait 2-3 seconds

### Expected Results:
- Branch panel appears on canvas
- Both main and branch panels are visible
- Both can be dragged independently
- Positions save independently

### Verification:
```bash
# Check all panels for this note
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, note_id, type, title, position_x_world, position_y_world
   FROM panels
   WHERE note_id = '3c0cf09d-8d45-44a1-8654-9dfb12374339'
   ORDER BY created_at DESC;"
```

**Expected output**: Should show both `main` panel and branch panel (with different panel_id)

---

## Test Case 5: Cross-Note Isolation (Future Multi-Note Support)

### Steps:
1. Open a different note: http://localhost:3002/note/todo-4
2. Wait for it to load
3. Note the panel IDs (may also be "main")
4. Switch back to todo-3 tab

### Expected Results:
- Each note has its own panels
- No visual overlap or confusion between notes
- Panels from todo-4 don't appear on todo-3 canvas

### Verification:
```bash
# Check that panels are correctly associated with their notes
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, note_id, type, COUNT(*) as count
   FROM panels
   WHERE note_id IN ('3c0cf09d-8d45-44a1-8654-9dfb12374339', 'a6493035-8c93-4fa8-b2e5-5b7d915f4c44')
   GROUP BY panel_id, note_id, type
   ORDER BY note_id;"
```

**Expected output**: Each note has its own set of panels (note: todo-4's ID is `a6493035-8c93-4fa8-b2e5-5b7d915f4c44`)

---

## Debugging Failed Tests

### If panels don't appear:
1. Check browser console for JavaScript errors
2. Check network tab for failed API requests
3. Check database connection:
   ```bash
   docker compose ps postgres
   ```

### If positions don't save:
1. Check debug logs for persistence failures
2. Check that API endpoint is responding:
   ```bash
   curl -X PATCH http://localhost:3002/api/canvas/layout/3c0cf09d-8d45-44a1-8654-9dfb12374339 \
     -H "Content-Type: application/json" \
     -d '{"updates":[{"id":"main","position":{"x":100,"y":200}}]}'
   ```

### If positions don't restore on reload:
1. Check debug logs for hydration errors
2. Verify panels exist in database
3. Check that workspace API is working:
   ```bash
   curl http://localhost:3002/api/canvas/workspace/3c0cf09d-8d45-44a1-8654-9dfb12374339
   ```

---

## Success Criteria

Stage 1 is considered successful if ALL of these are true:

- ✅ Main panel appears when note is opened
- ✅ Panel positions can be changed by dragging
- ✅ Panel positions persist to database
- ✅ Panel positions are restored on page reload
- ✅ Multiple panels can coexist without conflicts
- ✅ Each note has its own isolated set of panels
- ✅ No JavaScript errors in console
- ✅ All debug logs show expected composite key format: `"noteId::panelId"`

---

## Reporting Results

After completing these tests, create a test results document:

```bash
# Create test results file
cat > docs/proposal/canvas_state_persistence/reports/2025-10-14-stage1-manual-test-results.md << 'EOF'
# Stage 1 Manual Test Results

**Date**: YYYY-MM-DD
**Tester**: [Your name]
**Browser**: [Chrome/Firefox/Safari + version]

## Test Results Summary

| Test Case | Status | Notes |
|-----------|--------|-------|
| 1. Initial Panel Creation | ✅/❌ | |
| 2. Panel Drag and Update | ✅/❌ | |
| 3. Position Persistence | ✅/❌ | |
| 4. Multiple Panels | ✅/❌ | |
| 5. Cross-Note Isolation | ✅/❌ | |

## Detailed Results

### Test Case 1: [Status]
[Describe what happened]

### Test Case 2: [Status]
[Describe what happened]

[... continue for all tests ...]

## Issues Found

[List any issues, errors, or unexpected behavior]

## Recommendations

[Any suggestions or next steps]
EOF
```

---

## Next Steps

- If all tests pass: Mark Stage 1 as complete, proceed to Stage 2 (Unified Canvas Rendering)
- If tests fail: Document failures in detail, create bug reports, and fix issues before proceeding
