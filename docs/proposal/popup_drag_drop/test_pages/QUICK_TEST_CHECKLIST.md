# Quick Test Checklist - Drag & Drop

**🚀 Quick Start**: http://localhost:3000

**📊 Test Data**: Run `bash docs/proposal/popup_drag_drop/test_scripts/create-test-data.sh`

---

## Critical Path (5 minutes)

### ✅ 1. Basic Single Drag
- [ ] Open "Drag Test Source" popup
- [ ] Open "Drag Test Target" popup
- [ ] Drag "Test Note 1" from Source to Target folder
- [ ] **VERIFY**: Note disappears from Source, appears in Target with correct name

### ✅ 2. Multi-Select Drag
- [ ] Ctrl/Cmd+Click to select Test Note 2 and 3
- [ ] Drag one selected note to Target folder
- [ ] **VERIFY**: Both notes move together, custom preview shows "2 items"

### ✅ 3. No Duplicates
- [ ] Drag a note back to its original folder
- [ ] **VERIFY**: Item appears only once (no duplicate)

### ✅ 4. Visual Feedback
- [ ] Drag any item
- [ ] **VERIFY**: Item has 50% opacity while dragging
- [ ] **VERIFY**: Drop target shows green highlight

### ✅ 5. Cannot Drop on Non-Folder
- [ ] Drag a note
- [ ] Hover over another note (not folder)
- [ ] **VERIFY**: No green highlight, cannot drop

---

## Full Test Matrix (30 minutes)

### Basic Operations
- [ ] 1.1 - Cannot drop on non-folder
- [ ] 1.2 - Single item cross-popup drag
- [ ] 1.3 - Drag item back (no duplicate)

### Multi-Select
- [ ] 2.1 - Select multiple items (Ctrl/Cmd+Click)
- [ ] 2.2 - Drag all selected items (shows "X items")
- [ ] 2.3 - Drag non-selected item (ignores selection)

### Visual Feedback
- [ ] 3.1 - Dragging shows 50% opacity
- [ ] 3.2 - Drop target shows green highlight
- [ ] 3.3 - Visual priority: Green > Opacity > Selected

### State Management
- [ ] 4.1 - Drag cancels when popup closes
- [ ] 4.2 - Partial failure handling (items stay if failed)
- [ ] 4.3 - Duplicate prevention (filter existing IDs)

### Edge Cases
- [ ] 5.1 - Cannot drop on self
- [ ] 5.2 - Circular reference prevented (folder into child)
- [ ] 5.3 - Drag to root level works

### API & Data
- [ ] 6.1 - API returns complete OrgItem (name, type, level, hasChildren)
- [ ] 6.2 - Transaction integrity (folder + children move together)
- [ ] 6.3 - Workspace isolation (if applicable)

### Browser Compat
- [ ] 7.1 - Chrome/Edge
- [ ] 7.2 - Firefox
- [ ] 7.3 - Safari

### Performance
- [ ] 8.1 - Large drag (50+ items) is smooth

---

## Zero Tolerance Checks

**Keep DevTools Console Open**:
- [ ] No React errors
- [ ] No JavaScript exceptions
- [ ] No network errors (except when testing failures)
- [ ] No "undefined" or "null" errors
- [ ] No duplicate key warnings

**Network Tab**:
- [ ] POST /api/items/bulk-move returns 200
- [ ] Response includes complete movedItems with all fields
- [ ] movedCount matches actual items moved

---

## Pass/Fail Criteria

**PASS**: All critical path tests (1-5) pass + No console errors
**CONDITIONAL PASS**: Minor issues documented but core functionality works
**FAIL**: Any critical test fails OR console errors present

---

## Quick Issue Report

If test fails:
1. Note test number (e.g., "Test 2.2 failed")
2. Screenshot the browser
3. Copy console errors
4. Copy Network tab response (if API related)
5. Note browser + version

---

## After Testing

**If ALL PASS**:
- Create completion report in `docs/proposal/popup_drag_drop/reports/`
- Mark feature as **COMPLETE**
- Close Phase 2 testing

**If ANY FAIL**:
- Document in `docs/proposal/popup_drag_drop/ERRORS.md`
- Create fix tasks
- Retest after fixes

---

**Estimated Time**: 5 min (critical) + 30 min (full) = 35 minutes total
