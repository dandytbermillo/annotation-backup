# Deep Research Plan: Safari Annotation Cursor Issue in Edit Mode

## Problem Statement
**Critical Issue**: In Safari/Electron, when in EDIT MODE, annotated text (spans with annotation marks) cannot be clicked to place cursor, but CAN be edited when cursor is moved there via arrow keys. Normal text works fine with clicks.

### Specific Observed Behaviors
1. **Read-only mode (Edit button OFF)**:
   - All text (both annotated and normal) can be clicked for cursor placement
   - No text can be edited (working as expected)
   
2. **Edit mode (Edit button ON)**:
   - Normal text: Can click to place cursor AND edit ✅
   - Annotated text: CANNOT click to place cursor ❌
   - Annotated text: CAN edit when cursor moved via arrow keys ✅
   - This suggests the text IS editable, but click events are being blocked/mishandled

## Research Questions to Answer

### 1. Event Handling Investigation
- **What happens to click events on annotated spans in Safari?**
  - Are they being preventDefault()'ed by our plugins?
  - Are they bubbling correctly to the editor?
  - Is Safari treating inline-block spans differently for clicks?
  
- **Test needed**: Add console.log to all mousedown/click handlers to trace event flow

### 2. CSS Property Impact Analysis
Research how these CSS properties affect click-to-cursor in Safari:
- `display: inline-block` - Does this prevent cursor placement on click?
- `-webkit-user-modify: read-write-plaintext-only` - Does this affect click handling?
- `user-select: text` - Is selection being prevented?
- `cursor: text` - Is the cursor style affecting clickability?
- `margin-right: 1px` - Does margin interfere with click detection?

### 3. Plugin Interference Mapping
Identify which plugins might be blocking clicks in edit mode:
- `SafariProvenFix` - Applies CSS dynamically
- `SafariManualCursorFix` - Handles mousedown events (should be disabled in edit mode)
- `ReadOnlyGuard` - Filters transactions
- `AnnotationStartBoundaryFix` - Handles annotation boundaries
- Other plugins from `browser-specific-cursor-fix.ts`

### 4. Native Safari Behavior Testing
Create minimal test cases to understand Safari's native behavior:

```html
<!-- Test 1: Basic inline-block span in contenteditable -->
<div contenteditable="true">
  Normal text <span style="display: inline-block; background: yellow;">annotated text</span> more text
</div>

<!-- Test 2: With -webkit-user-modify -->
<div contenteditable="true">
  Normal text <span style="display: inline-block; -webkit-user-modify: read-write-plaintext-only; background: yellow;">annotated text</span> more text
</div>

<!-- Test 3: Without inline-block (just inline) -->
<div contenteditable="true">
  Normal text <span style="display: inline; background: yellow;">annotated text</span> more text
</div>

<!-- Test 4: With all our CSS properties -->
<div contenteditable="true">
  Normal text <span style="display: inline-block; margin-right: 1px; vertical-align: middle; line-height: 1; -webkit-user-modify: read-write-plaintext-only; -webkit-user-select: text; user-select: text; caret-color: auto; background: yellow;">annotated text</span> more text
</div>
```

### 5. ProseMirror/TipTap Specific Investigation
- How does ProseMirror handle clicks on marks?
- Is there a conflict between our mark definition and Safari's click handling?
- Are we missing a ProseMirror-specific solution?

### 6. Comparative Analysis
Research how other editors handle this exact scenario:
- **Notion**: How do they handle clickable highlights in Safari?
- **Google Docs**: Do they use custom cursor handling for this?
- **Medium**: How does their highlight implementation work?
- **Obsidian**: Known to work well in Electron - what's their approach?
- **Roam Research**: Uses similar annotation system

## Debugging Steps to Execute

### Step 1: Event Flow Tracing
```javascript
// Add to all our plugins
console.log('Event:', event.type, 'Target:', event.target, 'Prevented:', event.defaultPrevented)
```

### Step 2: CSS Isolation Test
Temporarily disable each CSS property one by one:
1. Remove `display: inline-block` - does clicking work?
2. Remove `-webkit-user-modify` - does clicking work?
3. Remove margin - does clicking work?
4. Test with minimal CSS - just background color

### Step 3: Plugin Isolation Test
Disable plugins one by one:
1. Comment out `SafariProvenFix` - test
2. Comment out `SafariManualCursorFix` - test  
3. Comment out `ReadOnlyGuard` - test
4. Comment out all Safari-specific fixes - test

### Step 4: Direct DOM Manipulation Test
```javascript
// In browser console, try forcing cursor placement
const annotation = document.querySelector('.annotation')
const range = document.createRange()
const sel = window.getSelection()
range.setStart(annotation.firstChild, 0)
range.collapse(true)
sel.removeAllRanges()
sel.addRange(range)
```

## Hypotheses to Test

### Hypothesis 1: CSS Conflict
**Theory**: The combination of `display: inline-block` with `-webkit-user-modify` prevents Safari from handling clicks properly.
**Test**: Remove one or both properties and test clicking.

### Hypothesis 2: Event Handler Conflict  
**Theory**: One of our plugins is preventing default on mousedown/click in edit mode.
**Test**: Add logging to verify no preventDefault() is called in edit mode.

### Hypothesis 3: ProseMirror Mark Handling
**Theory**: The way we define annotation marks conflicts with Safari's contenteditable.
**Test**: Try a different mark configuration or use decorations instead.

### Hypothesis 4: Focus/Selection Issue
**Theory**: Safari loses focus or can't create selection on styled inline-block elements.
**Test**: Force focus and selection programmatically on click.

### Hypothesis 5: Z-index/Stacking Context
**Theory**: The annotation spans create a stacking context that interferes with clicks.
**Test**: Add `z-index: 0` or `position: relative` adjustments.

## Research Resources to Consult

1. **WebKit Bug Tracker**: Search for "contenteditable inline-block cursor" issues
2. **ProseMirror Forums**: Search for "Safari mark click cursor"
3. **Stack Overflow**: "Safari contenteditable span not clickable"
4. **TipTap GitHub Issues**: Safari-specific cursor problems
5. **MDN Web Docs**: Safari-specific contenteditable quirks
6. **Can I Use**: Compatibility notes for contenteditable features

## Expected Outcomes

After completing this research, we should:
1. Understand exactly why Safari can't place cursor on click in annotated text
2. Have a minimal reproducible test case
3. Know which CSS property or event handler is causing the issue
4. Have identified how other editors solve this exact problem
5. Have a clear fix that maintains all functionality

## Alternative Solutions to Consider

If the issue cannot be fixed directly:
1. **Use decorations instead of marks** for annotations in Safari
2. **Custom click handler** that programmatically places cursor
3. **Different CSS approach** - perhaps using `<mark>` tags or backgrounds
4. **Overlay approach** - clickable transparent overlay that forwards clicks
5. **Disable problematic CSS only in edit mode** - apply different styles when editing

## Success Criteria

The fix is successful when:
- [ ] In edit mode, clicking on annotated text places cursor at click position
- [ ] In edit mode, typing in annotated text works normally
- [ ] In read-only mode, clicking still works for cursor placement
- [ ] No regression in Firefox or Chrome
- [ ] No visual changes to annotation appearance
- [ ] Arrow key navigation still works

## Timeline

1. **Immediate** (5 mins): Test minimal HTML cases in Safari
2. **Quick** (15 mins): Event flow tracing and logging
3. **Medium** (30 mins): CSS isolation testing
4. **Deep** (1 hour): Research other editor implementations
5. **Implementation** (30 mins): Apply discovered fix

This research plan should help identify the exact cause and solution for the Safari annotation cursor issue in edit mode.