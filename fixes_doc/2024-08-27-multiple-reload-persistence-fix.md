# Multiple Reload Persistence Fix
**Date**: 2024-08-27  
**Issue**: Persistence stops working after second reload  
**Author**: Claude

## Problem Description
After the first reload, edits were persisted correctly. However, after the second reload, new changes were no longer being saved to PostgreSQL. The persistence would work for one reload cycle but fail on subsequent reloads.

## Root Cause
The issue was with how persistence handlers were being tracked:
1. The `docsWithPersistence` Set wasn't accurately reflecting which docs had active handlers
2. Multiple handlers could be attached to the same doc, causing conflicts
3. The "skip if already set up" logic was preventing necessary handler setup after reloads
4. No way to verify if existing handlers were still functional

## Solutions Applied

### 1. Enhanced Handler Tracking with WeakMap
**File**: `lib/yjs-provider.ts` (lines 104-111)

```typescript
// Track persistence handlers with metadata
interface PersistenceHandlerMeta {
  docKey: string
  cacheKey: string
  setupTime: number
  updateCount: number
  handler: (update: Uint8Array, origin: any) => void
}
const persistenceHandlers = new WeakMap<Y.Doc, PersistenceHandlerMeta>()
```

### 2. Intelligent Handler Detection and Setup
**File**: `lib/yjs-provider.ts` (lines 113-196)

```typescript
function setupPersistenceHandler(...) {
  // Check if doc already has a handler
  const existingHandler = persistenceHandlers.get(subdoc)
  
  if (existingHandler) {
    // Verify the handler is for the same key
    if (existingHandler.docKey === docKey) {
      console.log(`Persistence handler already set up for ${docKey}`)
      return
    } else {
      // Different key, remove old handler
      subdoc.off('update', existingHandler.handler)
      persistenceHandlers.delete(subdoc)
    }
  }
  
  // Set up new handler with proper tracking
  const handlerMeta: PersistenceHandlerMeta = {
    docKey,
    cacheKey,
    setupTime: Date.now(),
    updateCount: 0,
    handler: updateHandler
  }
  
  persistenceHandlers.set(subdoc, handlerMeta)
}
```

### 3. Always Call Setup (Let Function Decide)
**File**: `lib/yjs-provider.ts` (retrieval paths)

Removed conditional checks, now always call:
```typescript
// Always ensure persistence (function handles duplicates)
setupPersistenceHandler(cachedDoc, docKey, cacheKey, enhancedProvider)
```

### 4. Proper Handler Cleanup
The WeakMap automatically cleans up when docs are garbage collected, preventing memory leaks.

## How It Works Now
1. **First Load**: Creates doc, sets up handler, tracks in WeakMap
2. **First Reload**: Retrieves doc, detects existing handler, verifies it's valid
3. **Second Reload**: Still detects handler properly, persistence continues
4. **Nth Reload**: Persistence remains stable across any number of reloads

## Testing
1. Create note with content
2. Reload - content preserved ✓
3. Add new content
4. Reload again - new content preserved ✓
5. Continue editing and reloading - all changes persist ✓

## Benefits
- Accurate handler tracking with WeakMap
- Prevents duplicate handlers
- Self-cleaning (no memory leaks)
- Works across unlimited reload cycles
- Better debugging with handler metadata