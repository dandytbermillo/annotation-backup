# Post-Implementation Fixes

This directory contains documentation of fixes applied after the initial implementation of the branch data tooltip preview feature.

## Fix History

### 1. [JSON Extraction Fix](./json-extraction-fix.md)
- **Date**: 2025-09-09
- **Issue**: Tooltips showing raw ProseMirror JSON
- **Solution**: Added proper JSON parsing and text extraction

## Common Issues and Solutions

### Tooltip Shows JSON
- Check if branch content is being parsed correctly
- Verify `extractTextFromPMJSON()` handles nested structure
- Ensure JSON detection checks for `{` or `[` at start

### Wrong Content Displayed
- Verify branch-first precedence is applied
- Check ID normalization (UI vs DB format)
- Ensure not fetching document content instead of branch content

### Race Conditions
- Check async guards are in place
- Verify `tooltipElement.dataset.branchId` validation
- Ensure stale responses are rejected

## Testing Fixes

After applying any fix:
1. Clear browser cache
2. Test with new and existing annotations
3. Verify both Yjs and Plain modes
4. Check console for errors
5. Test rapid hover between annotations

## Prevention Strategies

1. **Always parse content type**: Don't assume format
2. **Use branch-first precedence**: Branch → Original → Provider
3. **Normalize IDs early**: At entry points, not deep in code
4. **Guard async operations**: Prevent stale updates
5. **Test both modes**: Yjs and Plain can behave differently