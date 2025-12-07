# Dashboard Panel Auto-Scroll Implementation

**Date:** 2025-12-06
**Feature:** Auto-scroll when dragging panels to container edges
**Files Modified:** `components/dashboard/DashboardView.tsx`, `components/canvas/use-auto-scroll.ts`

---

## Overview

Implemented auto-scroll functionality for the dashboard view that activates when users drag panels toward the edges of the viewport. The canvas dynamically expands to provide an unlimited workspace.

### Supported Edges

| Edge | Behavior | Expansion |
|------|----------|-----------|
| **Bottom** | Scrolls down, canvas expands downward | Yes |
| **Right** | Scrolls right, canvas expands rightward | Yes |
| **Top** | Scrolls up until `scrollTop=0`, then blocks | No |
| **Left** | Blocks at `scrollLeft=0` | No (intentionally removed) |

---

## Issues Encountered and Fixes

### Issue 1: Database Integer Type Error

**Symptom:**
```
PATCH Error: error: invalid input syntax for type integer: "1034.943927591803"
```

**Root Cause:**
Panel positions were being saved as floats, but the database column expects integers.

**Fix:**
Round positions before saving and during drag operations.

```typescript
// In handlePositionChange (line 720-724)
const handlePositionChange = useCallback(
  async (panelId: string, x: number, y: number) => {
    try {
      // Round to integers - database expects integer type
      await fetch(`/api/dashboard/panels/${panelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionX: Math.round(x), positionY: Math.round(y) }),
      })
    } catch (err) {
      console.error("[DashboardView] Failed to update panel position:", err)
    }
  },
  []
)
```

---

### Issue 2: Container Not Scrollable

**Symptom:**
Auto-scroll callbacks fired but the dashboard didn't scroll.

**Root Cause:**
The container had `h-full` (100% height) which grows with content. For `overflow: auto` to create scrollbars, the container needs a **fixed** height.

**Fix:**
Changed container to use fixed viewport dimensions.

```typescript
// In return statement (line 1000-1010)
return (
  <div
    ref={dashboardContainerRef}
    className={cn("relative overflow-auto", className)}
    style={{
      // Fixed dimensions required for overflow-auto to create scrollbars
      width: '100vw',
      height: '100vh',
      background: '#0a0c10',
      color: '#f0f0f0',
    }}
  >
```

---

### Issue 3: No Initial Scroll Room

**Symptom:**
Auto-scroll triggered but couldn't scroll because canvas size matched viewport.

**Root Cause:**
Canvas dimensions were calculated as `max(viewport, panelBounds)`. If panels fit in viewport, there was no scroll room.

**Fix:**
Canvas is now always larger than viewport by 200px to provide initial scroll room.

```typescript
// In canvasDimensions useMemo (lines 141-173)
const canvasDimensions = useMemo(() => {
  const BUFFER = 500 // Extra space beyond panels for scrolling
  const SCROLL_ROOM = 200 // Extra space beyond viewport to enable initial scrolling
  const viewportWidth = window?.innerWidth || 1200
  const viewportHeight = (window?.innerHeight || 800) - 56 // Subtract header height

  // Canvas must be larger than viewport + some room for scroll to work
  const MIN_WIDTH = viewportWidth + SCROLL_ROOM
  const MIN_HEIGHT = viewportHeight + SCROLL_ROOM

  if (panels.length === 0) {
    return { width: MIN_WIDTH, height: MIN_HEIGHT }
  }

  // Find the rightmost and bottommost panel edges
  let maxRight = 0
  let maxBottom = 0

  for (const panel of panels) {
    const right = panel.positionX + panel.width
    const bottom = panel.positionY + panel.height
    if (right > maxRight) maxRight = right
    if (bottom > maxBottom) maxBottom = bottom
  }

  // Add buffer for scrollable space, ensuring always larger than viewport
  return {
    width: Math.max(MIN_WIDTH, maxRight + BUFFER),
    height: Math.max(MIN_HEIGHT, maxBottom + BUFFER),
  }
}, [panels])
```

---

### Issue 4: Inverted Scroll Direction

**Symptom:**
When dragging to bottom edge, the view scrolled up instead of down.

**Root Cause:**
The `useAutoScroll` hook's direction is designed for "view follows content" behavior, but we needed "reveal more canvas in drag direction" behavior.

**Fix:**
Invert the delta values in the auto-scroll callback.

```typescript
// In handleDashboardAutoScroll (lines 178-191)
const handleDashboardAutoScroll = useCallback((deltaX: number, deltaY: number) => {
  if (!dashboardContainerRef.current || !draggingPanelId) return

  const container = dashboardContainerRef.current

  // INVERT the deltas: the hook's direction is for "view follows content"
  // but we need "reveal more canvas in the direction of drag"
  // Near bottom edge: hook gives negative deltaY (scroll up), but we want scroll DOWN
  // Near right edge: hook gives negative deltaX (scroll left), but we want scroll RIGHT
  const scrollDeltaX = -deltaX
  const scrollDeltaY = -deltaY

  // ... rest of scrolling logic
}, [draggingPanelId])
```

---

### Issue 5: Top Edge Detection Failing

**Symptom:**
Dragging panel to top edge didn't trigger auto-scroll when `scrollTop > 0`.

**Root Cause:**
The cursor position was used for edge detection, but when grabbing a panel's header, the cursor is offset from the panel's edge. The cursor never got within 50px of the container's top.

**Fix:**
Detect based on **panel's visual position** relative to scroll, and synthesize a cursor position.

```typescript
// In handleDragMove (lines 852-878)
// Check if PANEL is near the visible top edge
// Panel's visual Y position relative to scroll = newY - scrollTop
// If this is small AND there's scroll room above (scrollTop > 0), we're near visible top
const panelVisualY = newY - scrollTop
const panelNearVisibleTop = scrollTop > 0 && panelVisualY < 50

// TOP edge: synthesize cursor position if panel is near visible top
let syntheticY = e.clientY
if (panelNearVisibleTop && distFromTop > 50) {
  syntheticY = rect.top + 25 // 25px from top edge
  console.log("[DashboardView] Synthesizing top edge position:", {
    originalY: e.clientY,
    syntheticY,
    scrollTop
  })
}

checkAutoScroll(e.clientX, syntheticY)
```

---

## Final Implementation

### Auto-Scroll Handler

```typescript
// handleDashboardAutoScroll - Complete implementation
const handleDashboardAutoScroll = useCallback((deltaX: number, deltaY: number) => {
  if (!dashboardContainerRef.current || !draggingPanelId) return

  const container = dashboardContainerRef.current

  // Invert deltas for "reveal more canvas" behavior
  const scrollDeltaX = -deltaX
  const scrollDeltaY = -deltaY

  // Handle horizontal scrolling
  if (scrollDeltaX !== 0) {
    if (scrollDeltaX < 0 && container.scrollLeft < 1) {
      // LEFT EDGE: Block at scrollLeft=0
      console.log("[DashboardView] At left edge (scrollLeft=0), can't scroll left further")
    } else {
      // Normal horizontal scroll (right edge only)
      container.scrollLeft += scrollDeltaX

      // Expand buffer for right edge only
      if (scrollDeltaX > 0) {
        setDragExpandBuffer(prev => ({
          ...prev,
          x: prev.x + Math.abs(scrollDeltaX) * 2,
        }))
      }

      // Update dragging panel position
      if (dragStartRef.current) {
        dragStartRef.current.panelX += scrollDeltaX
        setPanels((prev) =>
          prev.map((p) =>
            p.id === draggingPanelId
              ? { ...p, positionX: Math.max(0, Math.round(p.positionX + scrollDeltaX)) }
              : p
          )
        )
      }
    }
  }

  // Handle vertical scrolling
  if (scrollDeltaY !== 0) {
    if (scrollDeltaY < 0 && container.scrollTop < 1) {
      // TOP EDGE: Block at scrollTop=0
      console.log("[DashboardView] At top edge (scrollTop=0), can't scroll up further")
    } else {
      // Normal vertical scroll (up or down)
      container.scrollTop += scrollDeltaY

      // Expand buffer for bottom edge only
      if (scrollDeltaY > 0) {
        setDragExpandBuffer(prev => ({
          ...prev,
          y: prev.y + Math.abs(scrollDeltaY) * 2,
        }))
      }

      // Update dragging panel position
      if (dragStartRef.current) {
        dragStartRef.current.panelY += scrollDeltaY
        setPanels((prev) =>
          prev.map((p) =>
            p.id === draggingPanelId
              ? {
                  ...p,
                  positionY: Math.max(0, Math.round(p.positionY + scrollDeltaY))
                }
              : p
          )
        )
      }
    }
  }
}, [draggingPanelId])
```

### useAutoScroll Hook Configuration

```typescript
const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
  enabled: !!draggingPanelId,
  threshold: 50,           // 50px from edge to trigger
  speedPxPerSec: 400,      // Scroll speed
  activationDelay: 300,    // 300ms delay before activation
  onScroll: handleDashboardAutoScroll,
  containerRef: dashboardContainerRef,
})
```

### Dynamic Canvas Expansion

```typescript
// dragExpandBuffer grows during auto-scroll to provide infinite canvas
const [dragExpandBuffer, setDragExpandBuffer] = useState({ x: 0, y: 0 })

// Reset when drag ends
const handleDragEnd = useCallback(() => {
  // ... save position ...
  setDraggingPanelId(null)
  dragStartRef.current = null
  stopAutoScroll()
  setDragExpandBuffer({ x: 0, y: 0 }) // Reset expansion
}, [/* deps */])

// Applied to canvas surface
<div style={{
  minWidth: canvasDimensions.width + dragExpandBuffer.x,
  minHeight: canvasDimensions.height + dragExpandBuffer.y,
}}>
```

---

## Design Decisions

### Why No Left Edge Expansion?

1. **Usage Pattern:** Dashboards flow top-left to bottom-right. Users rarely need space to the left.
2. **Complexity:** Left expansion requires shifting ALL panels right, which is complex and potentially disorienting.
3. **Performance:** Shifting all panels triggers re-renders for every panel.
4. **Simplicity:** Blocking at `scrollLeft=0` matches typical dashboard UX.

### Why Top Edge Scrolls But Doesn't Expand?

1. **Return Navigation:** Users scroll down, then need to return to top.
2. **No Content Above:** Initial panels start at top; no need for space above.
3. **Consistency:** Matches left edge behavior (block at 0).

---

## Testing Checklist

- [x] Drag panel to **bottom** edge → scrolls down, canvas expands
- [x] Drag panel to **right** edge → scrolls right, canvas expands
- [x] Drag panel to **top** edge (after scrolling down) → scrolls up until `scrollTop=0`
- [x] Drag panel to **left** edge → blocks at `scrollLeft=0`
- [x] Panel positions saved correctly (no float errors)
- [x] Canvas resets to normal size after drag ends

---

## Console Logs for Debugging

```
[DashboardView] Near edge: { clientX, clientY, panelPosition, scrollTop, ... }
[DashboardView] Auto-scroll triggered: { originalDelta, adjustedDelta, currentScroll, ... }
[DashboardView] Synthesizing top edge position: { originalY, syntheticY, scrollTop }
[DashboardView] At left edge (scrollLeft=0), can't scroll left further
[DashboardView] At top edge (scrollTop=0), can't scroll up further
```

---

## Files Changed

| File | Changes |
|------|---------|
| `components/dashboard/DashboardView.tsx` | Added auto-scroll handler, dynamic canvas sizing, edge detection, header outside scrollable container |
| `components/canvas/use-auto-scroll.ts` | No changes (reused existing hook) |

---

### Issue 6: Header Scrolls Horizontally During Auto-Scroll

**Symptom:**
When dragging a panel to the right edge and auto-scroll triggers, the dashboard header also scrolls horizontally along with the content.

**Root Cause:**
The header had `className="sticky top-0"` and was **inside** the scrollable container (canvas surface). CSS `sticky` only handles vertical stickiness - it keeps the element at the top during vertical scroll. During horizontal scroll (`scrollLeft` changes), the header moved with the content because it was part of the scrollable content area.

**Fix:**
Restructured the component layout to move the header **outside** the scrollable container:

**Before (problematic structure):**
```
dashboardContainerRef (overflow-auto, 100vw x 100vh)
  └── Canvas surface
        ├── Header (sticky top-0) <-- Scrolls horizontally with content
        └── Content panels
```

**After (fixed structure):**
```
Outer wrapper (100vw x 100vh, flex column)
  ├── Header (flex-shrink-0, fixed at top) <-- Never scrolls
  └── dashboardContainerRef (flex-1, overflow-auto)
        └── Canvas surface
              └── Content panels
```

**Code Changes:**

1. **Outer wrapper** changed from scrollable container to flex column:
```typescript
// Before
<div
  ref={dashboardContainerRef}
  className={cn("relative overflow-auto", className)}
  style={{
    width: '100vw',
    height: '100vh',
    ...
  }}
>

// After
<div
  className={cn("relative flex flex-col", className)}
  style={{
    width: '100vw',
    height: '100vh',
    ...
  }}
>
```

2. **Header** moved outside scrollable area with `flex-shrink-0`:
```typescript
// Before
<div
  className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
  ...
>

// After
<div
  className="flex-shrink-0 z-10 px-4 py-3 flex items-center justify-between"
  ...
>
```

3. **Scrollable container** added as separate div with `flex-1`:
```typescript
<div
  ref={dashboardContainerRef}
  className="flex-1 relative overflow-auto"
  style={{ background: '#0a0c10' }}
>
  {/* Canvas surface inside */}
</div>
```

4. **Workspace canvas** `top: 56` removed (since scrollable container is already below header):
```typescript
// Before
top: 56, // Below the header

// After
top: 0, // Header is now outside the scrollable container
```

---

## Updated Testing Checklist

- [x] Drag panel to **bottom** edge → scrolls down, canvas expands
- [x] Drag panel to **right** edge → scrolls right, canvas expands, **header stays fixed**
- [x] Drag panel to **top** edge (after scrolling down) → scrolls up until `scrollTop=0`
- [x] Drag panel to **left** edge → blocks at `scrollLeft=0`
- [x] Panel positions saved correctly (no float errors)
- [x] Canvas resets to normal size after drag ends
- [x] Header never scrolls horizontally during right edge auto-scroll

