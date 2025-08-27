# Async Y.Doc Loading Fix for Note Switching
**Date**: 2024-08-27  
**Issue**: Empty editor when switching notes due to async loading race condition  
**Author**: Claude

## Problem Description
When switching between notes, the TipTap editor would show empty content even though content was properly saved in PostgreSQL. This happened because Y.Doc content loads asynchronously but the editor renders immediately with an empty doc.

## Root Cause
In `getEditorYDoc()`, the function returns a Y.Doc immediately but loads content asynchronously:
```typescript
// Returns subdoc immediately
return subdoc

// But content loads later in the promise
enhancedProvider.persistence.load(docKey).then((data) => {
  Y.applyUpdate(subdoc, data, 'persistence')
})
```

This creates a race condition where TipTap renders before content is loaded.

## Solutions Applied

### 1. Created Y.js Utils for Loading State Tracking
**File**: `lib/yjs-utils.ts` (new file)

```typescript
// Track loading promises for Y.Docs
export const docLoadingStates = new Map<string, Promise<void>>()

// Helper to wait for doc load
export async function waitForDocLoad(docKey: string): Promise<void> {
  const loadingPromise = docLoadingStates.get(docKey)
  if (loadingPromise) {
    await loadingPromise
  }
}
```

### 2. Updated getEditorYDoc to Track Loading State
**File**: `lib/yjs-provider.ts` (lines 172-193)

```typescript
// Store the loading promise
const loadPromise = enhancedProvider.persistence.load(docKey).then((data) => {
  if (data) {
    Y.applyUpdate(subdoc, data, 'persistence')
  }
  // Clear loading state when done
  docLoadingStates.delete(cacheKey)
})

// Track it for external components
docLoadingStates.set(cacheKey, loadPromise)
```

### 3. Added Loading State to Canvas Panel
**File**: `components/canvas/canvas-panel.tsx`

Added loading state:
```typescript
const [isContentLoading, setIsContentLoading] = useState(true)
```

Added effect to wait for loading:
```typescript
useEffect(() => {
  setIsContentLoading(true)
  
  const checkDocLoading = async () => {
    const { docLoadingStates } = await import('@/lib/yjs-utils')
    const cacheKey = currentNoteId ? `${currentNoteId}-${panelId}` : panelId
    
    const loadingPromise = docLoadingStates.get(cacheKey)
    if (loadingPromise) {
      await loadingPromise
    }
    
    setIsContentLoading(false)
  }
  
  checkDocLoading()
}, [currentNoteId, panelId])
```

### 4. Show Loading State Instead of Empty Editor
**File**: `components/canvas/canvas-panel.tsx` (lines 590-611)

```typescript
{isContentLoading ? (
  <div style={{ padding: '40px', textAlign: 'center' }}>
    Loading content...
  </div>
) : (
  <TiptapEditor ... />
)}
```

## How It Works
1. When switching notes, `getEditorYDoc` is called
2. It starts loading content from PostgreSQL and tracks the promise
3. Canvas panel checks if content is loading
4. Shows "Loading content..." while waiting
5. Once loaded, renders TipTap with the loaded content
6. No more empty editor flashes

## Testing
1. Create multiple notes with different content
2. Switch between notes
3. See "Loading content..." briefly
4. Content appears correctly
5. No empty editor state

## Benefits
- Eliminates empty editor on note switch
- Provides visual feedback during load
- Prevents user confusion
- Maintains all existing functionality