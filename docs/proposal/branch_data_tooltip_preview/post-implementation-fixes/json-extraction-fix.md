# JSON Extraction Fix

## Issue Description
**Date Identified**: 2025-09-08
**Date Fixed**: 2025-09-09
**Severity**: High (user-facing)

### Symptoms
- Tooltips displayed raw JSON: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"actual content"}]}]}`
- Expected: "actual content"
- Affected: All annotations with ProseMirror JSON content

## Root Cause Analysis

### The Problem
Branch content was stored as stringified ProseMirror JSON when saved from TipTap editors. The tooltip code was converting this to string without parsing, showing the raw JSON structure.

### Why It Happened
1. TipTap saves content as ProseMirror JSON
2. Branch store persists this as JSON string
3. Original code did `String(branch.content)` without parsing
4. Result: JSON string displayed verbatim

## The Fix

### Implementation
```typescript
// Before (WRONG)
const previewText = stripHtml(String(branch.content))

// After (CORRECT)
let contentStr = String(branch.content)
if (contentStr.startsWith('{') || contentStr.startsWith('[')) {
  try {
    const parsed = JSON.parse(contentStr)
    contentStr = extractTextFromPMJSON(parsed)
  } catch {
    contentStr = stripHtml(contentStr)
  }
} else {
  contentStr = stripHtml(contentStr)
}
```

### Text Extraction Function
```typescript
function extractTextFromPMJSON(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  
  // Handle text nodes
  if (node.type === 'text' && node.text) {
    return node.text
  }
  
  // Handle container nodes (doc, paragraph, etc.)
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromPMJSON).join(' ').trim()
  }
  
  return ''
}
```

## Validation

### Test Cases
1. **ProseMirror JSON String**
   - Input: `'{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'`
   - Output: `"Hello"`
   - ✅ Pass

2. **HTML String**
   - Input: `"<p>Hello <strong>World</strong></p>"`
   - Output: `"Hello World"`
   - ✅ Pass

3. **Plain Text**
   - Input: `"Hello World"`
   - Output: `"Hello World"`
   - ✅ Pass

4. **Invalid JSON**
   - Input: `"{broken json"`
   - Output: `"{broken json"` (falls back to HTML stripping)
   - ✅ Pass

## Files Modified
- `components/canvas/annotation-decorations-plain.ts`
- `components/canvas/annotation-decorations.ts`

## Lessons Learned

1. **Always consider content format**: Don't assume string content is plain text
2. **Parse before display**: Stored format may differ from display format
3. **Provide fallbacks**: If JSON parsing fails, try other interpretations
4. **Test with real data**: Synthetic tests might not catch format issues

## Prevention

To prevent similar issues:
1. Document content format in type definitions
2. Create content parsing utilities
3. Add format detection before processing
4. Include real content in test cases

## Monitoring

Watch for:
- Console errors about JSON parsing
- User reports of "weird text" in tooltips
- Content that looks like code/JSON

## Related Issues
- Initial tooltip implementation (showed Loading...)
- ID normalization (prevented content lookup)
- Branch-first precedence (showed wrong content)