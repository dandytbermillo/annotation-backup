# Fix: Branch Panel Not Appearing After Close and Reopen

**Date:** 2025-10-20
**Issue:** Closed branch panels do not reappear when reopened via eye icon in branches dropdown
**Status:** ✅ FIXED
**Mode:** Option A (Plain Mode - Offline, no Yjs)

---

## Summary

When users closed a branch panel by clicking the X button and then tried to reopen it by clicking the eye icon in the branches dropdown, the panel would not appear. The root cause was that the panel was being removed from `canvasItems` (UI state) but NOT from `state.panels` Map, causing the early return check in `branch-item.tsx` to incorrectly think the panel still exists.

---

## Root Cause Analysis

### The Problem

The system maintains **two separate sources of panel state**:

1. **`canvasItems`** (array in `annotation-canvas-modern.tsx`) - Controls which panels are rendered in the UI
2. **`state.panels`** (Map in `canvas-context.tsx`) - Legacy state for panel tracking, used by `branch-item.tsx` to check if a panel exists

When a panel was closed via the X button:
- ✅ Panel was removed from `canvasItems` → Panel disappeared from UI
- ❌ Panel was NOT removed from `state.panels` → Panel entry remained in Map

When attempting to reopen the panel via eye icon:
- `branch-item.tsx` checked `state.panels.has(branchId)` (line 87)
- Check returned `true` (panel still in Map!)
- Early return prevented panel creation
- Result: Panel never appeared

### Evidence from Debug Logs

Debug logs confirmed the issue:

**Panel close logs showed:**
```
2025-10-20 01:57:24 | panel_close_start         | 17c43e8c-... | canvasItemsCount: 3
2025-10-20 01:57:24 | panel_removed_from_items  | 17c43e8c-... | Removed from canvasItems
2025-10-20 01:57:24 | panel_close_items_updated | 17c43e8c-... | beforeCount: 3, afterCount: 2
```

**Panel reopen attempts showed:**
```
(NO LOGS - handleCreatePanel was never called!)
```

This confirmed that `branch-item.tsx` was returning early without calling `handleCreatePanel`.

---

## The Fix

### Solution

Dispatch a `REMOVE_PANEL` action to remove the panel from `state.panels` Map when closing the panel, ensuring both state sources are synchronized.

### Code Changes

**File:** `/Users/dandy/Downloads/annotation_project/annotation-backup/components/annotation-canvas-modern.tsx`

**Function:** `handlePanelClose` (lines 1728-1815)

**Change:** Added dispatch call to remove panel from `state.panels` Map

```typescript
const handlePanelClose = (panelId: string, panelNoteId?: string) => {
  let storeKeyToDelete: string | undefined

  debugLog({
    component: 'AnnotationCanvas',
    action: 'panel_close_start',
    metadata: {
      panelId,
      panelNoteId,
      currentNoteId: noteId,
      canvasItemsCount: canvasItems.length
    },
    content_preview: `Closing panel ${panelId} (note: ${panelNoteId || noteId})`
  })

  setCanvasItems(prev => {
    const filtered = prev.filter(item => {
      if (isPanel(item) && item.panelId === panelId) {
        const itemNoteId = getItemNoteId(item) || panelNoteId
        if (!panelNoteId || itemNoteId === panelNoteId) {
          storeKeyToDelete = item.storeKey ?? (itemNoteId ? ensurePanelKey(itemNoteId, panelId) : undefined)

          debugLog({
            component: 'AnnotationCanvas',
            action: 'panel_removed_from_items',
            metadata: {
              panelId,
              itemNoteId,
              storeKey: item.storeKey,
              storeKeyToDelete,
              position: item.position
            },
            content_preview: `Removed panel ${panelId} from canvasItems`
          })

          return false
        }
      }
      return true
    })

    debugLog({
      component: 'AnnotationCanvas',
      action: 'panel_close_items_updated',
      metadata: {
        panelId,
        beforeCount: prev.length,
        afterCount: filtered.length,
        removedCount: prev.length - filtered.length
      },
      content_preview: `canvasItems: ${prev.length} → ${filtered.length}`
    })

    return filtered
  })

  const targetNoteId = panelNoteId || noteId
  const storeKey = storeKeyToDelete ?? ensurePanelKey(targetNoteId, panelId)

  // CRITICAL: Also remove panel from state.panels Map so it can be reopened later
  dispatch({
    type: 'REMOVE_PANEL',
    payload: { id: panelId }
  })

  debugLog({
    component: 'AnnotationCanvas',
    action: 'panel_removed_from_state',
    metadata: {
      panelId,
      noteId: targetNoteId
    },
    content_preview: `Removed panel ${panelId} from state.panels Map`
  })

  // Persist panel deletion to database
  persistPanelDelete(panelId, storeKey).catch(err => {
    debugLog({
      component: 'AnnotationCanvas',
      action: 'panel_delete_persist_failed',
      metadata: {
        panelId,
        noteId: targetNoteId,
        error: err instanceof Error ? err.message : 'Unknown error'
      }
    })
  })
}
```

**Exact lines added (1787-1801):**

```typescript
// CRITICAL: Also remove panel from state.panels Map so it can be reopened later
dispatch({
  type: 'REMOVE_PANEL',
  payload: { id: panelId }
})

debugLog({
  component: 'AnnotationCanvas',
  action: 'panel_removed_from_state',
  metadata: {
    panelId,
    noteId: targetNoteId
  },
  content_preview: `Removed panel ${panelId} from state.panels Map`
})
```

---

## How the Fix Works

### Before Fix:

1. User closes panel → `handlePanelClose` called
2. Panel removed from `canvasItems` only
3. Panel removed from database
4. `state.panels` Map still contains panel entry ⚠️
5. User clicks eye icon → `branch-item.tsx` checks `state.panels.has(branchId)`
6. Check returns `true` → Early return
7. Panel never created → **BUG!**

### After Fix:

1. User closes panel → `handlePanelClose` called
2. Panel removed from `canvasItems`
3. **Panel removed from `state.panels` Map** ✅
4. Panel removed from database
5. User clicks eye icon → `branch-item.tsx` checks `state.panels.has(branchId)`
6. Check returns `false` → Proceeds to create panel
7. `handleCreatePanel` called → Panel appears → **FIXED!**

---

## Affected Files

### Modified Files

1. **`/Users/dandy/Downloads/annotation_project/annotation-backup/components/annotation-canvas-modern.tsx`**
   - **Lines modified:** 1787-1801 (added dispatch call)
   - **Function:** `handlePanelClose`
   - **Change:** Added `REMOVE_PANEL` dispatch to remove panel from `state.panels` Map

### Related Files (No Changes)

1. **`/Users/dandy/Downloads/annotation_project/annotation-backup/components/canvas/branch-item.tsx`**
   - **Line 87:** Early return check that was causing the issue
   - **No changes needed** - fix addresses the root cause in `handlePanelClose`

2. **`/Users/dandy/Downloads/annotation_project/annotation-backup/components/canvas/canvas-context.tsx`**
   - **Lines 62-69:** `REMOVE_PANEL` reducer case (already existed)
   - **No changes needed** - just utilized existing action

---

## Testing

### Test Procedure

1. **Open a branch panel**
   - Click eye icon in branches dropdown
   - ✅ Verify panel appears

2. **Close the panel**
   - Click X button on panel header
   - ✅ Verify panel disappears

3. **Reopen the panel**
   - Click eye icon again in branches dropdown
   - ✅ Verify panel reappears

4. **Repeat multiple times**
   - Close and reopen same panel multiple times
   - ✅ Verify panel consistently reappears

### Test Results

**Date Tested:** 2025-10-20
**Result:** ✅ PASS
**Notes:** Branch panels now correctly reappear after being closed and reopened via eye icon.

---

## Debug Logging Added

The fix also added comprehensive debug logging to trace the panel lifecycle:

### Panel Close Logs

- `panel_close_start` - When `handlePanelClose` is called
- `panel_removed_from_items` - When panel is removed from `canvasItems` array
- `panel_close_items_updated` - After `canvasItems` state update
- `panel_removed_from_state` - When panel is removed from `state.panels` Map

### Panel Create Logs

- `create_panel_check_existing` - When checking if panel already exists
- `create_panel_early_return` - If panel exists and creation is skipped
- `create_panel_proceeding` - If panel doesn't exist and creation proceeds

### SQL Query for Verification

```sql
-- Check panel close/reopen lifecycle
SELECT
  created_at,
  action,
  metadata->>'panelId' as panel_id,
  metadata->>'beforeCount' as before_count,
  metadata->>'afterCount' as after_count,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action IN ('panel_close_start', 'panel_removed_from_items',
                 'panel_close_items_updated', 'panel_removed_from_state',
                 'create_panel_check_existing', 'create_panel_proceeding')
ORDER BY created_at DESC
LIMIT 20;
```

---

## Related Issues

### Why Both `canvasItems` and `state.panels` Exist

This dual-state pattern exists for legacy reasons:

- **`canvasItems`** - Modern approach (used by `annotation-canvas-modern.tsx`)
- **`state.panels`** - Legacy approach (still used by `branch-item.tsx`)

**Future Refactoring Opportunity:**
Consider consolidating to a single source of truth to prevent similar synchronization issues.

### Similar Pattern in Panel Creation

When panels are created, they are added to both:
1. `canvasItems` via `setCanvasItems` (line 1922-1931)
2. `state.panels` via `ADD_PANEL` dispatch (in `branch-item.tsx` line 324-330)

The fix ensures panel deletion follows the same dual-update pattern.

---

## Branch Data in dataStore

**Important Note:** This fix does NOT affect branch data in the dataStore.

When a panel is closed:
- ✅ Panel removed from `canvasItems` (UI state)
- ✅ Panel removed from `state.panels` (legacy state)
- ✅ Panel deleted from database
- ❌ Branch data **NOT removed** from dataStore (intentional - allows content to persist)

This is correct behavior because:
- Branch content should persist even when panel is closed
- When panel is reopened, it should show the same content
- `branch-item.tsx` lines 103-168 handle loading missing branch data from database if needed

---

## Verification Commands

### Type Check
```bash
npm run type-check
```

**Expected:** No new TypeScript errors (pre-existing errors unrelated to this fix)

### Database Query
```bash
docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d annotation_dev << 'EOF'
SELECT
  created_at,
  action,
  metadata->>'panelId' as panel_id,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action='panel_removed_from_state'
ORDER BY created_at DESC
LIMIT 10;
EOF
```

**Expected:** Logs showing panels being removed from state when closed

---

## Acceptance Criteria

- [x] Branch panels can be opened via eye icon
- [x] Branch panels can be closed via X button
- [x] Closed branch panels can be reopened via eye icon
- [x] Panels can be closed/reopened multiple times without issues
- [x] Panel content persists across close/reopen cycles
- [x] Connection lines update correctly when panels reappear
- [x] Debug logs capture the full panel lifecycle
- [x] No TypeScript errors introduced

---

## Lessons Learned

1. **Dual state sources require synchronized updates** - When state is duplicated across `canvasItems` and `state.panels`, both must be updated consistently.

2. **Debug logging is essential for distributed state** - Without debug logs, it was impossible to see that `handleCreatePanel` was never being called.

3. **Early returns hide bugs** - The early return in `branch-item.tsx` line 87 masked the root cause. Debug logging revealed it.

4. **Test the full lifecycle** - Testing only "open panel" wouldn't catch this bug. Testing "open → close → reopen" exposed it.

---

## Future Improvements

1. **Consolidate panel state** - Remove dual-state pattern by migrating `branch-item.tsx` to use `canvasItems` directly instead of `state.panels`.

2. **Add integration tests** - Add automated tests for panel lifecycle (create, close, reopen).

3. **Enforce state synchronization** - Add development-mode checks to detect when `canvasItems` and `state.panels` are out of sync.

---

## References

- **Issue conversation:** Summary section "## 7. Pending Tasks" item 1
- **Debug logs location:** `debug_logs` table, component='AnnotationCanvas'
- **Related fixes:** Connection line fixes (storeKey-based DOM queries)
- **Documentation:** `/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/canvas_state_persistence/fixes/branch_panel_not_appearing_when_closed/`
