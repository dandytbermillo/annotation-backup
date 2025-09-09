# Implementation Report — Branch Data Tooltip Preview

Date: 2025-09-09
Feature: `branch_data_tooltip_preview`
Status: Completed
Author: @dandytbermillo

## Summary
Successfully implemented tooltip system that displays branch annotation content when hovering over annotated text. The solution uses a magnifier icon (🔎) as an intermediate hover target and shows the actual notes users typed in annotation panels, not raw JSON or selected text.

## Changes Made

### New Files Created
1. **`components/canvas/annotation-decorations-plain.ts`**
   - Complete Yjs-free implementation for Option A
   - 283 lines implementing hover icon, tooltip display, and content extraction
   - Key functions: `normalizeIds()`, `showAnnotationTooltip()`, `extractTextFromPMJSON()`

### Files Modified
1. **`components/canvas/annotation-decorations.ts`**
   - Added branch-first content precedence
   - Added async guards with `tooltipElement.dataset.branchId`
   - Added `extractTextFromPM()` helper for JSON parsing
   - ~50 lines modified

2. **`components/canvas/tiptap-editor-plain.tsx`**
   - Changed import from `./annotation-decorations` to `./annotation-decorations-plain`
   - 1 line change

### Patches Applied
1. **`codex/proposal/tooltip-unified-branch-first.patch`**
   - Unified the tooltip behavior across both modes
   - Established branch-first precedence pattern

## Key Implementation Details

### Branch-First Precedence
```typescript
const previewText = (dsBranch?.content ? stripHtml(String(dsBranch.content)) : '')
  || (dsBranch?.originalText || '')
  || extractPreviewFromDoc(docContent)
```

### ID Normalization
```typescript
function normalizeIds(branchId: string) {
  if (!branchId) return { uiId: '', dbId: '' }
  if (branchId.startsWith('branch-')) return { uiId: branchId, dbId: branchId.slice(7) }
  if (UUID_RE.test(branchId)) return { uiId: `branch-${branchId}`, dbId: branchId }
  return { uiId: branchId, dbId: branchId }
}
```

### Async Guards
```typescript
tooltipElement.dataset.branchId = uiId
// Later in async callback:
if (tooltipElement.dataset.branchId !== currentKey) return
```

## Test Results

### Manual Testing
- ✅ Hover functionality works in both modes
- ✅ Tooltips show branch content, not JSON
- ✅ ID normalization handles all formats
- ✅ Race conditions prevented
- ✅ Fallback chain works correctly

### Test Scripts Created
- `test-tooltip-stability.js` - Comprehensive testing suite
- `debug-branch-content.js` - Debugging helper
- `test-branch-first-tooltip.js` - Precedence verification

## Errors Encountered and Fixes

### Issue 1: Raw JSON Display
**Problem**: Tooltips showed `{"type":"doc","content":[...]}`
**Root Cause**: ProseMirror JSON wasn't being parsed
**Solution**: Added JSON detection and `extractTextFromPMJSON()` function
**Validation**: Tooltips now show extracted text

### Issue 2: Wrong Content Source
**Problem**: Tooltips showed editor content instead of branch notes
**Root Cause**: Provider document prioritized over branch content
**Solution**: Implemented branch-first precedence
**Validation**: Correct content now displays

### Issue 3: ID Mismatches
**Problem**: Lookups failed due to format differences
**Root Cause**: UI uses `branch-<uuid>`, DB uses `<uuid>`
**Solution**: Created `normalizeIds()` function
**Validation**: All ID formats now work

## Performance Impact
- O(1) for cache hits (most common case)
- Network fetch only as last resort
- No performance regression observed

## Risks and Limitations
1. **Debounced saves**: 800ms delay means immediate hover might show stale content
2. **Memory**: Hover icon and tooltip persist in DOM
3. **Multi-panel**: Each panel maintains its own tooltip state

## Next Steps
1. Consider implementing runtime mode lock to prevent Yjs in plain mode
2. Add performance monitoring for tooltip display latency
3. Consider allowing tooltip content editing

## Deviations From Implementation Plan
- **No initial planning phase**: Implemented directly due to urgent user issue
- **Multiple patch iterations**: Solution evolved through debugging
- **Test scripts in root**: Should be under feature folder (now being moved)

## Validation Commands
```bash
# Type check
npm run type-check

# Test in development
npm run dev

# Manual test
# 1. Create annotation
# 2. Type content in branch panel
# 3. Hover annotated text → see icon
# 4. Hover icon → see branch content
```

## Rollback Instructions
If issues arise:
1. Revert changes to `annotation-decorations.ts`
2. Delete `annotation-decorations-plain.ts`
3. Revert import in `tiptap-editor-plain.tsx`
4. Remove test scripts

## Conclusion
The branch data tooltip preview feature is fully functional and addresses all identified issues. The solution is architecturally sound, performant, and maintainable. The branch-first approach with proper ID normalization provides a robust foundation for tooltip display.