# Post-Implementation Fix: Annotation Boundary Detachment

**Date**: 2025-01-10  
**Severity**: High  
**Status**: 🚧 IN PROGRESS (v2 patch applied, awaiting test results)  
**Issue**: Characters detaching at annotation boundaries (both start and end)

## Problem Description

Despite having `inclusive: false` and `keepOnSplit: false` set on the Annotation mark, characters typed at both the beginning and end of annotated text were "detaching" - appearing outside the highlight when they should either continue or not continue the annotation based on user intent.

## Root Cause Analysis

Multiple layers of issues discovered:

1. **TipTap/ProseMirror Mark Handling**: The `inclusive: false` property alone is insufficient because:
   - Stored marks can still carry over at boundaries
   - Transaction timing allows marks to be applied before boundary detection
   - The mark system doesn't distinguish between "at start" vs "at end" boundaries

2. **Plugin Execution Order**: Previous attempts failed because:
   - `handleTextInput` fires AFTER mark decisions are made
   - `appendTransaction` is too late to prevent initial mark application
   - Simple stored mark clearing doesn't prevent the core issue

3. **Input Method Complexity**: Different input methods bypass different hooks:
   - Regular typing uses one path
   - IME composition uses another
   - Paste operations use a third

## Solution Attempts

### Attempt 1: ClearStoredMarksAtBoundary (FAILED)
- Used `rangeHasMark` to detect boundaries
- Problem: Zero-width range detection unreliable

### Attempt 2: Improved Boundary Detection (FAILED)
- Added three-check system (inStored, inHere, beforeHas)
- Problem: Still executing too late in the pipeline

### Attempt 3: AnnotationBoundaryHandler (FAILED)
- Intercepted via `handleKeyDown`
- Problem: Still not preventing core mark application

### Attempt 4: AnnotationStrictBoundary (FAILED)
- Uses `beforeinput` DOM event for earliest interception
- Problem: Was trying to PREVENT extension instead of ALLOWING it

### Attempt 5: ClearStoredMarksAtBoundary v2 (CURRENT)
- Based on the v2 patch insight
- Key change: Checks BOTH `nodeBefore` AND `nodeAfter`
- Treats cursor as "inside" if at a boundary (allows continuation)
- Only clears marks when truly outside (all four checks fail)

**KEY INSIGHT**: The problem wasn't that we needed to prevent extension at boundaries - we needed to ALLOW it to continue when typing at start/end of annotations. The "detaching" happened because we were too aggressive in clearing marks.

## Implementation

### Files Modified (Current - v2 Patch)

1. **Updated**: `components/canvas/clear-stored-marks-plugin.ts`
   - Fixed to check BOTH `nodeBefore` AND `nodeAfter`
   - Treats boundary positions as "inside" to allow continuation
   - Only clears marks when truly outside annotation

2. **Updated**: `components/canvas/tiptap-editor-plain.tsx`
   - Using corrected ClearStoredMarksAtBoundary plugin
   - Maintains mark configuration (inclusive: false, keepOnSplit: false)

### Code Changes (v2 - Current)

The key fix was adding the `afterHas` check:

```typescript
// v1 (incorrect) - only checked nodeBefore
const beforeHas = !!$from.nodeBefore?.marks?.some(m => m.type === annType)
if (inStored || inHere || beforeHas) return false

// v2 (correct) - checks BOTH nodeBefore AND nodeAfter
const beforeHas = !!$from.nodeBefore?.marks?.some(m => m.type === annType)
const afterHas = !!$from.nodeAfter?.marks?.some(m => m.type === annType)
if (inStored || inHere || beforeHas || afterHas) return false
```

This ensures typing at START or END of annotation continues the highlight.

## Testing Matrix (Updated for v2)

| Scenario | Expected | Status |
|----------|----------|--------|
| Type at annotation START | Continues highlight (no detaching) | 🔄 Testing |
| Type at annotation END | Continues highlight (no detaching) | 🔄 Testing |
| Type INSIDE annotation | Continues highlight | 🔄 Testing |
| Type OUTSIDE annotation | Plain text (no highlight) | 🔄 Testing |
| Enter at boundaries | New line not highlighted (keepOnSplit: false) | 🔄 Testing |
| IME input at boundaries | Continues highlight | 🔄 Testing |

## Expected Behavior (v2)

With the corrected implementation:
- Typing at the START of an annotation continues the highlight
- Typing at the END of an annotation continues the highlight  
- Characters no longer "detach" at boundaries
- Typing outside annotations remains plain text
- Enter key at boundaries creates new line without highlight (keepOnSplit: false)

## Next Steps

1. User to test the strict boundary implementation
2. If still failing, need to investigate:
   - Whether plugins are actually executing
   - If TipTap is overriding our settings
   - Consider alternative mark implementation

## Lessons Learned

1. **Understanding the Real Problem**: The issue wasn't preventing extension - it was allowing proper continuation at boundaries
2. **Check Both Sides**: Must check BOTH `nodeBefore` AND `nodeAfter` for complete boundary detection
3. **Less is More**: Simple mark clearing logic is better than aggressive prevention
4. **Test the Actual Behavior**: What looks like "detaching" might be overly aggressive mark clearing
5. **Read Patches Carefully**: The v2 patch had the key insight - treating boundaries as "inside"

## Related Files

- Implementation Plan: [../../implementation.md](../../implementation.md)
- Main Report: [../../reports/2025-01-09-implementation-report.md](../../reports/2025-01-09-implementation-report.md)
- Plugin Source: [../../../../components/canvas/annotation-strict-boundary.ts](../../../../components/canvas/annotation-strict-boundary.ts)