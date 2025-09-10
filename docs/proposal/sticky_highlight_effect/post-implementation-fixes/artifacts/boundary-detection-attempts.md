# Boundary Detection Code Evolution

This document shows the evolution of code attempts to fix the boundary detection issue.

## Attempt 1: Basic Clear Stored Marks (FAILED)

```typescript
// clear-stored-marks-plugin.ts - Version 1
export const ClearStoredMarksAtBoundary = () =>
  new Plugin({
    props: {
      handleTextInput(view) {
        const { state } = view
        const { empty, from } = state.selection
        if (!empty) return false
        
        const annotationMark = state.schema.marks.annotation
        if (!annotationMark) return false
        
        // This approach was too simplistic
        if (!state.doc.rangeHasMark(from, from, annotationMark)) {
          view.dispatch(state.tr.setStoredMarks(null))
        }
        
        return false
      },
    },
  })
```

**Issue**: `rangeHasMark(from, from)` is unreliable for zero-width selections.

## Attempt 2: Three-Check System (FAILED)

```typescript
// clear-stored-marks-plugin.ts - Version 2
const inStored = !!state.storedMarks?.some(m => m.type === annType)
const inHere = $from.marks().some(m => m.type === annType)
const beforeHas = !!$from.nodeBefore?.marks?.some(m => m.type === annType)

if (inStored || inHere || beforeHas) return false

view.dispatch(state.tr.setStoredMarks(null))
```

**Issue**: Still clearing marks when we should be applying them. Missing `afterHas` check.

## Attempt 3: DOM-Level Interception (FAILED)

```typescript
// annotation-strict-boundary.ts
handleDOMEvents: {
  beforeinput(view, event) {
    if (isAtEdge && data) {
      event.preventDefault()
      const tr = state.tr.insertText(data, pos)
      tr.setStoredMarks(null) // Still clearing!
      view.dispatch(tr)
      return true
    }
  }
}
```

**Issue**: Tried to prevent extension instead of allowing it. Wrong approach entirely.

## Attempt 4: Filter Transaction (FAILED)

```typescript
// annotation-exclusion-plugin.ts
filterTransaction(tr: Transaction, state) {
  // Complex logic to detect boundaries
  if (from === annotationStart || from === annotationEnd) {
    const storedMarks = tr.storedMarks || state.storedMarks || []
    const filteredMarks = storedMarks.filter(m => m.type !== annType)
    tr.setStoredMarks(filteredMarks.length > 0 ? filteredMarks : null)
  }
  return true
}
```

**Issue**: Transaction filtering happens too late in the pipeline.

## Final Solution: Apply Marks at Boundaries (SUCCESS)

```typescript
// annotation-start-boundary-fix.ts - Final version
export const AnnotationStartBoundaryFix = () =>
  new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const { state } = view
        const { $from } = state.selection
        const annType = state.schema.marks.annotation
        if (!annType) return false
        
        const nodeAfter = $from.nodeAfter
        const nodeBefore = $from.nodeBefore
        
        // START boundary - apply mark
        if (nodeAfter && nodeAfter.marks.some(m => m.type === annType)) {
          const annotationMark = nodeAfter.marks.find(m => m.type === annType)
          if (annotationMark) {
            const tr = state.tr.insertText(text, from, to)
            tr.addMark(from, from + text.length, annotationMark)
            view.dispatch(tr)
            return true
          }
        }
        
        // END boundary - apply mark
        if (nodeBefore && nodeBefore.marks.some(m => m.type === annType)) {
          const annotationMark = nodeBefore.marks.find(m => m.type === annType)
          if (annotationMark) {
            const tr = state.tr.insertText(text, from, to)
            tr.addMark(from, from + text.length, annotationMark)
            view.dispatch(tr)
            return true
          }
        }
        
        return false
      }
    }
  })
```

## Key Lessons

1. **Wrong Problem**: We were trying to PREVENT extension when we needed to ALLOW it
2. **Wrong Method**: Clearing marks vs. applying marks
3. **Timing Matters**: Need to intercept at the right point in the pipeline
4. **Check Both Sides**: Must check both `nodeBefore` AND `nodeAfter`
5. **Work With Defaults**: Sometimes the default behavior is correct (end boundary with inclusive: true)