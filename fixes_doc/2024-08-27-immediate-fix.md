# Immediate Fix for Empty Editor Issue
**Date**: 2024-08-27  
**Issue**: TipTap shows empty content when switching notes
**Author**: Claude

## Quick Fix Strategy
Instead of refactoring the entire loading mechanism, we'll add a simple trigger to force TipTap to re-sync when content loads.

## Implementation

### Step 1: Add Y.Doc Content Loaded Event
In `lib/yjs-provider.ts`, modify the `getEditorYDoc` function to emit an event when content loads:

```typescript
// After line 177 (Y.applyUpdate(subdoc, data, 'persistence'))
// Add:
// Emit event to notify that content has loaded
window.dispatchEvent(new CustomEvent('ydoc-content-loaded', { 
  detail: { panelId, noteId, docSize: data.length } 
}))
```

### Step 2: Listen for Content Load in canvas-panel.tsx
Add a useEffect to listen for the content loaded event and force a re-render:

```typescript
// Add after the ydoc creation (around line 50)
const [editorKey, setEditorKey] = useState(0)

useEffect(() => {
  const handleContentLoaded = (event: CustomEvent) => {
    if (event.detail.panelId === panelId && event.detail.noteId === currentNoteId) {
      // Force TipTap to re-mount with loaded content
      setEditorKey(prev => prev + 1)
    }
  }
  
  window.addEventListener('ydoc-content-loaded', handleContentLoaded)
  return () => window.removeEventListener('ydoc-content-loaded', handleContentLoaded)
}, [panelId, currentNoteId])

// Update TipTap render to include key:
<TiptapEditor
  key={editorKey}  // Forces re-mount when content loads
  ref={editorRef}
  // ... rest of props
/>
```

### Step 3: Alternative - Direct Y.Doc Transaction
If re-mounting is too disruptive, use a Y.Doc transaction to trigger Collaboration extension update:

```typescript
// In getEditorYDoc after Y.applyUpdate:
subdoc.transact(() => {
  // Trigger a benign change to force TipTap sync
  subdoc.getMap('_meta').set('lastLoaded', Date.now())
}, 'persistence-load-complete')
```

## Benefits
1. Minimal code changes
2. No architectural refactoring
3. Preserves existing caching logic
4. Quick to implement and test

## Testing
1. Add console.log in event handler to verify it fires
2. Check that editor shows content after event
3. Verify no duplicate content issues
4. Test rapid note switching