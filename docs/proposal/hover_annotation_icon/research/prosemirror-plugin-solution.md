# ProseMirror Plugin Solution for Edit Mode Hover

**Date**: 2025-01-10  
**Status**: Implemented  
**Based on**: Production patterns from Notion, TipTap, Medium research

## Problem Solved
The hover icon was not appearing in edit mode (when editor is focused) because the overlay-based approach was listening for events at the document level, and ProseMirror was handling events differently when focused.

## Solution: ProseMirror Plugin with handleDOMEvents

Following the research findings from production editors, we implemented a **ProseMirror Plugin** that:

1. **Intercepts mousemove events** directly in the editor's event system
2. **Works in both edit and non-edit modes** because it's integrated with the editor
3. **Uses the overlay pattern** for rendering (icon outside editor DOM)
4. **Follows UX best practices** (300ms delay, debouncing, no layout shift)

## Implementation Details

### File: `annotation-hover-plugin.ts`

```typescript
export function AnnotationHoverPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousemove(view: EditorView, event: MouseEvent) {
          // Detect annotation under mouse
          const annotation = target.closest('.annotation')
          
          if (annotation) {
            // Show icon after 300ms delay (UX guideline)
            setTimeout(() => {
              iconManager.show(centerX, topY, branchId, type)
            }, 300)
          }
          
          return false // Don't consume event
        }
      }
    }
  })
}
```

### Key Features

1. **Plugin State Management**
   - Tracks hovered annotation, branch ID, and mouse position
   - Updates via ProseMirror transactions for consistency

2. **Icon Manager Pattern**
   - Separate manager handles the overlay UI
   - Icon lives outside editor DOM (no interference)
   - Maintains hover state independently

3. **Event Handling**
   - Uses `handleDOMEvents` to intercept mousemove
   - Returns `false` to not consume events
   - Works even when editor is focused

4. **UX Considerations**
   - 300ms delay before showing (prevents flicker)
   - 200ms hide delay (allows moving to icon)
   - Visual feedback on hover (scale, shadow)
   - Click to open panel functionality

## Why This Works

From the research:
> "In editors based on ProseMirror (including TipTap), the robust way to track hover state in edit mode is to use a plugin with event hooks."

> "By hooking into ProseMirror's event system, you ensure your hover logic runs even when the editor is focused."

The plugin approach ensures:
- Events are captured at the editor level
- No issues with focus state
- Consistent behavior across browsers
- Production-grade reliability

## Comparison with Previous Attempts

| Approach | Issue | Why Plugin Solves It |
|----------|-------|---------------------|
| Document listener | Events not reaching handler in edit mode | Plugin gets events directly from editor |
| Overlay z-index | Not a z-index issue | Plugin ensures events are processed |
| Focus state check | isEditing() logic was fine | Real issue was event handling |
| Capture phase | Still missed events | Plugin is inside the event flow |

## Testing Checklist

- [x] Hover shows icon in non-edit mode
- [x] Hover shows icon in edit mode (FIXED!)
- [x] 300ms delay prevents flicker
- [x] Icon clickable to open panel
- [x] Tooltip appears on icon hover
- [x] No interference with typing
- [x] Works in Safari, Chrome, Firefox

## Production Patterns Applied

1. **Notion Pattern**: Overlay controls outside text area
2. **TipTap BubbleMenu**: Debounced updates with Floating UI
3. **Medium Toolbar**: Floating element with selection rect
4. **Google Docs**: Separate layer for hover UI

## Files Changed

- Created: `components/canvas/annotation-hover-plugin.ts`
- Modified: `components/canvas/tiptap-editor-plain.tsx`
  - Removed: `attachHoverIcon()` approach
  - Added: `AnnotationHoverPlugin()` registration

## Next Steps

- [ ] Add Floating UI for advanced positioning (edge detection)
- [ ] Consider extracting to TipTap extension format
- [ ] Add keyboard navigation support
- [ ] Test on mobile/touch devices