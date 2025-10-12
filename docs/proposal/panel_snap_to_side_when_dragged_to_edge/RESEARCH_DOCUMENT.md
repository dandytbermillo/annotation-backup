# Panel Snap to Side Issue - Deep Research Document

**Status:** ACTIVE INVESTIGATION
**Created:** 2025-01-12
**Priority:** HIGH
**Impact:** All panel drag operations to viewport edges

---

## Problem Statement

When dragging any panel (main or branch) to any edge of the viewport to trigger auto-scroll, the panels visually "snap" or "jump" to the right side of the screen. This happens on **FIRST drag only** after app loads or note opens. Subsequent drags work correctly.

### Reproduction Steps

1. Open app or load a note
2. Drag main panel (or any panel) toward ANY viewport edge (top/left/right/bottom)
3. When auto-scroll triggers → panels snap to right side
4. Release drag, drag again to edge → works correctly (no snap)

### User Impact

- Poor UX - panels jump unexpectedly during first drag
- Affects both main and branch panels
- Consistent across all viewport edges

---

## Investigation Timeline

### Initial Observations

**Date:** 2025-01-12
**Findings:**
- Issue only occurs on FIRST drag to edge
- Subsequent drags work correctly
- Affects all edges equally (top, bottom, left, right)
- Both main and branch panels affected simultaneously

### Hypothesis 1: Position Prop Changes During Drag

**Theory:** The position prop changes mid-drag, triggering a useEffect that resets panel position.

**Evidence:**
- Debug logs showed position prop changing from `{2000, 1500}` → `{1979, 1237}` during first drag
- `position_update_skipped_during_drag` log confirms useEffect is correctly blocked
- Position prop doesn't change during subsequent drags

**Conclusion:** ❌ DISPROVEN - useEffect is blocked correctly, not the cause

### Hypothesis 2: Panel Position Reset via useEffect

**Theory:** Panel's position sync useEffect (lines 333-370 in canvas-panel.tsx) fires during drag.

**Evidence:**
```typescript
useEffect(() => {
  const isPanelBeingDragged = globalDraggingPanelId === panelId
  if (!isPanelBeingDragged) {
    setRenderPosition(position)
  }
}, [position, panelId])
```

**Testing:**
- Added `globalDraggingPanelId` check
- Removed `canvasNode?.position` from dependencies
- Logs show effect is skipped during drag

**Conclusion:** ❌ DISPROVEN - Effect correctly skips during drag

### Hypothesis 3: VIEWPORT PANNING (CONFIRMED ROOT CAUSE)

**Theory:** The canvas viewport itself is resetting to default position during auto-scroll.

**EVIDENCE FROM DEBUG LOGS:**

```
Time: 18:34:20.543 | auto_scroll_comprehensive_state
  canvasTransform: "matrix(1, 0, 0, 1, -1523, -1304)"  ← Correct position

Time: 18:34:20.559 | viewport_changed (16ms later)
  canvasTransform: "matrix(1, 0, 0, 1, -1000, -1199.9)"  ← RESET TO DEFAULT!

Delta: X jumped +523px right, Y jumped +104px
```

**Key Finding:**
- translateX is STUCK at -1000 (default centered X)
- translateY changes correctly during auto-scroll
- Viewport X resets to default BETWEEN every auto-scroll event

**Conclusion:** ✅ CONFIRMED - This is the root cause

---

## Technical Analysis

### The Bug Mechanism

1. **Initial State:**
   - Viewport correctly positioned at (-1523, -1304) to center panel
   - Panel at world position (2000, 1500)

2. **First Drag to Edge:**
   - Auto-scroll triggers
   - `panCameraBy()` dispatches: `translateX: -1523 - deltaX, translateY: -1304 - deltaY`
   - **BUT** something immediately dispatches: `translateX: -1000, translateY: -1200`
   - Result: Viewport X resets to default, appears as if panels snap right

3. **Subsequent Drags:**
   - Viewport already at (-1000, -1200) range
   - Auto-scroll works correctly
   - No visible snap because viewport doesn't need to reset

### Canvas Transform Matrix

The transform matrix `matrix(scaleX, skewY, skewX, scaleY, translateX, translateY)`:
- `-1000, -1200` = Default centered viewport
- `-1523, -1304` = Calculated center for panel at (2000, 1500)

When translateX jumps from -1523 → -1000, viewport moves **523px RIGHT**, making panels appear to snap to the right.

---

## Code Flow Analysis

### Auto-Scroll Trigger Path

```
1. User drags panel near edge
   └─> useAutoScroll.checkAutoScroll()
       └─> Calculates velocity based on edge proximity
           └─> useAutoScroll animation loop
               └─> onScroll(velocityX, velocityY) callback
                   └─> canvas-panel.tsx: handleAutoScroll()
                       └─> panCameraBy({ dxScreen, dyScreen })
                           └─> use-canvas-camera.ts: panCameraBy()
                               └─> dispatch({ type: 'SET_CANVAS_STATE', payload: { translateX, translateY }})
                                   └─> canvas-context.tsx: canvasReducer
                                       └─> PROBLEM: Something else dispatches here!
```

### Viewport Reset Sources (Potential Culprits)

**1. Default Viewport Constant**
- File: `components/annotation-canvas-modern.tsx:59-64`
```typescript
const defaultViewport = {
  zoom: 1,
  translateX: -1000,  // ← This value appears in logs
  translateY: -1200,
  showConnections: true,
}
```

**2. createDefaultCanvasState()**
- File: `components/annotation-canvas-modern.tsx:67-76`
- Returns `defaultViewport` values

**3. Note Loading useEffect**
- File: `components/annotation-canvas-modern.tsx:336-697`
- Dependencies: `[noteId, canvasState.zoom, onSnapshotLoadComplete]`
- Calls `setCanvasState(createDefaultCanvasState())` on line 338
- **Question:** Could this be re-running during drag?

**4. resetView() Function**
- File: `components/annotation-canvas-modern.tsx:1087-1093`
```typescript
resetView: () => {
  updateCanvasTransform(prev => {
    const next = { ...prev, zoom: 1, translateX: -1000, translateY: -1200 }
    return next
  })
}
```

**5. Canvas Controls (commented out)**
- File: `components/annotation-canvas-modern.tsx:1301`
- Commented out but exists in code

---

## Debug Log Evidence

### Log Query Used

```sql
SELECT
  to_char(created_at, 'HH24:MI:SS.MS') as time,
  component,
  action,
  metadata->>'canvasTransform' as transform
FROM debug_logs
WHERE action = 'auto_scroll_comprehensive_state'
  AND created_at >= NOW() - INTERVAL '2 minutes'
ORDER BY created_at ASC;
```

### Key Log Sequences

**First Drag - Viewport Resets:**
```
18:34:20.543 | auto_scroll_comprehensive_state | transform: matrix(..., -1523, -1304)
18:34:20.559 | viewport_changed | from: {x: -1523} to: {x: -1000}
18:34:20.580 | auto_scroll_comprehensive_state | transform: matrix(..., -1000, -1199.9)
18:34:20.584 | viewport_changed | from: {x: -1000} to: {x: -1000}
```

**Pattern:** translateX resets from -1523 to -1000, then stays at -1000

**Second Drag - Works Correctly:**
```
(No viewport_changed logs with X coordinate changes)
translateX remains stable throughout drag
```

---

## Affected Files

### Primary Files

1. **components/canvas/canvas-panel.tsx** (2800+ lines)
   - Panel drag handling
   - Auto-scroll callback
   - Calls `panCameraBy()`

2. **lib/hooks/use-canvas-camera.ts** (110 lines)
   - Implements `panCameraBy()` function
   - Dispatches SET_CANVAS_STATE to canvas context
   - **Current payload:** `{ translateX: newX, translateY: newY }`

3. **components/canvas/canvas-context.tsx** (200+ lines)
   - Canvas reducer handling SET_CANVAS_STATE
   - **Reducer line 48-52:** Spreads payload into state

4. **components/annotation-canvas-modern.tsx** (1500+ lines)
   - Main canvas component
   - Note loading useEffect (line 336)
   - Default viewport constants (line 59)
   - Centering logic

5. **components/canvas/use-auto-scroll.ts** (147 lines)
   - Detects edge proximity
   - Triggers auto-scroll animation loop
   - Calls onScroll callback

### Supporting Files

6. **lib/utils/debug-logger.ts**
   - Debug logging infrastructure

7. **docs/proposal/panels_not_centering_viewport/research_result.md**
   - Previous related investigation

---

## What We Know

### ✅ Confirmed Facts

1. **Viewport X resets to -1000 during first drag auto-scroll**
   - Proven by canvas transform logs
   - translateX changes from -1523 → -1000
   - This is the visual "snap to right"

2. **Panel position useEffect is NOT the cause**
   - useEffect correctly skips during drag
   - Logs show `position_update_skipped_during_drag`

3. **panCameraBy() dispatches correct values**
   - Added logging shows both X and Y in payload
   - Dispatch includes `{ translateX: newX, translateY: newY }`

4. **Issue is viewport-level, not panel-level**
   - Both main and branch panels affected simultaneously
   - Panels don't move - viewport moves instead

5. **All edges trigger the issue equally**
   - Top, bottom, left, right all show same behavior
   - Confirmed by user testing

6. **Only first drag affected**
   - Second and subsequent drags work perfectly
   - Something initializes/changes after first drag

### ❓ Unknown / Unproven

1. **What code dispatches translateX: -1000?**
   - We see it in logs but haven't traced the caller
   - Need console.trace() in reducer

2. **Why does it only happen on first drag?**
   - What changes after first drag completes?
   - Is something being initialized?

3. **Why only translateX affected?**
   - translateY updates correctly
   - Why is X special?

4. **Does noteId or any dependency change during drag?**
   - Could trigger useEffect re-run
   - Haven't logged dependency changes

---

## Attempted Fixes (Failed)

### Fix 1: Remove canvasNode?.position from useEffect deps
**File:** canvas-panel.tsx:370
**Rationale:** Thought LayerManager position changes were triggering effect
**Result:** ❌ Failed - Still snaps
**Why Failed:** Effect wasn't the problem

### Fix 2: Use globalDraggingPanelId for skip check
**File:** canvas-panel.tsx:336
**Rationale:** More reliable than dragStateRef during re-renders
**Result:** ❌ Failed - Still snaps
**Why Failed:** Effect skip was already working

### Fix 3: Disable auto-save
**File:** annotation-canvas-modern.tsx:1035
**Rationale:** Thought auto-save was interfering
**Result:** ❌ Failed - Still snaps
**Why Failed:** Auto-save wasn't involved

### Fix 4: Disable position loading
**File:** annotation-canvas-modern.tsx:348-349
**Rationale:** Prevent old positions from loading
**Result:** ❌ Failed - Still snaps
**Why Failed:** Loading wasn't the trigger

### Fix 5: Remove setRenderPosition during auto-scroll
**File:** canvas-panel.tsx:571-572
**Rationale:** Prevent React state updates during drag
**Result:** ❌ Failed - Still snaps
**Why Failed:** Panel position wasn't the issue - viewport was

---

## Next Steps (Recommended Approach)

### Step 1: Add Stack Trace to Reducer ⚠️ CRITICAL

**File:** `components/canvas/canvas-context.tsx`
**Location:** Line 48, inside `SET_CANVAS_STATE` case

Add:
```typescript
case "SET_CANVAS_STATE":
  if (action.payload.translateX !== undefined) {
    console.trace('SET_CANVAS_STATE with translateX:', action.payload.translateX)
    // Also log to database
    debugLog({
      component: 'CanvasContext',
      action: 'SET_CANVAS_STATE_translateX',
      metadata: {
        translateX: action.payload.translateX,
        translateY: action.payload.translateY,
        stackTrace: new Error().stack
      }
    })
  }
  return {
    ...state,
    canvasState: { ...state.canvasState, ...action.payload },
  }
```

**Purpose:** Capture EVERY dispatch that changes translateX with full stack trace

### Step 2: Test and Analyze Stack Traces

1. Reproduce issue (drag to edge on first drag)
2. Check browser console for stack traces
3. Identify which code path dispatches translateX: -1000
4. Determine why it only happens on first drag

### Step 3: Fix the Actual Source

Once stack trace reveals the source:
- If it's the note loading useEffect → Add drag check
- If it's centering logic → Add timing guard
- If it's something else → Fix that specific code path

### Step 4: Verify Fix

1. Test all edges (top, left, right, bottom)
2. Test with main panel only
3. Test with main + branch panels
4. Test first drag and subsequent drags
5. Verify no regressions in centering behavior

---

## Senior Engineer Review

### What Went Wrong in This Investigation

1. **Rushed to fix before understanding**
   - Made 5+ changes without finding root cause
   - Each fix addressed symptoms, not source

2. **Didn't add proper instrumentation early**
   - Should have added stack trace logging first
   - Wasted time on guesses

3. **Assumed panel-level issue initially**
   - Took too long to realize it's viewport-level
   - Led us down wrong path

### What Went Right

1. **Comprehensive debug logging**
   - Canvas transform logging revealed the truth
   - Position tracking showed useEffect was innocent

2. **Methodical hypothesis testing**
   - Each hypothesis documented and tested
   - Clear evidence for each conclusion

3. **User-reported edge testing**
   - Confirmed issue across all edges
   - Eliminated edge-specific theories

### Lessons Learned

1. **Always get stack traces for unexpected dispatches**
   - console.trace() is your friend
   - Don't guess at call sources

2. **Check viewport first for "panel jumping" issues**
   - Panel position can be correct
   - Viewport change causes visual jump

3. **Log both attempted and actual state changes**
   - Compare "what we dispatched" vs "what happened"
   - Reveals middleware or interception

---

## File Structure

```
docs/proposal/panel_snap_to_side_when_dragged_to_edge/
├── RESEARCH_DOCUMENT.md (this file)
├── affected_files/
│   ├── canvas-panel.tsx
│   ├── use-canvas-camera.ts
│   ├── canvas-context.tsx
│   ├── annotation-canvas-modern.tsx
│   └── use-auto-scroll.ts
└── debug_queries/
    └── viewport_tracking.sql
```

---

## Related Issues

- **panels_not_centering_viewport** - Previous centering issue investigation
- May share root cause with centering logic

---

## Contact

For questions about this investigation, reference:
- Debug log table: `debug_logs`
- Time range: 2025-01-12 18:28:00 - 18:35:00
- Key log actions: `auto_scroll_comprehensive_state`, `viewport_changed`, `panCameraBy_dispatch`
