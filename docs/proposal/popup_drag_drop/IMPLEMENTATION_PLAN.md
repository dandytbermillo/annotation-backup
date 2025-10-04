# Feature: Popup Overlay Drag and Drop (popup_drag_drop)

**Feature Slug:** `popup_drag_drop`

**Created:** 2025-10-03

**Status:** Planning

---

## Overview

Add drag and drop functionality to popup overlay items (notes/folders), allowing users to drag items from one popup/folder to another, similar to the existing implementation in `notes-explorer-phase1.tsx`.

---

## Goals

1. **Drag items within and between popups** - Move notes/folders by dragging
2. **Multi-item drag support** - Drag all selected items together
3. **Visual drag feedback** - Custom drag preview showing item count
4. **Folder-only drop targets** - Only folders accept drops
5. **API integration** - Use `/api/items/bulk-move` endpoint
6. **Tree consistency** - Update both source and target popups after move
7. **Integrate with multi-select** - Work seamlessly with existing selection

---

## Scope

### In Scope
- ✅ Drag state management (per popup or global)
- ✅ Drag start/end/over/leave/drop handlers
- ✅ Visual feedback (drag preview, drop target highlight, opacity)
- ✅ Multi-item drag (if dragged item is selected, drag all selected)
- ✅ Custom drag image ("X items" badge)
- ✅ Drop validation (prevent dropping on self, only folders)
- ✅ API call to bulk-move endpoint
- ✅ Refresh source and target popups after drop
- ✅ Auto-expand target folder after drop

### Out of Scope
- ❌ Drag to canvas (separate feature)
- ❌ Drag to create new folder (defer)
- ❌ Drag reordering within same folder (defer)
- ❌ Keyboard-driven drag (defer)
- ❌ Undo/redo for moves (defer)

---

## Reference Implementation

**Source:** `components/notes-explorer-phase1.tsx`

### Key Patterns to Adopt

**1. State Management (lines 160-162):**
```typescript
const [draggedItems, setDraggedItems] = useState<Set<string>>(new Set())
const [dropTargetId, setDropTargetId] = useState<string | null>(null)
```

**2. Drag Start with Multi-Select (lines 2914-2934):**
```typescript
const handleDragStart = (e: React.DragEvent, nodeId: string) => {
  // If the dragged item is selected, drag all selected items
  const itemsToDrag = selectedItems.has(nodeId) ? selectedItems : new Set([nodeId])
  setDraggedItems(itemsToDrag)

  // Custom drag image for multiple items
  if (itemsToDrag.size > 1) {
    const dragPreview = document.createElement('div')
    dragPreview.className = 'bg-indigo-600 text-white px-2 py-1 rounded'
    dragPreview.textContent = `${itemsToDrag.size} items`
    // ... create and set drag image
  }
}
```

**3. Drop Handler with API Call (lines 2957-3025):**
```typescript
const handleDrop = async (e: React.DragEvent, targetId: string) => {
  const itemIds = Array.from(draggedItems)

  // API call
  await fetch('/api/items/bulk-move', {
    method: 'POST',
    body: JSON.stringify({ itemIds, targetFolderId: targetId })
  })

  // Auto-expand target
  setExpandedNodes(prev => ({ ...prev, [targetId]: true }))

  // Reload target folder children
  await loadNodeChildren(targetId)

  // Find and reload source parent folders
  // ...
}
```

**4. Visual Feedback (lines 3086-3091):**
```typescript
className={`... ${
  isDropTarget ? 'bg-green-600 bg-opacity-50 ring-2 ring-green-500' :
  isDragging ? 'opacity-50' :
  'hover:bg-gray-700'
}`}
```

---

## Technical Approach

### 1. State Management (PopupOverlay Component)

**Add drag state to PopupOverlay:**
```typescript
// Drag and drop state
const [draggedItems, setDraggedItems] = useState<Set<string>>(new Set())
const [dropTargetId, setDropTargetId] = useState<string | null>(null)
const [dragSourcePopupId, setDragSourcePopupId] = useState<string | null>(null)
```

**Considerations:**
- Track source popup ID to know where items are being dragged from
- Use existing `popupSelections` for multi-select integration
- Clear drag state when popups close (add to existing cleanup effect)

### 2. Drag Handlers

**handleDragStart:**
```typescript
const handleDragStart = useCallback((
  popupId: string,
  childId: string,
  event: React.DragEvent
) => {
  // Get items to drag (selected items or just this one)
  const selectedInPopup = popupSelections.get(popupId) || new Set()
  const itemsToDrag = selectedInPopup.has(childId) ? selectedInPopup : new Set([childId])

  setDraggedItems(itemsToDrag)
  setDragSourcePopupId(popupId)

  // Set drag data
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', Array.from(itemsToDrag).join(','))

  // Custom drag preview for multiple items
  if (itemsToDrag.size > 1) {
    const dragPreview = document.createElement('div')
    dragPreview.className = 'bg-indigo-600 text-white px-2 py-1 rounded text-sm'
    dragPreview.textContent = `${itemsToDrag.size} items`
    dragPreview.style.position = 'absolute'
    dragPreview.style.top = '-1000px'
    document.body.appendChild(dragPreview)
    event.dataTransfer.setDragImage(dragPreview, 0, 0)
    setTimeout(() => document.body.removeChild(dragPreview), 0)
  }
}, [popupSelections])
```

**handleDragOver:**
```typescript
const handleDragOver = useCallback((
  childId: string,
  isFolder: boolean,
  event: React.DragEvent
) => {
  if (!isFolder) return // Only folders are drop targets

  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  setDropTargetId(childId)
}, [])
```

**handleDragLeave:**
```typescript
const handleDragLeave = useCallback((event: React.DragEvent) => {
  const related = event.relatedTarget as HTMLElement
  if (!related || !related.closest('[data-drop-zone]')) {
    setDropTargetId(null)
  }
}, [])
```

**handleDragEnd:**
```typescript
const handleDragEnd = useCallback(() => {
  setDraggedItems(new Set())
  setDropTargetId(null)
  setDragSourcePopupId(null)
}, [])
```

**handleDrop (will need onBulkMove prop):**
```typescript
const handleDrop = useCallback(async (
  targetFolderId: string,
  event: React.DragEvent
) => {
  event.preventDefault()
  event.stopPropagation()

  const itemIds = Array.from(draggedItems)
  if (itemIds.length === 0) return

  // Don't allow dropping on itself
  if (itemIds.includes(targetFolderId)) {
    setDropTargetId(null)
    return
  }

  // Call parent callback to handle move
  await onBulkMove?.(itemIds, targetFolderId, dragSourcePopupId || '')

  // Clear drag state
  handleDragEnd()
}, [draggedItems, dragSourcePopupId, onBulkMove, handleDragEnd])
```

### 3. Visual Feedback

**Update renderPopupChildRow:**
```typescript
const isDragging = draggedItems.has(child.id)
const isDropTarget = dropTargetId === child.id && folderLike

// IMPORTANT: Visual state priority order
className={`... ${
  isDropTarget ? 'bg-green-600 bg-opacity-50 ring-2 ring-green-500' :  // Drop target (highest)
  isDragging ? 'opacity-50' :  // Being dragged (shows BEFORE selection)
  isSelected ? 'bg-indigo-500 bg-opacity-50 text-white' :  // Selected
  isActivePreview ? 'bg-gray-700/70 text-white' : 'text-gray-200'  // Preview/default
}`}
```

**Visual Priority (CORRECTED):**
1. **Drop target (green)** - highest priority
   - Overrides all other states
   - Clear visual feedback for where items will land
2. **Dragging (opacity 50%)** - second highest
   - Shows what's being dragged
   - Overrides selection state (prevents confusion)
   - Rationale: If item is being dragged, showing it's in motion is more important than showing it's selected
3. **Selected (indigo)** - third
   - Shows multi-select state when NOT dragging
4. **Preview (gray)** - low priority
5. **Default** - base state

**Edge Case Handling:**
- If item is BOTH selected AND being dragged: Shows dragging state (opacity 50%)
- If item is BOTH selected AND drop target: Shows drop target (green)
- Dragged items that are selected: User already knows they're selected from the action bar count

### 4. Drag Attributes on Rows

**Add to row div:**
```typescript
draggable={true}  // All items draggable
onDragStart={(e) => handleDragStart(popupId, child.id, e)}
onDragEnd={handleDragEnd}
onDragOver={(e) => handleDragOver(child.id, folderLike, e)}
onDragLeave={handleDragLeave}
onDrop={(e) => folderLike && handleDrop(child.id, e)}
data-drop-zone={folderLike ? 'true' : undefined}
```

### 5. Parent Component Integration (annotation-app.tsx)

**Add onBulkMove prop to PopupOverlay:**
```typescript
interface PopupOverlayProps {
  // ... existing props
  onBulkMove?: (itemIds: string[], targetFolderId: string, sourcePopupId: string) => Promise<void>
}
```

**Implement handleBulkMove in annotation-app.tsx (SAFE PATTERN - tracks success/failure):**
```typescript
const handleBulkMove = useCallback(async (
  itemIds: string[],
  targetFolderId: string,
  sourcePopupId: string
) => {
  try {
    console.log('[handleBulkMove] Moving items:', { itemIds, targetFolderId, sourcePopupId })

    // Call bulk-move API
    const response = await fetch('/api/items/bulk-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds, targetFolderId })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to move items')
    }

    const data = await response.json()

    // CRITICAL: Track which items actually moved (same pattern as delete)
    const successfullyMovedIds = new Set(
      data.movedItems?.map((item: any) => item.id) || []
    )
    const movedCount = successfullyMovedIds.size

    console.log(`[handleBulkMove] Successfully moved ${movedCount}/${itemIds.length} items`)

    // Only update UI for items that actually moved
    if (movedCount > 0) {
      setOverlayPopups(prev =>
        prev.map(popup => {
          // Update source popup: remove successfully moved items
          if (popup.id === sourcePopupId && popup.folder && popup.children) {
            const updatedChildren = popup.children.filter(
              child => !successfullyMovedIds.has(child.id)
            )
            return {
              ...popup,
              children: updatedChildren,
              folder: { ...popup.folder, children: updatedChildren }
            }
          }

          // Update target popup: re-fetch to get moved items
          if (popup.folder?.id === targetFolderId) {
            // Trigger re-fetch for target popup
            // (Will be handled by existing popup refresh logic)
            return popup
          }

          return popup
        })
      )
    }

    // Warn if some moves failed
    const failedCount = itemIds.length - movedCount
    if (failedCount > 0) {
      console.warn(`[handleBulkMove] ${failedCount} item(s) failed to move`)
      // Optional: Show user notification
    }

    // Clear selection after successful move (consistent with notes-explorer)
    // (Will be handled by PopupOverlay cleanup)

  } catch (error) {
    console.error('[handleBulkMove] Error:', error)
    alert(`Failed to move items: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}, [overlayPopups])
```

### 6. Cleanup on Popup Close

**Add to existing cleanup effect (popup-overlay.tsx:523-553):**
```typescript
useEffect(() => {
  const activeIds = new Set<string>();
  popups.forEach((_, id) => activeIds.add(id));

  // Existing cleanup...

  // Clear drag state if source popup closed
  setDraggedItems(prev => {
    if (!dragSourcePopupId || !activeIds.has(dragSourcePopupId)) {
      return new Set()
    }
    return prev
  })

  if (dragSourcePopupId && !activeIds.has(dragSourcePopupId)) {
    setDropTargetId(null)
    setDragSourcePopupId(null)
  }
}, [popups, dragSourcePopupId])
```

---

## Files to Modify

### Primary Changes
1. **`components/canvas/popup-overlay.tsx`**
   - Add drag state management
   - Add drag handlers (start, over, leave, end, drop)
   - Update visual feedback (add isDragging, isDropTarget)
   - Add drag attributes to rows
   - Add cleanup in popup close effect
   - Add `onBulkMove` prop to interface

2. **`components/annotation-app.tsx`**
   - Implement `handleBulkMove` callback
   - Wire `onBulkMove` to PopupOverlay
   - Handle popup refresh after move

### API Requirements
- **Endpoint:** `POST /api/items/bulk-move`
- **Payload:** `{ itemIds: string[], targetFolderId: string }`
- **Response:** Success/failure status

---

## Testing Strategy

### Manual Testing
1. Open popup (click folder eye icon)
2. Drag single item to folder in same popup → verify move
3. Ctrl/Cmd+Click select multiple items
4. Drag selected items to folder → verify all move together
5. Drag items to folder in different popup → verify cross-popup move
6. Verify drag preview shows "X items" for multiple
7. Verify drop target highlights green
8. Verify dragged items show opacity 50%
9. Verify source popup refreshes (items removed)
10. Verify target popup refreshes (items added)
11. Try dropping on non-folder → verify no drop
12. Try dropping on self → verify prevented
13. Close popup while dragging → verify cleanup

### Edge Cases
- [ ] Drag from popup A to folder in popup B
- [ ] Drag last item from folder (folder becomes empty)
- [ ] Drag to collapsed folder (should expand?)
- [ ] Drag while preview is active
- [ ] Network failure during move
- [ ] Partial move failure (some items fail)

### Type Check
```bash
npm run type-check
```

---

## Acceptance Criteria

- [ ] Single item drag works
- [ ] Multi-item drag works (drags all selected if dragged item is selected)
- [ ] Custom drag preview shows "X items" badge
- [ ] Drop target highlights green with ring
- [ ] Dragged items show opacity 50%
- [ ] Only folders accept drops
- [ ] Cannot drop on self
- [ ] API call to `/api/items/bulk-move` succeeds
- [ ] Source popup refreshes (moved items removed)
- [ ] Target popup refreshes (moved items added)
- [ ] Drag state cleared on drop
- [ ] Drag state cleared on popup close
- [ ] Type-check passes
- [ ] No console errors
- [ ] Works with existing multi-select

---

## Risks & Mitigations ✅

1. **Cross-Popup Complexity** ✅ MITIGATED
   - ✅ Track source popup ID in dragSourcePopupId state
   - ✅ Update source popup (remove moved items) using safe filter pattern
   - ✅ Only update target popup if already open (no auto-creation)
   - Risk Level: LOW (pattern established from multi-select)

2. **Drag State Cleanup** ✅ MITIGATED
   - ✅ Clear when popup closes (add to existing cleanup effect lines 523-553)
   - ✅ Clear on handleDragEnd (called on drop or drag cancel)
   - ⚠️ Escape key interruption: Browser handles this (fires dragEnd event)
   - Risk Level: LOW (standard drag-drop behavior)

3. **Visual Conflicts** ✅ RESOLVED
   - ✅ Clear priority order: Drop target > Dragging > Selected > Preview > Default
   - ✅ Dragging overrides selection (shows motion state, not selection)
   - ✅ Drop target always wins (clear landing zone feedback)
   - Risk Level: LOW (priority order documented and justified)

4. **API Reliability** ⚠️ HIGH RISK - MUST FIX FIRST
   - ❌ **CRITICAL:** Existing API has NO transaction safety
   - ❌ **CRITICAL:** Uses wrong pool instance (not serverPool)
   - ❌ **HIGH:** No workspace validation
   - ✅ UI safety pattern ready (tracks success per item, like delete)
   - **MITIGATION:** Fix API endpoint BEFORE implementing UI (Phase 0)
   - Risk Level: HIGH until API fixed, then LOW

5. **Performance** ⚠️ MONITOR
   - Drag preview DOM creation: Minimal impact (removed after 0ms timeout)
   - Large selections: API handles loop, might be slow for 50+ items
   - **MITIGATION:**
     - Consider showing loading state during move
     - API should use single UPDATE with ANY($ids) instead of loop
   - Risk Level: MEDIUM (acceptable for MVP, optimize later)

6. **Partial Move Failures** ✅ MITIGATED
   - ✅ Track success per item (same pattern as delete)
   - ✅ Only update UI for successfully moved items
   - ✅ Console warning if failures occur
   - ✅ Failed items remain visible in source popup (safe behavior)
   - Risk Level: LOW (safety pattern proven)

---

## Implementation Steps

### Phase 0: Fix Existing API (CRITICAL - MUST DO FIRST) ⚠️

1. **Backup existing API endpoint**
   ```bash
   cp app/api/items/bulk-move/route.ts app/api/items/bulk-move/route.ts.backup.original
   ```

2. **Fix transaction safety**
   - Import serverPool from `@/lib/db/pool`
   - Wrap all operations in BEGIN/COMMIT/ROLLBACK
   - Use client.query() from connection pool

3. **Add workspace validation**
   - Import WorkspaceStore
   - Get default workspace ID
   - Validate items belong to workspace

4. **Add success/failure tracking**
   - Return { success: true, movedItems: [...], skippedItems: [...] }
   - Track which items succeeded vs failed with reasons

5. **Test API thoroughly**
   ```bash
   # Test successful move
   curl -X POST http://localhost:3000/api/items/bulk-move \
     -H "Content-Type: application/json" \
     -d '{"itemIds": ["id1", "id2"], "targetFolderId": "folder1"}'

   # Test partial failure
   # Test circular reference
   # Test invalid target
   ```

6. **Run type-check**
   ```bash
   npm run type-check
   ```

### Phase 1: Implement UI (Only after Phase 0 complete) ✅

7. **Create backups**
   - `popup-overlay.tsx.backup.dragdrop`
   - `annotation-app.tsx.backup.dragdrop`

8. **Add drag state management to PopupOverlay**
   - draggedItems, dropTargetId, dragSourcePopupId

9. **Implement drag handlers**
   - handleDragStart (with multi-select support)
   - handleDragOver (folder validation)
   - handleDragLeave
   - handleDragEnd
   - handleDrop (calls onBulkMove)

10. **Add visual feedback**
    - isDragging (opacity 50%)
    - isDropTarget (green highlight)
    - Visual priority order

11. **Add drag attributes to row rendering**
    - draggable={true}
    - onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop
    - data-drop-zone for folders

12. **Add cleanup to popup close effect**
    - Clear drag state when source popup closes

13. **Add onBulkMove prop to PopupOverlay interface**

14. **Implement handleBulkMove in annotation-app.tsx**
    - Call API with proper error handling
    - Track successfullyMovedIds (same pattern as delete)
    - Update only source popup (filter moved items)
    - Console logging

15. **Wire callback to PopupOverlay**

16. **Test all drag scenarios**
    - Single item drag
    - Multi-item drag
    - Cross-popup drag
    - Drop on non-folder (should reject)
    - Drop on self (should reject)
    - Partial move failure

17. **Run type-check**
    ```bash
    npm run type-check
    ```

18. **Create implementation report**
    - Document what was implemented
    - Show test results
    - Note any issues or limitations

---

## Alternative Approaches

### Option A: Use Existing Multi-Select (Current Plan)
- ✅ Consistent with notes-explorer
- ✅ Leverages existing selection state
- ✅ Users can select then drag
- ❌ Two-step operation (select, then drag)

### Option B: Drag Without Pre-Selection
- ✅ One-step operation (just drag)
- ❌ No visual indication before drag
- ❌ Less consistent with existing UX

**Decision: Use Option A (multi-select integration)**

---

## References

- **Source Implementation:** `components/notes-explorer-phase1.tsx:2914-3025` (drag handlers), `3070-3100` (visual feedback)
- **Target Files:**
  - `components/canvas/popup-overlay.tsx` - UI drag-drop implementation
  - `components/annotation-app.tsx` - Parent callback integration
  - `app/api/items/bulk-move/route.ts` - **EXISTS but needs fixing (Phase 0)**
- **Safety Pattern Reference:** `components/annotation-app.tsx:945-1019` (delete with success tracking)
- **API Requirements:** `docs/proposal/popup_drag_drop/supporting_files/API_REQUIREMENTS.md`
- **CLAUDE.md:** Feature workspace structure, backups, testing requirements, honesty policy

---

## Next Steps After Implementation

1. Add drag to canvas support (drag items to open on canvas)
2. Add drag to create folder (drag over empty space)
3. Add drag reordering within same folder
4. Add undo/redo for move operations
5. Add keyboard shortcuts for move (Ctrl+X, Ctrl+V)
6. Add batch move optimization (single API call)

---

## Questions Resolved ✅

1. **Does `/api/items/bulk-move` endpoint exist?**
   - ✅ **YES** - exists at `app/api/items/bulk-move/route.ts`
   - ⚠️ **BUT** has critical safety issues (no transaction, wrong pool, no workspace check)
   - **DECISION:** Fix existing endpoint before implementing UI (see API_REQUIREMENTS.md)

2. **Should we create target popup if it doesn't exist?**
   - **DECISION:** NO - only update if popup already open
   - Rationale: Creating popups without user action is surprising
   - Source popup will update (items removed), target updates only if user has it open

3. **Should dragging auto-expand collapsed folders?**
   - **DECISION:** NO - not applicable to popup overlay
   - Popup overlay doesn't have expand/collapse (shows flat children list)
   - This feature only relevant for tree view in notes-explorer

4. **How to handle partial move failures?**
   - **DECISION:** Keep successful moves, warn about failures
   - Same pattern as delete functionality (track success per item)
   - Only remove items from source popup if they successfully moved
   - Console warning if any failures: `"X item(s) failed to move"`
   - Optional: Add toast notification for user feedback

5. **Should we clear selection after move?**
   - **DECISION:** YES - clear selection after successful move
   - Consistent with notes-explorer behavior (line 3017)
   - Prevents confusion (items no longer in source popup)
   - PopupOverlay cleanup effect will handle this automatically
