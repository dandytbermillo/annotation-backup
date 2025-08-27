# Empty Editor Fix Implementation Guide
**Date**: 2024-08-27  
**Issue**: Fix TipTap showing empty content on note switch
**Author**: Claude

## Implementation Strategy
We'll implement Option 2 from the analysis: Add a loading state to ensure content is loaded before TipTap renders.

## Changes Required

### 1. Enhanced getEditorYDoc Function
Modify `lib/yjs-provider.ts` to return both the Y.Doc and a loading promise:

```typescript
export interface EditorDocResult {
  doc: Y.Doc
  loadingPromise: Promise<void>
}

export function getEditorYDoc(panelId: string, noteId?: string): EditorDocResult {
  // ... existing cache check code ...
  
  if (editorDocs.has(cacheKey)) {
    return {
      doc: editorDocs.get(cacheKey)!,
      loadingPromise: Promise.resolve() // Already loaded
    }
  }
  
  // ... create new doc ...
  
  // Create loading promise
  const loadingPromise = new Promise<void>((resolve, reject) => {
    if (enhancedProvider.persistence) {
      const docKey = `${noteId || 'default'}-panel-${panelId}`
      enhancedProvider.persistence.load(docKey).then((data) => {
        if (data && data.length > 0) {
          Y.applyUpdate(subdoc, data, 'persistence')
        }
        initialLoadComplete = true
        resolve()
      }).catch((error) => {
        console.error(`Failed to load panel ${panelId}:`, error)
        initialLoadComplete = true
        reject(error)
      })
    } else {
      resolve() // No persistence, resolve immediately
    }
  })
  
  return { doc: subdoc, loadingPromise }
}
```

### 2. Update canvas-panel.tsx
Add loading state and wait for content:

```typescript
const [isEditorLoading, setIsEditorLoading] = useState(true)
const [ydoc, setYdoc] = useState<Y.Doc | null>(null)

useEffect(() => {
  setIsEditorLoading(true)
  const result = getEditorYDoc(panelId, currentNoteId)
  
  // Set doc immediately for UI responsiveness
  setYdoc(result.doc)
  
  // Wait for content to load
  result.loadingPromise
    .then(() => {
      setIsEditorLoading(false)
    })
    .catch((error) => {
      console.error('Failed to load editor content:', error)
      setIsEditorLoading(false)
    })
}, [panelId, currentNoteId])

// In render:
{isEditorLoading ? (
  <div className="flex items-center justify-center h-64">
    <LoadingSpinner />
  </div>
) : (
  <TiptapEditor
    ref={editorRef}
    content={ydoc ? '' : currentBranch.content}
    isEditable={isEditing}
    panelId={panelId}
    onUpdate={handleUpdate}
    onSelectionChange={handleSelectionChange}
    placeholder={isEditing ? "Start typing..." : ""}
    ydoc={ydoc}
    provider={provider.getProvider()}
  />
)}
```

### 3. Alternative Quick Fix (Less Optimal)
If the above is too complex, we can force a re-render after load:

```typescript
// In getEditorYDoc, after Y.applyUpdate:
subdoc.transact(() => {
  // Force a transaction to trigger TipTap update
  subdoc.getMap('_trigger').set('loaded', Date.now())
})
```

## Testing Plan
1. Create multiple notes with different content
2. Switch rapidly between notes
3. Verify content loads correctly each time
4. Check that loading spinner appears briefly
5. Ensure no empty editor states

## Rollback Plan
If this fix causes issues:
1. Revert changes to getEditorYDoc
2. Remove loading state from canvas-panel
3. Return to previous synchronous approach

## Performance Considerations
- Loading spinner adds slight delay but improves perceived performance
- Content still loads asynchronously in background
- Cache still prevents redundant loads