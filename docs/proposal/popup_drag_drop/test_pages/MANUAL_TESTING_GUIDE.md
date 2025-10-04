# Manual Testing Guide - Popup Drag & Drop Feature

**Date**: 2025-10-03
**Feature**: Popup overlay drag-and-drop for notes and folders
**Phase**: Phase 2 - Manual Browser Testing
**Dev Server**: http://localhost:3000

---

## Prerequisites

✅ **Environment Setup Complete**:
- Development server running on http://localhost:3000
- Database migrations applied (25/25)
- Test data created:
  - 📁 "Drag Test Source" (contains 3 test notes)
  - 📁 "Drag Test Target" (empty, has 1 nested folder)
- Application compiles without errors (1356 modules)

---

## Test Data Structure

```
📁 Drag Test Source
  ├─ 📄 Test Note 1
  ├─ 📄 Test Note 2
  └─ 📄 Test Note 3

📁 Drag Test Target
  └─ 📁 Nested Folder (empty)
```

**How to Access**:
1. Open http://localhost:3000
2. Navigate to notes explorer/sidebar
3. Find "Drag Test Source" and "Drag Test Target" folders
4. Right-click or use eye icon to open as popup overlays

---

## Testing Phases

### Phase 1: Basic Drag Operations (Foundation)
### Phase 2: Multi-Select Drag (Complex)
### Phase 3: Visual Feedback (UX)
### Phase 4: State Management (Safety)
### Phase 5: Edge Cases (Robustness)
### Phase 6: API Integration (Data Integrity)

---

## PHASE 1: Basic Drag Operations

### Test 1.1: Single Item Drag to Folder (Same Popup)

**Setup**:
1. Open "Drag Test Source" as popup
2. Verify you see Test Note 1, 2, 3

**Steps**:
1. Click and hold on "Test Note 1"
2. Drag towards "Test Note 2" (non-folder)
3. Observe: Should NOT allow drop (no green highlight)
4. Release mouse (no action should occur)

**Expected Behavior**:
- ❌ No drop allowed on non-folder items
- ❌ No green highlight on Test Note 2
- ✅ Note remains in original position

**Pass Criteria**:
- [  ] Cannot drop note on another note
- [  ] No visual feedback when hovering over non-folder
- [  ] No API call made (check Network tab)

---

### Test 1.2: Single Item Drag to Folder (Cross-Popup)

**Setup**:
1. Open "Drag Test Source" as Popup A
2. Open "Drag Test Target" as Popup B
3. Position popups side-by-side

**Steps**:
1. Click and hold on "Test Note 1" in Popup A
2. Drag to "Drag Test Target" folder in Popup B
3. Observe: Green highlight appears on target folder
4. Release mouse to drop

**Expected Behavior**:
- ✅ "Test Note 1" disappears from Popup A immediately
- ✅ "Test Note 1" appears in Popup B immediately (with correct name and icon)
- ✅ Item count updates in both popups
- ✅ No console errors

**Pass Criteria**:
- [  ] Item removed from source popup (Popup A)
- [  ] Item added to target popup (Popup B)
- [  ] Item displays with correct name ("Test Note 1")
- [  ] Item displays with correct icon (📄)
- [  ] No browser console errors
- [  ] No blank rows in target popup

---

### Test 1.3: Drag Item Back (Reverse Operation)

**Setup**:
1. After Test 1.2, "Test Note 1" should be in Popup B
2. Both Popup A and Popup B still open

**Steps**:
1. Drag "Test Note 1" from Popup B back to "Drag Test Source" folder
2. Drop onto source folder

**Expected Behavior**:
- ✅ "Test Note 1" removed from Popup B
- ✅ "Test Note 1" appears back in Popup A
- ✅ **No duplicate** (item should appear only once)
- ✅ Item displays correctly (name, icon)

**Pass Criteria**:
- [  ] Item returns to original popup
- [  ] No duplicate entries (check carefully!)
- [  ] Item displays with correct data
- [  ] API call succeeds (check Network tab status 200)

---

## PHASE 2: Multi-Select Drag

### Test 2.1: Select Multiple Items

**Setup**:
1. Open "Drag Test Source" popup
2. Verify Test Note 1, 2, 3 are visible

**Steps**:
1. Click on "Test Note 1" (should highlight with indigo background)
2. Hold Ctrl (Windows/Linux) or Cmd (Mac)
3. Click on "Test Note 2" (both should now be highlighted)
4. Click on "Test Note 3" (all three should be highlighted)

**Expected Behavior**:
- ✅ All three notes show indigo highlight (selected state)
- ✅ Multiple items can be selected simultaneously

**Pass Criteria**:
- [  ] Can select multiple items with Ctrl/Cmd+Click
- [  ] All selected items show visual highlight (indigo background)
- [  ] Selection persists until clicked elsewhere

---

### Test 2.2: Drag Multiple Selected Items

**Setup**:
1. After Test 2.1, all three notes should be selected
2. Open "Drag Test Target" popup

**Steps**:
1. Click and drag "Test Note 2" (one of the selected items)
2. Observe custom drag preview showing "3 items"
3. Drag to "Drag Test Target" folder
4. Release to drop

**Expected Behavior**:
- ✅ All 3 selected notes disappear from source popup
- ✅ All 3 notes appear in target popup
- ✅ All notes display correctly (names, icons)
- ✅ Custom drag preview shows "3 items" during drag

**Pass Criteria**:
- [  ] Dragging one selected item drags all selected items
- [  ] Custom drag preview displays "3 items"
- [  ] All 3 items removed from source
- [  ] All 3 items added to target (no blanks, no duplicates)
- [  ] Each item displays with correct name and icon

---

### Test 2.3: Drag Non-Selected Item (Deselect Behavior)

**Setup**:
1. Create fresh test notes (or move existing ones back)
2. Select "Test Note 1" and "Test Note 2" (Ctrl/Cmd+Click)

**Steps**:
1. Click and drag "Test Note 3" (NOT selected)
2. Observe: Only "Test Note 3" should drag (not 1 and 2)

**Expected Behavior**:
- ✅ Only the dragged item moves (not selected items)
- ✅ Drag preview shows "1 item" or no count (single item)

**Pass Criteria**:
- [  ] Only dragged item moves (selection ignored)
- [  ] Previous selection cleared or ignored
- [  ] Correct single-item behavior

---

## PHASE 3: Visual Feedback

### Test 3.1: Drag State Opacity

**Setup**:
1. Open source popup with test notes

**Steps**:
1. Click and hold on any test note
2. Observe the note's appearance while dragging

**Expected Behavior**:
- ✅ Dragged item shows 50% opacity (semi-transparent)
- ✅ Item returns to full opacity after drop

**Pass Criteria**:
- [  ] Dragging item has reduced opacity (50%)
- [  ] Opacity returns to normal after drop/cancel

---

### Test 3.2: Drop Target Highlight

**Setup**:
1. Open source and target popups

**Steps**:
1. Drag a note over target folder
2. Observe folder highlight when hovering
3. Move mouse away from folder

**Expected Behavior**:
- ✅ Folder shows green background with ring when hovered during drag
- ✅ Green highlight disappears when mouse leaves
- ✅ Green highlight disappears after drop

**Pass Criteria**:
- [  ] Folder highlights green on drag hover
- [  ] Highlight has ring/border effect
- [  ] Highlight removed when not hovering
- [  ] Highlight removed after successful drop

---

### Test 3.3: Visual Priority Order

**Setup**:
1. Open popup with test notes
2. Select Test Note 1 (indigo highlight)

**Steps**:
1. Drag Test Note 1 (selected item)
2. While dragging, observe visual state
3. Drag over a folder (drop target)

**Expected State Priority** (from highest to lowest):
1. **Drop Target** → Green background (highest priority)
2. **Dragging** → 50% opacity (second)
3. **Selected** → Indigo background (third)
4. **Default** → Gray text (lowest)

**Expected Behavior**:
- While dragging selected item: Shows opacity (dragging > selected)
- When dragging over folder: Shows green (drop target > dragging)

**Pass Criteria**:
- [  ] Drop target green overrides all other states
- [  ] Dragging opacity overrides selected state
- [  ] Visual priority follows documented order

---

## PHASE 4: State Management

### Test 4.1: Cleanup on Popup Close

**Setup**:
1. Open source popup
2. Begin dragging a note (click and hold)

**Steps**:
1. While still holding mouse button (mid-drag)
2. Press Escape or click popup close button
3. Observe drag state

**Expected Behavior**:
- ✅ Drag operation cancels
- ✅ Drag state cleared (no orphaned state)
- ✅ No console errors

**Pass Criteria**:
- [  ] Drag cancels when popup closes
- [  ] No visual artifacts remaining
- [  ] No JavaScript errors in console

---

### Test 4.2: Partial Failure Handling

**Setup**:
1. This test requires simulating API failure (see Network tab throttling)
2. Or test with invalid folder ID

**Steps**:
1. Attempt to drag note to invalid target
2. Or simulate network error
3. Observe UI response

**Expected Behavior**:
- ✅ Failed items remain in source popup
- ✅ Successfully moved items removed from source
- ✅ User sees alert or notification of failure
- ✅ No data loss (items not lost)

**Pass Criteria**:
- [  ] Failed items stay visible in source
- [  ] User notified of failure
- [  ] No data corruption
- [  ] Can retry operation

**Note**: This may require DevTools network throttling to test properly

---

### Test 4.3: Duplicate Prevention

**Setup**:
1. Move Test Note 1 to target folder
2. Target popup should show Test Note 1
3. Move Test Note 1 back to source
4. Now move it to target again (same folder it's already in)

**Steps**:
1. Drag Test Note 1 (from source after moving back)
2. Drop onto target folder (where it already exists)

**Expected Behavior**:
- ✅ API should skip (already in target folder)
- ✅ Item should NOT duplicate in target popup
- ✅ Only one copy of item visible

**Pass Criteria**:
- [  ] No duplicate entries in target popup
- [  ] API response includes "already in target folder" skip reason
- [  ] UI remains consistent

---

## PHASE 5: Edge Cases

### Test 5.1: Cannot Drop Item on Itself

**Setup**:
1. Open popup with a folder item visible

**Steps**:
1. Attempt to drag the folder onto itself
2. Observe behavior

**Expected Behavior**:
- ✅ Drop not allowed (validation prevents it)
- ✅ No API call made (prevented at UI or API level)

**Pass Criteria**:
- [  ] Cannot drop item on itself
- [  ] No errors occur
- [  ] Item remains in original position

---

### Test 5.2: Circular Reference Prevention (Folder into Descendant)

**Setup**:
1. Create folder structure: Parent Folder → Child Folder
2. Open both as popups

**Steps**:
1. Attempt to drag Parent Folder into Child Folder
2. Observe behavior

**Expected Behavior**:
- ✅ API prevents circular reference
- ✅ Item not moved
- ✅ User sees error message

**Pass Criteria**:
- [  ] API rejects circular move
- [  ] Folder remains in original location
- [  ] Error message displayed

**Note**: This test requires creating nested folder structure first

---

### Test 5.3: Drag to Root Level

**Setup**:
1. Move Test Note 1 into a subfolder
2. Open root-level popup (no parent)

**Steps**:
1. Drag Test Note 1 to root-level folder
2. Drop to move it to top level

**Expected Behavior**:
- ✅ Item moves to root successfully
- ✅ Item's parent_id becomes null
- ✅ Item displays correctly in root

**Pass Criteria**:
- [  ] Can move items to root level
- [  ] Database parent_id is null
- [  ] Path updated correctly

---

## PHASE 6: API Integration & Data Integrity

### Test 6.1: Database Verification

**Setup**:
1. Open browser DevTools Network tab
2. Move Test Note 1 from source to target

**Steps**:
1. Perform drag-drop
2. Check Network tab for POST to `/api/items/bulk-move`
3. Verify response payload
4. Check database directly (optional)

**Expected API Response**:
```json
{
  "success": true,
  "movedCount": 1,
  "skippedCount": 0,
  "movedItems": [{
    "id": "...",
    "name": "Test Note 1",
    "type": "note",
    "parentId": "...",
    "path": "...",
    "level": 2,
    "hasChildren": false,
    "icon": null,
    "color": null
    // ... all OrgItem fields
  }],
  "skippedItems": []
}
```

**Pass Criteria**:
- [  ] API responds with 200 OK
- [  ] Response includes complete movedItems array
- [  ] Each item has all required OrgItem fields (name, type, level, hasChildren)
- [  ] movedCount matches actual items moved
- [  ] skippedCount is 0 (or appropriate)

---

### Test 6.2: Transaction Integrity

**Setup**:
1. Move a folder with children (nested items)

**Steps**:
1. Drag a folder that contains notes to a new location
2. Verify all children move with folder

**Expected Behavior**:
- ✅ Folder and all children paths updated in ONE transaction
- ✅ All children remain accessible
- ✅ No orphaned items

**Pass Criteria**:
- [  ] Folder moves successfully
- [  ] All child items' paths updated
- [  ] Can access children after move
- [  ] Database transaction succeeded (all or nothing)

---

### Test 6.3: Workspace Isolation

**Setup**:
1. This test requires multiple workspaces (may not be applicable)

**Expected Behavior**:
- ✅ Cannot move items across workspace boundaries
- ✅ API validates workspace ID

**Pass Criteria**:
- [  ] Cross-workspace moves rejected
- [  ] Workspace validation enforced

**Note**: May not be testable if multi-workspace not implemented

---

## Browser Compatibility Testing

### Test 7.1: Chrome/Edge (Chromium)

**Steps**:
1. Run all above tests in Chrome or Edge
2. Note any issues

**Pass Criteria**:
- [  ] All tests pass in Chrome
- [  ] All tests pass in Edge

---

### Test 7.2: Firefox

**Steps**:
1. Run all above tests in Firefox
2. Note any browser-specific issues

**Pass Criteria**:
- [  ] All tests pass in Firefox
- [  ] Drag-drop API works correctly

---

### Test 7.3: Safari (macOS only)

**Steps**:
1. Run all above tests in Safari
2. Note any WebKit-specific issues

**Pass Criteria**:
- [  ] All tests pass in Safari
- [  ] No rendering issues

---

## Performance Testing

### Test 8.1: Large Number of Items

**Setup**:
1. Create folder with 50+ notes
2. Select all 50 notes

**Steps**:
1. Drag all 50 notes to target folder
2. Observe performance

**Expected Behavior**:
- ✅ Drag operation completes in < 2 seconds
- ✅ UI remains responsive
- ✅ No lag or jank

**Pass Criteria**:
- [  ] Drag operation is smooth
- [  ] API call completes reasonably fast
- [  ] No UI freezing

---

## Console Error Monitoring

**Throughout all tests**:
1. Keep browser DevTools console open
2. Monitor for any errors or warnings
3. Note any console output

**Zero Tolerance Errors**:
- ❌ React errors (key warnings, render errors)
- ❌ JavaScript exceptions
- ❌ Network errors (unless testing failure cases)
- ❌ Type errors or undefined errors

**Pass Criteria**:
- [  ] No console errors during any test
- [  ] No React warnings
- [  ] No uncaught exceptions

---

## Summary Checklist

After completing all tests, verify:

**Core Functionality**:
- [  ] Single item drag works
- [  ] Multi-item drag works
- [  ] Cross-popup drag works
- [  ] Items display with correct data (name, icon, type)

**Visual Feedback**:
- [  ] Dragging opacity (50%)
- [  ] Drop target highlight (green)
- [  ] Custom multi-item preview ("X items")
- [  ] Visual priority order correct

**State Management**:
- [  ] Source popup updates (items removed)
- [  ] Target popup updates (items added)
- [  ] No duplicates
- [  ] Cleanup on popup close

**Safety**:
- [  ] Cannot drop on non-folders
- [  ] Cannot drop on self
- [  ] Circular reference prevented
- [  ] Workspace isolation enforced

**Data Integrity**:
- [  ] API returns complete OrgItem data
- [  ] Database updated correctly
- [  ] Transaction integrity maintained
- [  ] No data loss on failure

**Performance**:
- [  ] No console errors
- [  ] UI remains responsive
- [  ] No memory leaks (test with long session)

---

## Reporting Issues

If any test fails:

1. **Document**:
   - Test number and name
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser and version
   - Screenshot or video if applicable

2. **Console Output**:
   - Copy any console errors
   - Copy Network tab response (if API related)

3. **Database State**:
   - Check if database was corrupted
   - Note any orphaned items

4. **Create Issue**:
   - Add to `docs/proposal/popup_drag_drop/ERRORS.md`
   - Include all above information

---

## Test Completion Report Template

```markdown
# Test Results - [Date]

**Tester**: [Name]
**Browser**: [Chrome/Firefox/Safari + Version]
**Total Tests**: 30+
**Passed**: X
**Failed**: Y
**Skipped**: Z

## Failed Tests
1. Test X.Y: [Name]
   - Issue: [Description]
   - Steps: [Reproduction]
   - Evidence: [Screenshot/logs]

## Notes
- [Any observations]
- [Performance notes]
- [Suggestions]

## Overall Assessment
[PASS / FAIL / NEEDS FIXES]
```

---

**Testing Time Estimate**: 45-60 minutes for thorough testing
**Priority**: HIGH - Feature is code-complete pending manual verification
**Blocking**: Yes - Must pass before marking feature complete
