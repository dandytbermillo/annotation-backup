# Branch-First Precedence Strategy

## Overview
The tooltip system must show the actual content users typed in annotation panels, not the selected text or main editor content. This requires careful precedence ordering of data sources.

## The Precedence Chain

### Correct Order (Branch-First)
```typescript
const previewText = 
  (dsBranch?.content ? stripHtml(String(dsBranch.content)) : '')  // 1. Branch notes
  || (dsBranch?.originalText || '')                               // 2. Selected text
  || extractPreviewFromDoc(docContent)                            // 3. Provider doc
  || "No notes added yet"                                         // 4. Fallback
```

### Why This Order?

1. **Branch Content (Primary)**
   - What: Notes typed in the annotation panel
   - Why First: This is what users expect to see - their actual notes
   - Format: HTML or ProseMirror JSON string

2. **Original Text (Secondary)**
   - What: Text that was selected when creating annotation
   - Why Second: Provides context when no notes added yet
   - Format: Plain text

3. **Provider Document (Tertiary)**
   - What: Content from document storage
   - Why Third: Last resort, shouldn't normally be needed
   - Format: ProseMirror JSON

4. **Placeholder (Final)**
   - What: "No notes added yet"
   - Why: Clear indication that branch has no content

## Common Mistake: Provider-First

### Wrong Implementation
```typescript
// DON'T DO THIS
const previewText = extractPreviewFromDoc(docContent)  // Provider first (WRONG!)
  || (dsBranch?.content ? stripHtml(String(dsBranch.content)) : '')
  || (dsBranch?.originalText || '')
```

### Why It's Wrong
- Provider document returns **main editor content** where annotation was made
- This shows the document being annotated, not the annotation itself
- Results in confusing tooltips showing wrong context

## Data Source Details

### Canvas Data Store (Primary)
```typescript
const ds = (window as any).canvasDataStore
const dsBranch = ds?.get?.(uiId)
```
- Immediate availability (O(1) lookup)
- Contains latest branch state
- Updated when user types in annotation panel

### Plain Provider (Fallback)
```typescript
const plainProvider = getPlainProvider()
const docContent = plainProvider.getDocument(noteId, uiId)
```
- Only used when branch store is empty
- May return stale content
- Should rarely be needed

### API Fetch (Last Resort)
```typescript
fetch(`/api/postgres-offline/branches?noteId=${noteId}`)
```
- Only when no local data available
- Network latency involved
- Used for cold loads

## Content Processing

### HTML Content
```typescript
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}
```

### ProseMirror JSON
```typescript
function extractTextFromPMJSON(node: any): string {
  if (node.type === 'text' && node.text) return node.text
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromPMJSON).join(' ')
  }
  return ''
}
```

### Smart Detection
```typescript
if (contentStr.startsWith('{') || contentStr.startsWith('[')) {
  // It's JSON - parse and extract
  const parsed = JSON.parse(contentStr)
  contentStr = extractTextFromPMJSON(parsed)
} else {
  // It's HTML - strip tags
  contentStr = stripHtml(contentStr)
}
```

## Performance Considerations

1. **Cache-First**: Check local stores before network
2. **Immediate Display**: Show available content without loading states
3. **Async Fallback**: Only fetch if local data missing
4. **Guard Against Stale**: Validate async responses before applying

## Testing the Precedence

### Test Case 1: Branch with Notes
- Branch content: "This is my analysis"
- Original text: "selected text"
- Expected tooltip: "This is my analysis"

### Test Case 2: Empty Branch
- Branch content: null
- Original text: "selected text"
- Expected tooltip: "selected text"

### Test Case 3: New Branch
- Branch content: null
- Original text: null
- Expected tooltip: "No notes added yet"

## Conclusion
Branch-first precedence ensures tooltips show what users expect: their annotation notes, not the document being annotated. This simple principle prevents confusion and provides intuitive behavior.