# Popup Drag and Drop Feature

**Feature Slug:** `popup_drag_drop`

**Status:** 📋 PLANNING

---

## Quick Summary

Add drag-and-drop functionality to popup overlay items, allowing users to move notes and folders between popups by dragging, with multi-item support and visual feedback - matching the UX from the notes-explorer treeview.

---

## Key Documents

### Planning
- **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** - Full implementation plan with technical approach

### Supporting Files
- **[API_REQUIREMENTS.md](./supporting_files/API_REQUIREMENTS.md)** - Required bulk-move API endpoint specification

### Reports
- *(Will be created during implementation)*

---

## Prerequisites

⚠️ **CRITICAL:** The `/api/items/bulk-move` endpoint EXISTS but has SAFETY ISSUES that MUST be fixed first.

**Current Issues:**
- ❌ No transaction safety (can leave data in inconsistent state)
- ❌ Uses wrong database pool (not serverPool)
- ❌ No workspace validation
- ❌ Insufficient error tracking

**Location:** `app/api/items/bulk-move/route.ts`

See [API_REQUIREMENTS.md](./supporting_files/API_REQUIREMENTS.md) for full specification and required fixes.

---

## Feature Highlights

### What Users Will Be Able to Do

1. **Drag single items** - Click and drag any note/folder to move it
2. **Drag multiple items** - Select items with Ctrl/Cmd+Click, then drag all together
3. **Visual feedback** - See "X items" badge when dragging multiple
4. **Drop on folders** - Only folders accept drops (green highlight)
5. **Cross-popup moves** - Drag from popup A to folder in popup B
6. **Auto-refresh** - Popups automatically update after move

### Visual States

| State | Appearance |
|-------|------------|
| **Dragging** | Item shows 50% opacity |
| **Drop target** | Folder shows green background with ring |
| **Multi-drag** | Badge shows "X items" |
| **Invalid drop** | No drop allowed on non-folders or self |

---

## Implementation Phases

### Phase 0: Fix Existing API ⚠️ **REQUIRED FIRST** (CRITICAL)
- [ ] Backup existing endpoint
- [ ] Add transaction safety (BEGIN/COMMIT/ROLLBACK)
- [ ] Switch to serverPool from @/lib/db/pool
- [ ] Add workspace validation
- [ ] Add detailed success/failure tracking
- [ ] Test API thoroughly with curl
- [ ] Verify circular move validation works
- [ ] Run type-check

### Phase 1: UI State Management (Only after Phase 0 complete)
- [ ] Create backups of UI files
- [ ] Add drag state to PopupOverlay
- [ ] Integrate with existing multi-select
- [ ] Add cleanup on popup close

### Phase 2: Drag Handlers
- [ ] Implement handleDragStart (multi-item support)
- [ ] Implement handleDragOver (folder validation)
- [ ] Implement handleDragLeave
- [ ] Implement handleDragEnd
- [ ] Implement handleDrop (API integration)

### Phase 3: Visual Feedback
- [ ] Add isDragging opacity
- [ ] Add drop target highlight (green)
- [ ] Add custom drag preview ("X items")
- [ ] Add drag attributes to rows
- [ ] Implement visual priority order

### Phase 4: Parent Integration
- [ ] Add onBulkMove callback to annotation-app
- [ ] Implement safe popup refresh logic (track success/failure)
- [ ] Handle source popup updates (filter moved items)
- [ ] Clear selection after successful move

### Phase 5: Testing & Polish
- [ ] Manual testing all scenarios
- [ ] Type-check validation
- [ ] Edge case handling
- [ ] Create implementation report

---

## Reference Implementation

**Source:** `components/notes-explorer-phase1.tsx`

**Key code sections:**
- Lines 160-162: State management
- Lines 2914-2934: Drag start with multi-select
- Lines 2941-2947: Drag over validation
- Lines 2957-3025: Drop handler with API
- Lines 3086-3091: Visual feedback

**Patterns to adopt:**
- ✅ Multi-item drag if dragged item is selected
- ✅ Custom drag preview for multiple items
- ✅ Folder-only drop targets
- ✅ API call with tree refresh
- ✅ Auto-expand target folder

---

## Files to Modify

### Phase 0: API Fixes (MUST DO FIRST)
```
app/api/items/bulk-move/route.ts  (⚠️ EXISTS - needs safety fixes)
```

**Backup before editing:**
```
app/api/items/bulk-move/route.ts.backup.original
```

### Phases 1-4: UI Implementation (After API fixed)
```
components/canvas/popup-overlay.tsx
components/annotation-app.tsx
```

**Backup before editing:**
```
components/canvas/popup-overlay.tsx.backup.dragdrop
components/annotation-app.tsx.backup.dragdrop
```

---

## Risks & Mitigations

| Risk | Status | Mitigation |
|------|--------|------------|
| **API has safety issues** | ❌ CRITICAL | Fix in Phase 0 (transaction, serverPool, workspace check) |
| **Partial move failures** | ✅ PLANNED | API transaction + UI success tracking (like delete) |
| **Visual state conflicts** | ✅ RESOLVED | Clear priority: Drop target > Dragging > Selected |
| **Cross-popup complexity** | ✅ MITIGATED | Track source popup ID, safe filter pattern |
| **Drag state leaks** | ✅ MITIGATED | Cleanup in existing popup close effect |
| **Wrong items removed from UI** | ✅ PREVENTED | Only filter items that actually moved (successfullyMovedIds) |

---

## Success Criteria

### Phase 0: API Safety (MUST COMPLETE FIRST)
- [ ] API uses transaction (BEGIN/COMMIT/ROLLBACK)
- [ ] API uses serverPool (not local pool)
- [ ] API validates workspace ID
- [ ] API returns detailed success/failure tracking
- [ ] API handles circular references
- [ ] API tested with curl (all scenarios)
- [ ] Type-check passes

### Phase 1-4: UI Functional
- [ ] Single item drag works
- [ ] Multi-item drag works
- [ ] Visual feedback is clear
- [ ] Only folders accept drops
- [ ] Cannot drop on self
- [ ] API call succeeds
- [ ] Only successfully moved items removed from source popup
- [ ] Failed moves remain visible (safety)
- [ ] Popups refresh correctly

### Phase 1-4: UI Technical
- [ ] Type-check passes
- [ ] No console errors
- [ ] Works with existing multi-select
- [ ] Cleanup on popup close
- [ ] Success tracking like delete functionality

### UX
- [ ] Consistent with notes-explorer
- [ ] Drag preview is visible
- [ ] Drop target is obvious
- [ ] Error messages are helpful

---

## Questions for Product/UX

1. **Should dragging auto-expand collapsed folders?**
   - Notes-explorer does this
   - Probably yes for consistency

2. **What if target popup doesn't exist?**
   - Create and show it?
   - Or just update database silently?

3. **Should we clear selection after move?**
   - Notes-explorer does (line 3017)
   - Recommend: yes for consistency

4. **How to show partial move failures?**
   - Alert with count?
   - Toast notification?
   - Inline error message?

---

## Future Enhancements

After initial implementation:

1. **Drag to canvas** - Drag items to open on canvas
2. **Drag to create folder** - Drag over empty space
3. **Drag reordering** - Reorder within same folder
4. **Keyboard shortcuts** - Ctrl+X, Ctrl+V for move
5. **Undo/redo** - Revert move operations
6. **Batch optimization** - Improve API performance

---

## Getting Started

**For Developers:**

1. Read [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
2. Read [API_REQUIREMENTS.md](./supporting_files/API_REQUIREMENTS.md)
3. Create API endpoint first (Phase 1)
4. Create backups before editing
5. Follow CLAUDE.md conventions
6. Run type-check after changes

**For Reviewers:**

1. Check API endpoint exists
2. Test drag scenarios manually
3. Verify type-check passes
4. Check popup refresh behavior
5. Test edge cases

---

## Related Features

- **Multi-Select** (`popup_multiselect`) - Required for multi-item drag
- **Delete** (`popup_multiselect/delete`) - Similar popup refresh pattern
- **Notes Explorer** - Reference implementation source

---

## Contact

Questions? Check:
- IMPLEMENTATION_PLAN.md for technical details
- API_REQUIREMENTS.md for endpoint spec
- CLAUDE.md for project conventions
