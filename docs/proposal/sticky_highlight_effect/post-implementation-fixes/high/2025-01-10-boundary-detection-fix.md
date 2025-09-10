# Fix Report: Initial Boundary Detection Issues

**Date**: 2025-01-10  
**Severity**: High  
**Status**: ✅ Complete  
**Category**: Functional Bug

## Summary
Characters were detaching/separating when typing at annotation boundaries (both start and end). Multiple implementation attempts were made with increasing understanding of the root cause, ultimately discovering the issue was allowing continuation at boundaries, not preventing it.

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `components/canvas/clear-stored-marks-plugin.ts` | Multiple iterations of boundary detection logic | Initial attempts to clear stored marks at boundaries |
| `components/canvas/annotation-boundary-handler.ts` | Created then superseded | Attempted to intercept input before transaction |
| `components/canvas/annotation-strict-boundary.ts` | Created then superseded | Tried DOM-level interception |
| `components/canvas/annotation-start-boundary-fix.ts` | Final working solution | Explicitly applies annotation mark at boundaries |
| `components/canvas/tiptap-editor-plain.tsx` | Modified mark configuration and plugin registration | Testing different configurations |

## Root Cause and Fix

### Root Cause
1. **Misunderstood Requirements**: Initially thought we needed to PREVENT annotation extension at boundaries
2. **Incorrect Boundary Detection**: Used `rangeHasMark` which is unreliable for zero-width selections
3. **Wrong Approach**: Tried to clear marks instead of applying them

### The Fix
- Created `AnnotationStartBoundaryFix` plugin that explicitly APPLIES annotation marks when typing at boundaries
- Removed `inclusive: false` to allow natural end boundary extension
- Plugin handles start boundary, default behavior handles end

### Implementation Evolution

#### Attempt 1: ClearStoredMarksAtBoundary v1 (FAILED)
```typescript
// Only checked nodeBefore
if (!state.doc.rangeHasMark(from, from, annotationMark)) {
  view.dispatch(state.tr.setStoredMarks(null))
}
```
**Problem**: Zero-width range detection unreliable

#### Attempt 2: Improved Detection (FAILED)
```typescript
// Added three checks
const inStored = !!state.storedMarks?.some(m => m.type === annType)
const inHere = $from.marks().some(m => m.type === annType)
const beforeHas = !!$from.nodeBefore?.marks?.some(m => m.type === annType)
```
**Problem**: Still clearing marks when we should be applying them

#### Attempt 3: DOM Interception (FAILED)
```typescript
handleDOMEvents: {
  beforeinput(view, event) {
    // Tried to intercept at DOM level
  }
}
```
**Problem**: Fighting against natural behavior instead of working with it

#### Final Solution (SUCCESS)
```typescript
// Apply annotation mark at boundaries
if (nodeAfter && nodeAfter.marks.some(m => m.type === annType)) {
  const annotationMark = nodeAfter.marks.find(m => m.type === annType)
  const tr = state.tr.insertText(text, from, to)
  tr.addMark(from, from + text.length, annotationMark)
  view.dispatch(tr)
  return true
}
```

## Validation

### Test Steps
1. Create an annotation in the editor
2. Click at the START of the annotation
3. Type characters - should be highlighted ✅
4. Click at the END of the annotation  
5. Type characters - should be highlighted ✅
6. Press Enter at boundaries - new line should NOT be highlighted ✅

### Observations
- Typing at both boundaries now extends the annotation correctly
- No character "detachment" or separation
- Enter key properly controlled with `keepOnSplit: false`
- Cursor positioning works (minor visual edge issue remains)

## Deviations From Implementation Plan

The original implementation plan suggested using `inclusive: false` and boundary detection plugins. The final solution:
- Does NOT use `inclusive: false` (allows default end behavior)
- Uses a plugin only for START boundary (end works by default)
- Applies marks rather than clearing them (opposite of initial approach)

**Rationale**: The plan assumed we needed to prevent extension, but the actual requirement was to allow it while maintaining control.

## Follow-ups/TODOs

1. ✅ Test with all plugins enabled
2. ✅ Verify IME input methods work
3. ⏳ Fix minor cursor visual position issue (appears on edge of annotation rectangle)
4. ⏳ Apply same fix to collab editor if needed

## Artifacts

See [artifacts/boundary-detection-attempts.md](../artifacts/boundary-detection-attempts.md) for full code evolution.