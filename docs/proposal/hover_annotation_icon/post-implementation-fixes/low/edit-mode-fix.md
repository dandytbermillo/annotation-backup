# Edit Mode Hover Icon Fix

**Date**: 2025-01-10
**Issue**: Hover icon only appearing in non-edit mode
**Status**: Fixed

## Problem
The hover icon was not appearing when the editor was in edit mode (focused). It only worked in non-edit mode (blurred).

## Root Cause
The `isEditing()` function in `hover-icon.ts` was too restrictive:

```typescript
// BEFORE (too restrictive)
const isEditing = () =>
  view.hasFocus() && view.state.selection.from === view.state.selection.to
```

This checked:
1. If the view has focus (correct)
2. AND if the selection is collapsed/cursor position (incorrect restriction)

The second condition meant the icon would only show in edit mode if the cursor was at a single point, not when:
- Text was selected
- Mouse was hovering without clicking
- User was in the middle of editing

## Solution
Simplified the condition to only check focus state:

```typescript
// AFTER (fixed)
const isEditing = () =>
  view.hasFocus()
```

Now the function correctly:
- Returns `true` when editor is focused (edit mode)
- Returns `false` when editor is blurred (non-edit mode)
- Doesn't depend on selection state

## Impact
- Icon now appears in both edit and non-edit modes
- Different offset is applied based on mode:
  - Non-edit mode: 24px above text
  - Edit mode: 36px above text (more space for cursor)
- Icon behavior is consistent regardless of selection state

## Testing
1. Click in editor to focus (edit mode)
   - Hover annotated text → icon appears at 36px offset
2. Click outside editor to blur (non-edit mode)  
   - Hover annotated text → icon appears at 24px offset
3. Select text in edit mode
   - Hover annotated text → icon still appears
4. Type in edit mode
   - Icon fades to 0.35 opacity during typing

## Files Changed
- `components/canvas/hover-icon.ts` (line 106-107)
