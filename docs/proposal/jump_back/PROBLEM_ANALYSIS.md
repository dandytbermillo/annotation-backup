# Panel Jump-Back Issue - Problem Analysis

**Feature Slug:** `jump_back`  
**Date:** 2025-09-16  
**Status:** RESOLVED ✅

## Problem Statement

Canvas panels and components would occasionally "jump back" or "snap back" to their original position during dragging, especially when other UI updates occurred (z-index changes, isolation updates, camera flag checks, etc.).

## Root Cause Analysis

### The Anti-Pattern
The codebase was mixing **imperative DOM manipulation** with **React's declarative rendering**:

1. **During drag:** Code directly mutated `panel.style.left` and `panel.style.top`
2. **In JSX:** React still declared `style={{ left: position.x, top: position.y }}`
3. **On re-render:** React would reset the DOM to match its virtual DOM, causing panels to jump back

### Code Example (Before Fix)
```typescript
// In drag handler - IMPERATIVE
const handleMouseMove = (e) => {
  const newLeft = initialPosition.x + deltaX
  const newTop = initialPosition.y + deltaY
  
  // Direct DOM manipulation
  panel.style.left = newLeft + 'px'
  panel.style.top = newTop + 'px'
}

// In render - DECLARATIVE
return (
  <div style={{
    left: position.x + 'px',  // ← React thinks this is the position
    top: position.y + 'px',    // ← Will reset on any re-render!
  }}>
)
```

### When The Problem Occurred
The snap-back happened whenever React re-rendered the component while dragging:
- Z-index changes (bringing panel to front)
- Isolation state updates
- Camera mode checks
- Any parent component re-render
- Any state update in the component

## Why This Matters

1. **User Experience:** Jarring visual glitches during drag operations
2. **Data Integrity:** Position might not save correctly if interrupted
3. **Performance:** Fighting between React and DOM causes unnecessary reflows
4. **Code Quality:** Mixing paradigms makes the code harder to maintain

## Technical Details

### React's Reconciliation Process
When React re-renders, it:
1. Computes the virtual DOM from props/state
2. Diffs against the previous virtual DOM
3. Updates the real DOM to match
4. **Overwrites any manual DOM changes not reflected in state**

### The Conflict
```
User drags panel → Direct DOM update → Panel moves visually
                                     ↓
React re-renders → Virtual DOM says different position
                                     ↓
                   Real DOM reset → Panel jumps back
```

## Symptoms Observed

1. **Visual Jump:** Panel suddenly teleports back during drag
2. **Inconsistent Behavior:** Sometimes smooth, sometimes jumpy
3. **Correlation with UI Updates:** More likely when other UI elements update
4. **Both Panels Affected:** Happened in both `canvas-panel.tsx` and `component-panel.tsx`

## Files Affected

- `/components/canvas/canvas-panel.tsx` - Main canvas panels
- `/components/canvas/component-panel.tsx` - Component panels (calculator, timer, etc.)

## Solution Required

Keep React's virtual DOM synchronized with DOM mutations during drag operations. This requires tracking the "render position" in React state and updating it alongside DOM changes.

---

Next: See [IMPLEMENTATION_FIX.md](./IMPLEMENTATION_FIX.md) for the solution details.