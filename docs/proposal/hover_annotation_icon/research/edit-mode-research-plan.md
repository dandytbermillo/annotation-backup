# Research Plan: Hover Icon Not Appearing in Edit Mode

**Date**: 2025-01-10  
**Issue**: Hover icon only works in non-edit mode, not appearing when editor is focused  
**Status**: Research Phase

## Problem Statement
The hover icon (square shape) appears correctly when hovering over annotated text in non-edit mode (editor blurred), but does NOT appear when the editor is in edit mode (focused/active).

## Current Understanding
1. **Working**: Non-edit mode (editor not focused)
2. **Not Working**: Edit mode (editor focused)
3. **Implementation**: Using overlay-based approach with `position: fixed` outside editor DOM

## Research Questions

### 1. Event Propagation Analysis
- [ ] Are mousemove events reaching the handler in edit mode?
- [ ] Is the editor consuming/stopping events when focused?
- [ ] Is there a z-index or pointer-events issue?

### 2. Focus State Investigation
- [ ] How does TipTap/ProseMirror handle events when focused?
- [ ] Are there focus-related event handlers that interfere?
- [ ] Does the editor have different event handling in edit vs read mode?

### 3. DOM Structure Analysis
- [ ] Is the overlay properly positioned above the editor?
- [ ] Are there any CSS properties blocking interaction?
- [ ] Is the annotation element structure different in edit mode?

### 4. Browser Behavior
- [ ] Does contenteditable change event handling when focused?
- [ ] Are there browser-specific focus behaviors?
- [ ] Is the issue consistent across all browsers?

## Debug Plan

### Step 1: Add Comprehensive Logging
```javascript
// Add to hover-icon.ts onMove handler
console.log('[HoverIcon] MouseMove:', {
  target: e.target,
  targetClass: e.target.className,
  isAnnotation: !!getAnnotationEl(e.target),
  editorFocused: view.hasFocus(),
  mouseX: e.clientX,
  mouseY: e.clientY,
  timestamp: Date.now()
})
```

### Step 2: Test Event Listeners
```javascript
// Add test listeners at different levels
document.addEventListener('mousemove', (e) => {
  console.log('[Document] MouseMove:', e.target)
}, true) // Capture phase

view.dom.addEventListener('mousemove', (e) => {
  console.log('[Editor] MouseMove:', e.target)
}, true) // Capture phase
```

### Step 3: Check CSS/DOM Issues
```javascript
// Check computed styles and positioning
const checkOverlay = () => {
  const overlay = document.querySelector('.annotation-hover-overlay')
  const editor = view.dom
  
  console.log('Overlay z-index:', getComputedStyle(overlay).zIndex)
  console.log('Editor z-index:', getComputedStyle(editor).zIndex)
  console.log('Overlay pointer-events:', getComputedStyle(overlay).pointerEvents)
  console.log('Editor pointer-events:', getComputedStyle(editor).pointerEvents)
}
```

## Hypothesis Testing

### Hypothesis 1: Event Consumption
**Theory**: TipTap/ProseMirror consumes mousemove events when focused  
**Test**: Add event listener in capture phase before editor handles it  
**Expected**: Events not reaching our handler in edit mode

### Hypothesis 2: Z-Index Stacking
**Theory**: Editor gains higher z-index when focused  
**Test**: Check computed z-index values in both modes  
**Expected**: Editor z-index changes on focus

### Hypothesis 3: Pointer Events
**Theory**: pointer-events CSS property blocking interaction  
**Test**: Check pointer-events on overlay and editor  
**Expected**: pointer-events set to 'none' incorrectly

### Hypothesis 4: Focus Event Override
**Theory**: Editor registers different event handlers on focus  
**Test**: Log all event listeners on focus/blur  
**Expected**: New handlers added on focus

## Alternative Solutions to Test

### Solution A: Direct Editor Integration
Instead of overlay, integrate directly into editor's event system:
```javascript
editor.view.dom.addEventListener('mouseover', handleHover, true)
```

### Solution B: ProseMirror Plugin
Create a proper ProseMirror plugin that handles hover:
```javascript
new Plugin({
  props: {
    handleDOMEvents: {
      mousemove(view, event) {
        // Handle hover logic here
        return false // Don't consume event
      }
    }
  }
})
```

### Solution C: Mutation Observer
Watch for focus changes and reinitialize:
```javascript
const observer = new MutationObserver(() => {
  if (view.hasFocus()) {
    reinitializeHoverHandlers()
  }
})
```

### Solution D: Force Higher Z-Index
Ensure overlay is always on top:
```javascript
overlay.style.zIndex = '999999'
editor.on('focus', () => {
  overlay.style.zIndex = '999999'
})
```

## Test Scenarios

### Scenario 1: Basic Hover
1. Click in editor to focus
2. Hover over annotated text
3. Check console for events
4. Check if icon element exists in DOM

### Scenario 2: Focus Transition
1. Start in non-edit mode (working)
2. Click to focus editor
3. Hover same annotation
4. Compare event logs between modes

### Scenario 3: Event Path
1. Log event.path in both modes
2. Check if annotation element is in path
3. Check if overlay receives events

## Data Collection

### Metrics to Capture
- Event count in edit vs non-edit mode
- Event target differences
- DOM structure differences
- CSS computed style differences
- Focus state at each event

### Expected Outcomes
1. Identify exact point where events are lost
2. Understand why edit mode blocks hover
3. Find working alternative approach
4. Implement and verify solution

## Next Steps
1. Implement debug logging (Step 1)
2. Test each hypothesis systematically
3. Document findings for each test
4. Select best solution based on results
5. Implement and verify fix

## Success Criteria
- [ ] Icon appears in both edit and non-edit modes
- [ ] No interference with typing or cursor
- [ ] Consistent behavior across browsers
- [ ] Clean, maintainable solution