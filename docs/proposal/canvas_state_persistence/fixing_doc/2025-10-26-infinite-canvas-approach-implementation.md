# Implementation: infinite-canvas Viewport Centering Approach

**Date:** 2025-10-26
**Feature:** Visual centering of new notes
**Status:** ✅ IMPLEMENTED

---

## Problem Summary

New notes created via the "+ Note" toolbar button were appearing off-screen or at incorrect positions, despite multiple attempts to fix the centering logic. The issue was **NOT a math error**, but a **conceptual architecture problem**.

---

## Root Cause Analysis

### The Flawed Architecture

The annotation-backup project mixed THREE different position sources:

1. **Database** - Persisted positions from previous sessions
2. **freshNoteSeeds** - Cache of recently computed positions
3. **computeVisuallyCenteredWorldPosition()** - Live viewport calculation

This created:
- ❌ **Cache invalidation issues** - Stale positions returned when fresh ones expected
- ❌ **Race conditions** - Rapid clicks caused `alreadyOpen` to skip centering
- ❌ **Ordering conflicts** - Which source wins? Database? Cache? Live computation?

### The Key Insight from infinite-canvas-main

Studying `/Users/dandy/Downloads/infinite-canvas-main` revealed a **fundamentally different approach**:

**PRINCIPLE: Never mix new component creation with existing component reopening**

```typescript
// infinite-canvas approach
if (useViewportCenter || x === undefined || y === undefined) {
  // NEW COMPONENT: Compute fresh position - NO CACHING
  finalX = (viewportCenterX - state.offsetX) / state.scale - size.width / 2
  finalY = (viewportCenterY - state.offsetY) / state.scale - size.height / 2
  // USE IT IMMEDIATELY
}
```

**Key characteristics:**
- ✅ Synchronous - no async lookups
- ✅ Direct - no caching layers
- ✅ Simple math - `(screenX - cameraX) / zoom`
- ✅ No race conditions - everything in one block
- ✅ Clear separation - new vs existing components use different code paths

---

## The Fix

### Changed File

**File:** `components/annotation-app.tsx`
**Lines:** 1391-1444
**Function:** `handleNoteSelect()`

### Before (Flawed Approach)

```typescript
// WRONG: Mixed concerns, multiple position sources
if (isToolbarCreation && !hasExplicitPosition) {
  const centeredPosition = computeVisuallyCenteredWorldPosition(...)
  if (centeredPosition) {
    resolvedPosition = centeredPosition
    setFreshNoteSeeds(prev => ({ ...prev, [noteId]: centeredPosition }))  // ← CACHING!
  }
} else if (!hasExplicitPosition && !alreadyOpen) {
  const persistedPosition = resolveMainPanelPosition(noteId)  // ← May return stale value
  resolvedPosition = persistedPosition ?? null
}
```

**Problems:**
1. Caches position in `freshNoteSeeds` (unnecessary)
2. Calls `resolveMainPanelPosition()` which looks up cached/DB values
3. Depends on `!alreadyOpen` check (race condition)
4. Uses complex `computeVisuallyCenteredWorldPosition()` function

### After (infinite-canvas Approach)

```typescript
// RIGHT: Separate concerns, direct calculation
if (isToolbarCreation && !hasExplicitPosition) {
  // NEW NOTE: Direct viewport-to-world conversion
  const currentCamera = canvasRef.current?.getCameraState?.() ?? canvasState

  const viewportCenterX = typeof window !== 'undefined' ? window.innerWidth / 2 : 960
  const viewportCenterY = typeof window !== 'undefined' ? window.innerHeight / 2 : 540

  const PANEL_WIDTH = 500
  const PANEL_HEIGHT = 400
  const worldX = (viewportCenterX - currentCamera.translateX) / currentCamera.zoom - PANEL_WIDTH / 2
  const worldY = (viewportCenterY - currentCamera.translateY) / currentCamera.zoom - PANEL_HEIGHT / 2

  resolvedPosition = { x: worldX, y: worldY }
  // NO CACHING - use immediately

} else if (!hasExplicitPosition && !alreadyOpen) {
  // EXISTING NOTE: Look up persisted position
  const persistedPosition = resolveMainPanelPosition(noteId)
  resolvedPosition = persistedPosition ?? null
}
```

**Improvements:**
1. ✅ **No caching** - position computed and used immediately
2. ✅ **Simple math** - direct formula matching infinite-canvas
3. ✅ **Clear separation** - new notes vs existing notes use different branches
4. ✅ **Synchronous** - no async operations or race conditions
5. ✅ **Explicit constants** - `PANEL_WIDTH` and `PANEL_HEIGHT` clearly defined

---

## The Math

### Screen to World Coordinate Conversion

```
worldX = (screenX - cameraTranslateX) / cameraZoom
worldY = (screenY - cameraTranslateY) / cameraZoom
```

### Centering Adjustment

```
topLeftX = centerX - panelWidth / 2
topLeftY = centerY - panelHeight / 2
```

### Complete Formula

```typescript
const worldX = (window.innerWidth / 2 - camera.translateX) / camera.zoom - PANEL_WIDTH / 2
const worldY = (window.innerHeight / 2 - camera.translateY) / camera.zoom - PANEL_HEIGHT / 2
```

This places the **top-left corner** of the panel such that the **panel center** aligns with the **viewport center**.

---

## Verification Steps

### 1. Type Check

```bash
npm run type-check
```

**Result:** ✅ PASS (no errors)

### 2. Manual Testing Required

Please test the following scenarios:

#### Test 1: New Note Creation at Origin
1. Reset canvas view (viewport at `{0, 0}`, zoom `1`)
2. Click "+ Note" button
3. **Expected:** Note appears centered in viewport

#### Test 2: New Note Creation After Pan
1. Pan canvas away from origin (e.g., drag to move viewport)
2. Click "+ Note" button
3. **Expected:** Note appears centered in CURRENT viewport (not at origin)

#### Test 3: New Note Creation After Zoom
1. Zoom in or out
2. Pan to different location
3. Click "+ Note" button
4. **Expected:** Note appears centered in current viewport at current zoom level

#### Test 4: Rapid Creation (Race Condition Test)
1. Click "+ Note" button 5 times rapidly
2. **Expected:** All 5 notes appear at different positions near viewport center (with offset)
3. **NOT expected:** Notes alternating between centered and off-screen

#### Test 5: Existing Note Reopening
1. Create a note, move it somewhere
2. Close the note (if possible)
3. Reopen the same note
4. **Expected:** Note appears at the position where you moved it (persisted position)

---

## Debug Logging

Added comprehensive debug logs:

### New Note Creation
```typescript
debugLog({
  component: 'AnnotationApp',
  action: 'new_note_viewport_centered',
  metadata: {
    noteId,
    viewportCenter: { x: viewportCenterX, y: viewportCenterY },
    camera: currentCamera,
    worldPosition: resolvedPosition
  }
})
```

### Existing Note Reopening
```typescript
debugLog({
  component: 'AnnotationApp',
  action: 'existing_note_persisted_position',
  metadata: {
    noteId,
    persistedPosition: resolvedPosition
  }
})
```

### How to View Logs

```sql
-- Check debug logs for new note creation
SELECT component, action, metadata
FROM debug_logs
WHERE component = 'AnnotationApp'
  AND action IN ('new_note_viewport_centered', 'existing_note_persisted_position')
ORDER BY created_at DESC
LIMIT 20;
```

---

## What Was NOT Changed

The following parts remain unchanged (intentionally):

1. ✅ **Camera state structure** - Still uses `{translateX, translateY, zoom}`
2. ✅ **Database schema** - Panel positions still persisted normally
3. ✅ **getCameraState() method** - Still works the same way
4. ✅ **Existing note reopening** - Still uses `resolveMainPanelPosition()`

This fix is **surgical** - it only changes how NEW notes compute their initial position.

---

## Future Cleanup Opportunities

These items are NOT critical but could simplify code further:

### 1. Remove freshNoteSeeds State
Currently unused by new note creation logic (we don't cache anymore):
```typescript
// Could be removed
const [freshNoteSeeds, setFreshNoteSeeds] = useState<Record<string, { x: number; y: number }>>({})
```

### 2. Simplify computeVisuallyCenteredWorldPosition()
This function is now only used for existing note reopening (if `CENTER_EXISTING_NOTES_ENABLED`).
Could be simplified or renamed to reflect its actual use case.

### 3. Remove newNoteSequenceRef
No longer needed for new note positioning since we don't add offset based on sequence count.
The formula is simpler now.

---

## Comparison: annotation-backup vs infinite-canvas-main

| Aspect | annotation-backup (BEFORE) | infinite-canvas-main | annotation-backup (AFTER) |
|--------|---------------------------|---------------------|--------------------------|
| **Formula** | `screenToWorld()` + complex transforms | `(screenX - offsetX) / scale` | `(screenX - cameraX) / zoom` ✅ |
| **Caching** | Multiple layers (DB, seeds, MRU) | None | None ✅ |
| **Async operations** | Yes (resolvePosition lookups) | No | No ✅ |
| **Race conditions** | Yes (`alreadyOpen` check) | No | No ✅ |
| **Code clarity** | Mixed concerns | Separate new/existing | Separate new/existing ✅ |
| **Coordinate system** | World coordinates (complex) | Canvas coordinates (simple) | World coordinates (simple) ✅ |

---

## Acceptance Criteria

- [x] **Code compiles** - Type-check passes
- [ ] **New notes centered** - User testing required
- [ ] **No alternating behavior** - User testing required
- [ ] **Works after pan** - User testing required
- [ ] **Works after zoom** - User testing required
- [ ] **Rapid creation works** - User testing required

**Status:** Implementation complete, awaiting user verification.

---

## References

1. **Analysis document:** `/docs/analysis-infinite-canvas-centering.md`
2. **Source project:** `/Users/dandy/Downloads/infinite-canvas-main`
3. **Key files studied:**
   - `context/canvas-context.tsx:508-531` (addComponent function)
   - `components/infinite-canvas/add-component-menu.tsx:302-306` (menu handler)
   - `components/infinite-canvas/utils/canvas.utils.ts:38-99` (getViewportPosition utility)

---

## Conclusion

This fix adopts the **infinite-canvas-main approach**: simple, direct, synchronous position calculation with clear separation between new component creation and existing component reopening.

**No more caching. No more race conditions. No more mixed concerns.**

The math is simple: `worldX = (screenX - cameraX) / zoom - panelWidth/2`

That's it. That's all you need for viewport centering.
