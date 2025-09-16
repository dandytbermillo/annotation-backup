# Panel Jump-Back Issue - Implementation Fix

**Feature Slug:** `jump_back`  
**Date:** 2025-09-16  
**Status:** IMPLEMENTED ✅

## Solution Overview

Maintain a `renderPosition` state that tracks the actual displayed position of panels/components. This keeps React's virtual DOM synchronized with our DOM mutations during drag operations.

## Implementation Pattern

### Core Concept
```typescript
// 1. Track render position separately from prop position
const [renderPosition, setRenderPosition] = useState(position)

// 2. Sync with prop when NOT dragging
useEffect(() => {
  if (!dragState.current.isDragging) {
    setRenderPosition(position)
  }
}, [position])

// 3. Update BOTH during drag
const handleMouseMove = () => {
  const newPosition = { x: newLeft, y: newTop }
  setRenderPosition(newPosition)  // Keep React in sync
  panel.style.left = newLeft + 'px'  // Direct DOM update
  panel.style.top = newTop + 'px'
}

// 4. Use renderPosition in JSX
<div style={{ 
  left: renderPosition.x + 'px',  // Uses state, not prop
  top: renderPosition.y + 'px' 
}}>
```

## Detailed Changes

### 1. canvas-panel.tsx

#### Added State Management
```typescript
// State to track render position and prevent snap-back during drag
const [renderPosition, setRenderPosition] = useState(position)

// Update render position when position prop changes (but not during drag)
const dragStateRef = useRef<any>(null)
useEffect(() => {
  if (!dragStateRef.current?.isDragging) {
    setRenderPosition(position)
  }
}, [position])

// Link dragStateRef to dragState
dragStateRef.current = dragState.current
```

#### Updated Drag Start
```typescript
const handleMouseDown = (e) => {
  // ... existing code ...
  
  // Update render position to current position when starting drag
  setRenderPosition({ x: currentLeft, y: currentTop })
}
```

#### Updated Drag Move
```typescript
const handleMouseMove = (e) => {
  // ... calculate newLeft, newTop ...
  
  // Update render position to prevent snap-back during drag
  setRenderPosition({ x: newLeft, y: newTop })
  
  // Keep DOM update for immediate visual feedback
  panel.style.left = newLeft + 'px'
  panel.style.top = newTop + 'px'
}
```

#### Updated Drag End
```typescript
const handleMouseUp = (e) => {
  // ... get final position ...
  
  // Update render position to final position
  setRenderPosition({ x: finalX, y: finalY })
  
  // ... save to stores ...
}
```

#### Updated JSX
```typescript
<div style={{
  position: 'absolute',
  left: renderPosition.x + 'px',  // Changed from position.x
  top: renderPosition.y + 'px',    // Changed from position.y
  // ... other styles
}}>
```

### 2. component-panel.tsx

Applied identical pattern:
- Added `renderPosition` state
- Added sync effect for when not dragging
- Updated all three drag handlers (start, move, end)
- Changed JSX to use `renderPosition` instead of `position`

## Why This Works

1. **React Stays In Control:** React now knows about position changes through state
2. **No Conflict:** Virtual DOM and real DOM stay synchronized
3. **Smooth Updates:** Direct DOM manipulation provides immediate feedback
4. **Re-render Safe:** Any re-render uses the current `renderPosition` state
5. **Clean Separation:** 
   - `position` prop = source of truth from parent
   - `renderPosition` state = displayed position (may differ during drag)

## Performance Considerations

1. **State Updates:** Calling `setRenderPosition` triggers re-renders, but:
   - React batches updates efficiently
   - Only the dragging component re-renders
   - DOM updates are minimal (React sees position already matches)

2. **Direct DOM Manipulation:** Still kept for immediate visual feedback:
   - Provides instant response to mouse movement
   - No frame delays from React reconciliation
   - Better perceived performance

3. **Best of Both Worlds:**
   - Immediate visual updates (DOM)
   - React awareness (state)
   - No conflicts on re-render

## Testing Checklist

- [x] Drag panels smoothly without jumps
- [x] Drag components smoothly without jumps
- [x] Z-index changes don't cause snap-back
- [x] Isolation state changes don't cause snap-back
- [x] Camera mode toggles don't cause snap-back
- [x] Multiple panels can be dragged sequentially
- [x] Position persists correctly after drop

## Files Modified

1. `/components/canvas/canvas-panel.tsx`
   - Lines 34-49: Added renderPosition state and sync effect
   - Lines 151-156: Added dragStateRef linking
   - Line 616: Update renderPosition on drag start
   - Lines 644-646: Update renderPosition on drag move
   - Line 680: Update renderPosition on drag end
   - Lines 858-859: Use renderPosition in style

2. `/components/canvas/component-panel.tsx`
   - Lines 26-42: Added renderPosition state and sync effect
   - Lines 51-53: Added dragStateRef linking
   - Line 145: Update renderPosition on drag start
   - Lines 173-175: Update renderPosition on drag move
   - Line 199: Update renderPosition on drag end
   - Lines 287-288: Use renderPosition in style

## Rollback Plan

If issues arise, revert the changes:
1. Remove `renderPosition` state
2. Remove `setRenderPosition` calls
3. Change JSX back to use `position.x/y`
4. The direct DOM manipulation code remains unchanged

---

Next: See [reports/2025-09-16-implementation-report.md](./reports/2025-09-16-implementation-report.md) for the complete implementation summary.