# Persistence Reload Fix

## Problem Description
After the second reload, new edits were no longer being persisted. The first reload worked fine, but persistence stopped after the second reload.

## Root Cause
1. The `docsWithPersistence` Set was being used to track which docs had persistence handlers, but this Set is cleared from memory on page reload
2. When a Y.Doc was retrieved from cache after reload, the persistence check would see it wasn't in the Set and try to set up a new handler
3. However, the doc instance might already have update handlers attached from before the reload, leading to either duplicate handlers or inactive handlers
4. The `initialLoadComplete` flag in the closure would be reset with each new handler setup, potentially blocking persistence

## Solution Implemented

### 1. Added WeakMap for Doc Instance Tracking
```typescript
// WeakMap to track which Y.Doc instances have persistence handlers
// This stores the handler function so we can properly manage it
const docsWithPersistenceHandlers = new WeakMap<Y.Doc, any>()
```

### 2. Enhanced Handler Setup Logic
- Check if a doc instance already has handlers using the WeakMap
- If handlers exist, verify they are still active
- Remove inactive handlers before setting up new ones
- Store handler metadata including an `isActive` function to check handler state

### 3. Always Re-verify Persistence on Doc Retrieval
- Changed from conditional setup based on Set membership to always calling `setupPersistenceHandler`
- The function now intelligently checks if setup is needed rather than relying on potentially stale state

### 4. Improved Handler Management
```typescript
docsWithPersistenceHandlers.set(doc, {
  handler: updateHandler,
  isActive: () => initialLoadComplete,
  docKey,
  cacheKey
})
```

### 5. Added Debug Logging
- Log when setting up persistence with adapter type
- Log each persisted update with count
- Log when handlers are already set up or being replaced

## Files Modified
1. `/lib/yjs-provider.ts` - Main fixes for persistence handler management
2. `/lib/enhanced-yjs-provider.ts` - Added getter for persistence property to ensure consistency

## Testing Instructions
1. Start the development server: `npm run dev`
2. Open the application in a browser
3. Edit text in a panel
4. Reload the page (first reload) - edits should persist
5. Edit text again
6. Reload the page (second reload) - new edits should persist
7. Edit text again
8. Reload the page (third reload) - all edits should persist

## Console Output to Verify Fix
Look for these messages in the browser console:
- `Setting up persistence for [docKey] with adapter: WebPostgresAdapter`
- `Persisted update 1 for [docKey]`
- `Persistence handler already set up for doc instance: [docKey]` (on subsequent reloads)

## Key Improvements
1. **Robustness**: Handlers are properly managed across reloads
2. **No Duplicates**: WeakMap prevents duplicate handler registration
3. **Active State Checking**: Can detect and replace inactive handlers
4. **Better Debugging**: Clear console messages to track persistence state

## Future Considerations
1. Consider implementing a more sophisticated state management system for persistence
2. Add metrics to track persistence performance across reloads
3. Implement automatic recovery if persistence fails after multiple attempts