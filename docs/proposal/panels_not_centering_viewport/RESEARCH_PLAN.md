# Research Plan: Panels Not Centering Viewport on Note Open

**Date:** 2025-10-12
**Status:** 🔴 ACTIVE INVESTIGATION
**Priority:** HIGH

## Problem Statement

When opening notes from the Recent Notes panel or organization popup, the panel consistently appears in the **upper-left corner of the viewport** instead of being centered. This issue persists despite multiple attempted fixes.

### Expected Behavior
- Panel should appear **instantly** (no slide animation)
- Panel should be **centered** in the viewport
- Behavior should be **consistent** across all notes

### Actual Behavior
- Panel appears near upper-left corner of viewport
- Position varies slightly between different notes
- Centering logic is not working as expected

---

## Affected Files

### Primary Files (Modified During Investigation)

1. **`components/annotation-app.tsx`** (lines 719-792)
   - Contains retry mechanism for waiting until canvas mounts
   - Calls `centerOnPanel` when note is selected
   - Issue: Canvas ref becomes available, but centering still fails

2. **`components/annotation-canvas-modern.tsx`** (lines 838-926, 294-407, 1044-1059)
   - `centerOnPanel` function implementation (lines 838-926)
   - Canvas state loading from storage (lines 294-407)
   - Canvas transform CSS with transition property (lines 1044-1059)
   - Multiple attempted fixes implemented here

3. **`lib/canvas/pan-animations.ts`** (entire file)
   - Contains `smoothPanTo` and `panToPanel` functions
   - Handles viewport positioning logic
   - Uses `duration: 0` for instant positioning

4. **`lib/canvas/canvas-storage.ts`**
   - Saves/loads viewport position for each note
   - May be causing race conditions with centering logic

---

## Root Causes Discovered

### 1. CSS Transition Override (PARTIALLY SOLVED)
**Issue:** Even with `duration: 0` in JavaScript, the CSS `transition: 'transform 0.3s ease'` property causes the browser to animate the transform change.

**Attempted Fix:**
- Used `flushSync` to disable transition before transform update
- Used direct DOM manipulation to set `transition: 'none'`
- Forced reflow with `offsetHeight`

**Status:** 🟡 Partially working (no slide animation), but centering still broken

### 2. Canvas Storage Race Condition (IDENTIFIED)
**Issue:** Saved viewport positions from storage are interfering with centering logic.

**Evidence from Debug Logs:**
```
Note 1: position: {"x": 4228.99, "y": 2466.99}
Note 2: position: {"x": 2014.89, "y": 1627.36}
Note 3: position: {"x": 1869.44, "y": 1561.54}
Note 4: position: {"x": 2299.99, "y": 1749.99}
```

Each note has different saved positions, causing inconsistent centering.

**Attempted Fix:**
- Reset viewport to default position when loading state
- Reset main panel position to default (2000, 1500)
- Skip restoring `translateX` and `translateY` from storage

**Status:** 🔴 NOT WORKING - panels still appear in upper-left corner

### 3. Viewport State Not Resetting Between Notes (CURRENT HYPOTHESIS)
**Issue:** When switching notes, the viewport keeps stale values from the previous note.

**Evidence:**
```javascript
// Debug log shows calculation using wrong viewport:
currentX: -1000, currentY: -1200  // ← Should be updated but isn't
```

**Current Fix Attempt:**
```javascript
// Reset viewport to defaults when loading new note
setCanvasState((prev) => ({
  ...prev,
  translateX: defaultViewport.translateX,  // -1000
  translateY: defaultViewport.translateY,  // -1200
}))
```

**Status:** 🔴 NEEDS VERIFICATION

---

## Technical Details

### Coordinate System
- **World coordinates:** Panel positions (e.g., `x: 2000, y: 1500`)
- **Viewport coordinates:** Camera position (e.g., `translateX: -1000, translateY: -1200`)
- **Screen coordinates:** User's visible area (0, 0 to window width/height)

### Centering Formula (from `panToPanel` + `smoothPanTo`)
```javascript
// Calculate center offset
const centerOffset = {
  x: (viewportWidth / 2 - panelWidth / 2) / zoom,
  y: (viewportHeight / 2 - panelHeight / 2) / zoom
}

// Calculate target viewport position
const targetX = -panelPosition.x + centerOffset.x
const targetY = -panelPosition.y + centerOffset.y
```

### Panel Dimensions
- Actual: Read from DOM via `offsetWidth` / `offsetHeight`
- Fallback: 500x400 (used in `panToPanel` function)
- Current implementation: Reading from DOM (600x500 per debug logs)

---

## Investigation Steps Taken

### Attempt 1: Fix Slide Animation with `duration: 0`
❌ Failed - CSS transition still active

### Attempt 2: Disable CSS Transition with `isInstantCentering` Flag
❌ Failed - React batched state updates, flag set/cleared in same render

### Attempt 3: Use `flushSync` to Force Separate Renders
❌ Failed - Still didn't prevent transition animation

### Attempt 4: Direct DOM Manipulation + Reflow
✅ Partially successful - Eliminated slide animation
🔴 But centering still broken

### Attempt 5: Skip Viewport Restoration from Storage
🔴 Failed - Panels appeared in upper-left corner (current state)

### Attempt 6: Reset Viewport to Defaults on Note Load
🔴 Needs verification - Just implemented

---

## Debug Logs Analysis

### Latest Test Session (2025-10-12 03:00:26)

**Centering Calculation:**
```json
{
  "panelId": "main",
  "panelFound": true,
  "panelDimensions": {"width": 600, "height": 500},
  "viewportDimensions": {"width": 1554, "height": 892},
  "zoom": 1,
  "position": {"x": 2299.99, "y": 1749.99},
  "targetX": -1822.99,
  "targetY": -1553.99,
  "currentX": -1000,
  "currentY": -1200
}
```

**Analysis:**
- Panel found: ✅
- Dimensions read correctly: ✅
- Target calculated: ✅
- Viewport updated to target: ✅
- **But panel still appears in wrong position on screen**

**Possible Causes:**
1. Target calculation is incorrect
2. Viewport update is being overridden after centering
3. Coordinate system transformation is wrong
4. Panel position in DOM doesn't match world coordinates

---

## Next Investigation Steps

### 1. Verify Viewport Reset is Applied
- [ ] Check if `defaultViewport.translateX/translateY` values are correct
- [ ] Verify state is actually updated before `centerOnPanel` is called
- [ ] Add debug logs to confirm viewport state at time of centering

### 2. Check for Post-Centering Overrides
- [ ] Add debug log after `centerOnPanel` completes
- [ ] Check if any useEffect or state update overwrites the centered position
- [ ] Monitor canvas storage auto-save - might be restoring old position

### 3. Validate Centering Math
- [ ] Manually calculate expected viewport position
- [ ] Compare with actual target values in debug logs
- [ ] Test with simplified coordinates (panel at 0,0)

### 4. Inspect CSS Transform Application
- [ ] Check if `transform` style is actually applied in DOM
- [ ] Verify no other CSS is overriding the transform
- [ ] Check for race conditions with React render cycles

### 5. Test Panel Position in World Coordinates
- [ ] Verify panel's `data-panel-id="main"` element exists
- [ ] Check panel's inline style or CSS transform
- [ ] Confirm panel position matches expected world coordinates

---

## Questions to Answer

1. **Why is the target calculation correct but the visual result wrong?**
   - Is the viewport actually moving to the target position?
   - Is there a coordinate system mismatch?

2. **When exactly does the viewport position get set/overridden?**
   - Timeline of state updates during note load
   - Order of: storage load → viewport reset → centerOnPanel → render

3. **Is the panel actually at the expected world coordinates?**
   - Check panel's DOM position
   - Verify transform is applied correctly

4. **Does auto-save restore the old position immediately after centering?**
   - Check if `saveStateToStorage` runs after centering
   - Check debounce timing

---

## Files to Review

### Storage System
- [ ] `lib/canvas/canvas-storage.ts` - When is state saved/loaded?
- [ ] How does auto-save interact with manual viewport changes?

### Canvas Rendering
- [ ] How does `canvasState` affect the actual DOM transform?
- [ ] Is there a delay between state update and DOM render?

### Panel Component
- [ ] `components/canvas/canvas-panel.tsx` - How is position applied?
- [ ] Does panel override its position based on saved state?

---

## Success Criteria

✅ Panel appears instantly (no animation) - **ACHIEVED**
🔴 Panel appears centered in viewport - **NOT ACHIEVED**
🔴 Consistent behavior across all notes - **NOT ACHIEVED**

---

## Related Documents

- **Debug Issue Document:** `DEBUG_PANEL_SLIDE_ISSUE.md`
- **Affected Files Backup:** `docs/proposal/panels_not_centering_viewport/affected_files/`

---

## Notes

- The slide animation issue was successfully resolved using DOM manipulation
- The centering issue appears to be related to viewport state management
- Storage system may be the root cause (saving/restoring viewport per note)
- Need to decouple "viewport position" from "note identity" for consistent centering
