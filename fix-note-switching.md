# Fix for Empty Editor Content When Switching Notes

## Problem
When switching between notes, the TipTap editor shows empty content even though:
1. Content IS saved to PostgreSQL (appears on reload)
2. The Y.Doc persistence is working correctly
3. But content doesn't show when switching between notes

## Root Cause
1. `clearEditorDocsForNote()` is called when switching notes, which removes cached Y.Docs
2. When a new Y.Doc is created, persistence loading is async
3. The editor is initialized before content is loaded from persistence
4. There's a race condition between editor initialization and persistence loading

## Solution

### Option 1: Don't Clear Editor Docs on Note Switch (Recommended)
Remove the aggressive clearing of editor docs, and instead rely on the composite key system that already isolates docs by note ID.

### Option 2: Preload Content Before Editor Initialization
Make the persistence loading synchronous or wait for it to complete before rendering the editor.

### Option 3: Smart Cache Management
Instead of clearing all docs for a note, implement a smarter cache that:
- Keeps recently used docs in memory
- Only clears docs after a timeout or when memory pressure is high
- Pre-loads content when switching notes

## Implementation (Option 1)

```typescript
// In components/annotation-canvas-modern.tsx
// Remove or comment out line 45:
// clearEditorDocsForNote(noteId)

// In lib/yjs-provider.ts
// Modify clearEditorDocsForNote to be less aggressive:
export function clearEditorDocsForNote(noteId: string): void {
  // Instead of immediately clearing, mark for cleanup after a delay
  const keysToDelete: string[] = []
  editorDocs.forEach((doc, key) => {
    if (key.startsWith(`${noteId}-`)) {
      keysToDelete.push(key)
    }
  })
  
  // Delay cleanup to allow for quick note switches
  setTimeout(() => {
    keysToDelete.forEach(key => {
      // Only delete if not currently in use
      const doc = editorDocs.get(key)
      if (doc && !isDocInUse(doc)) {
        editorDocs.delete(key)
      }
    })
  }, 30000) // 30 second delay
}

// Helper function to check if doc is in use
function isDocInUse(doc: Y.Doc): boolean {
  // Check if doc has active observers/subscriptions
  return doc._observers && Object.keys(doc._observers).length > 0
}
```

## Implementation (Option 2)

```typescript
// In lib/yjs-provider.ts
// Make getEditorYDoc return a promise that resolves after content is loaded
export async function getEditorYDocAsync(panelId: string, noteId?: string): Promise<Y.Doc> {
  const cacheKey = noteId ? `${noteId}-${panelId}` : panelId
  
  // Check cache first
  if (editorDocs.has(cacheKey)) {
    return editorDocs.get(cacheKey)!
  }
  
  // Create new doc and wait for persistence to load
  const doc = await createAndLoadEditorDoc(panelId, noteId)
  editorDocs.set(cacheKey, doc)
  return doc
}

// In components/canvas/canvas-panel.tsx
// Use the async version and handle loading state
const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
const [isLoading, setIsLoading] = useState(true)

useEffect(() => {
  getEditorYDocAsync(panelId, currentNoteId).then(doc => {
    setYdoc(doc)
    setIsLoading(false)
  })
}, [panelId, currentNoteId])

// Show loading state while doc is being loaded
if (isLoading) {
  return <div>Loading...</div>
}
```

## Testing
1. Create a note with content
2. Switch to another note
3. Switch back to the first note
4. Content should appear immediately without needing to reload

## Verification Commands
```bash
# Check if content is persisted
docker exec -it annotation_postgres psql -U annotation_user -d annotation_db -c "SELECT doc_name, created_at FROM yjs_updates ORDER BY created_at DESC LIMIT 10;"

# Monitor editor doc cache
# Add this to the browser console:
console.log('Editor docs in cache:', editorDocs.size)
```