# Debugging Notes - Cursor Disappearing Issue

**Date**: 2025-01-10
**Issue**: Cursor disappears when clicking at beginning of annotated text

## Current State

### Symptoms
1. Original issue: Characters detaching at annotation boundaries
2. New issue: Cursor disappearing when clicking at beginning of annotation
3. None of the attempted fixes have worked

### Testing Approach

Currently testing with:
1. All custom plugins DISABLED
2. Mark properties commented out (testing default behavior)
3. Only AnnotationDecorations and PerformanceMonitor active

## Hypothesis

The issue might be:
1. AnnotationDecorations plugin interfering with cursor placement
2. CSS styling hiding the cursor
3. Some interaction between the annotation mark and TipTap's cursor handling
4. The annotation mark implementation itself is flawed

## Test Plan

1. **Test vanilla behavior** - No custom plugins, default mark properties
2. **Add back one property at a time**:
   - First test with just `inclusive: false`
   - Then add `keepOnSplit: false`
   - Then add plugins one by one
3. **Check AnnotationDecorations plugin** - It might be causing the cursor issue

## Questions to Investigate

1. Does the cursor disappear without ANY plugins?
2. Does the cursor disappear with just the basic annotation mark?
3. Is the AnnotationDecorations plugin adding decorations that interfere?
4. Are there CSS styles hiding the cursor?

## Next Steps

User should test the current state (vanilla, no custom handling) and report:
- Does the cursor still disappear?
- Do characters still detach?
- What is the exact behavior now?