# Code Changes - Branch Panel Reopen Fix

**File:** `components/annotation-canvas-modern.tsx`
**Function:** `handlePanelClose`
**Lines:** 1787-1801

---

## Change Summary

Added `REMOVE_PANEL` dispatch to synchronize `state.panels` Map with `canvasItems` array when closing panels.

---

## Code Added

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

## Full Function After Fix

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

  // ==================== FIX STARTS HERE ====================
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
  // ==================== FIX ENDS HERE ====================

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

---

## Why This Fix Works

### Before Fix:
1. Close panel → `handlePanelClose` called
2. Panel removed from `canvasItems` ✅
3. **Panel NOT removed from `state.panels`** ⚠️
4. Reopen panel → `branch-item.tsx` checks `state.panels.has(branchId)` → returns `true`
5. Early return → Panel never created ❌

### After Fix:
1. Close panel → `handlePanelClose` called
2. Panel removed from `canvasItems` ✅
3. **Panel removed from `state.panels`** ✅
4. Reopen panel → `branch-item.tsx` checks `state.panels.has(branchId)` → returns `false`
5. Proceeds to create panel → Panel appears ✅

---

## Related Code (No Changes Needed)

### branch-item.tsx (line 87-99)

This is the check that was causing the early return:

```typescript
// Check if panel already exists
if (state.panels.has(branchId)) {
  console.log(`Panel ${branchId} already exists, focusing it`)
  // Panel exists, just focus it
  const panel = state.panels.get(branchId)
  if (panel?.element) {
    panel.element.style.zIndex = String(state.panelZIndex + 1)
    dispatch({
      type: "UPDATE_PANEL_Z_INDEX",
      payload: state.panelZIndex + 1,
    })
  }
  return  // ← This was preventing panel from being created
}
```

### canvas-context.tsx (line 62-69)

The existing reducer case that handles the dispatch:

```typescript
case "REMOVE_PANEL":
  const updatedPanels = new Map(state.panels)
  updatedPanels.delete(action.payload.id)
  return {
    ...state,
    panels: updatedPanels,
    panelOrder: state.panelOrder.filter((id) => id !== action.payload.id),
  }
```

---

## Testing

### Manual Test

```
1. Open branch panel (click eye icon) → Panel appears ✅
2. Close panel (click X button) → Panel disappears ✅
3. Reopen panel (click eye icon) → Panel reappears ✅
4. Repeat steps 2-3 multiple times → Works consistently ✅
```

### Debug Query

```sql
SELECT
  created_at,
  action,
  metadata->>'panelId' as panel_id,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action IN ('panel_removed_from_state', 'create_panel_proceeding')
ORDER BY created_at DESC
LIMIT 10;
```

---

## Files Modified

1. `components/annotation-canvas-modern.tsx` - Added REMOVE_PANEL dispatch

## Files Analyzed (No Changes)

1. `components/canvas/branch-item.tsx` - Early return check
2. `components/canvas/canvas-context.tsx` - REMOVE_PANEL reducer
