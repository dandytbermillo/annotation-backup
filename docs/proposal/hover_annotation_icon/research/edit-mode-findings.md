# Edit Mode Research Findings

**Date**: 2025-01-10
**Issue**: Hover icon only appears in non-edit mode

## Attempts Made

### Attempt 1: Fix isEditing() function
**Change**: Simplified `isEditing()` from checking focus + cursor to just focus
```typescript
// Before
const isEditing = () => view.hasFocus() && view.state.selection.from === view.state.selection.to

// After  
const isEditing = () => view.hasFocus()
```
**Result**: ❌ Did not fix the issue

### Attempt 2: Document-level event listener
**Change**: Moved from `view.dom` listener to `document` listener
```typescript
// Before
view.dom.addEventListener('mousemove', onMove, { passive: true })

// After
document.addEventListener('mousemove', documentMoveHandler, { passive: true })
```
**Rationale**: Events might not bubble properly from contenteditable in edit mode
**Result**: Testing in progress

### Attempt 3: Debug logging
**Added**: Comprehensive logging to understand event flow
- Log all mousemove events with target info
- Log annotation detection
- Log focus state
- Log event path

## Key Observations

1. **Event Handling Difference**: 
   - Non-edit mode: Events bubble normally
   - Edit mode: Possible event consumption by ProseMirror

2. **DOM Structure**:
   - Overlay is at document level (`position: fixed`)
   - Editor is nested inside multiple containers
   - Z-index set to 999999 for overlay

3. **Focus Impact**:
   - When editor has focus, it may have different event handling
   - ContentEditable behavior changes when focused

## Current Hypothesis

The issue is likely that ProseMirror/TipTap handles events differently when the editor is focused (edit mode). The editor might be:
1. Consuming mousemove events
2. Preventing event bubbling
3. Adding its own event handlers that interfere

## Next Steps to Try

### Solution A: ProseMirror Plugin Approach
Create a proper ProseMirror plugin instead of external overlay:
```typescript
new Plugin({
  props: {
    handleDOMEvents: {
      mousemove(view, event) {
        // Handle hover icon display
        return false // Don't consume
      }
    }
  }
})
```

### Solution B: Force Event Capture
Use capture phase to get events before editor:
```typescript
document.addEventListener('mousemove', handler, { 
  capture: true, // Get event in capture phase
  passive: false 
})
```

### Solution C: Editor State Integration
Hook into editor's update cycle:
```typescript
editor.on('selectionUpdate', ({ editor }) => {
  // Check if mouse is over annotation
  // Update icon position
})
```

## Debug Output Needed

To confirm the hypothesis, we need to see:
1. Are mousemove events firing at all in edit mode?
2. What is the event target in edit vs non-edit mode?
3. Is the annotation element detected in both modes?
4. What is the event.composedPath() difference?

## Temporary Workaround

If we can't fix the root cause, consider:
- Only showing icon in non-edit mode (current behavior)
- Adding a keyboard shortcut to show annotations in edit mode
- Using a different trigger (click instead of hover) in edit mode