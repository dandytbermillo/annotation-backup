# Plain Mode Content Loading Fix

**Date:** 2025-08-29  
**Issue:** Content saved to database but shows empty when switching notes or reloading

## Summary
Fixed an issue where content was successfully saved to the PostgreSQL database but would appear empty when switching between notes or reloading the application in plain mode. The problem was caused by a race condition in the TipTap editor initialization and asynchronous content loading.

## Root Cause Analysis
1. When switching notes, the entire canvas component is recreated due to `key={selectedNoteId}` 
2. The TipTap editor was being initialized with potentially empty content before the async database load completed
3. Content updates after initialization were not properly applied to the editor

## Changes Made

### 1. TipTap Editor Plain Mode (`components/canvas/tiptap-editor-plain.tsx`)
- Modified initial content handling to prevent editor initialization with empty content when loading from provider
- Added proper timing and state checks for content updates
- Improved error handling to provide fallback empty document structure
- Added setTimeout wrapper to ensure editor is fully ready before content updates

### 2. Plain Offline Provider (`lib/providers/plain-offline-provider.ts`)
- Enhanced logging to include noteId, panelId, and cacheKey details
- Improved content validation and empty content handling
- Added better debug information for tracking document flow

### 3. API Routes (`app/api/postgres-offline/documents/`)
- Added comprehensive logging for save and load operations
- Enhanced response to include document ID after saves
- Improved error messages and debugging information

### 4. Test Page (`app/test-plain-mode/page.tsx`)
- Created a dedicated test page to verify plain mode document persistence
- Captures console logs for easy debugging
- Tests both save and load operations with fixed IDs

## Key Fixes Applied

1. **Conditional Initial Content**: Editor no longer initializes with empty content when loading from provider
2. **Async Content Updates**: Properly handle content updates after editor initialization
3. **Timing Issues**: Added proper delays and state checks to ensure editor is ready
4. **Empty Content Handling**: Consistent handling of empty documents with proper structure

## Testing Instructions

1. Start the development server: `npm run dev`
2. Navigate to `/test-plain-mode` to run the test
3. Click "Run Test" to verify save/load operations
4. Check console logs for detailed operation flow

To test in the main app:
1. Ensure `NEXT_PUBLIC_COLLAB_MODE=plain` or set via localStorage
2. Create or select a note
3. Type some content
4. Switch to another note
5. Switch back - content should be preserved

## Commands for Validation
```bash
# Run type checking
npm run type-check

# Run lint
npm run lint

# Start dev server
npm run dev

# Test in browser console
localStorage.setItem('collab-mode', 'plain')
# Navigate between notes and verify content persistence
```

## Known Limitations
- Panel IDs are normalized using UUID v5 for consistency
- Content is stored as JSONB in PostgreSQL
- Cache management limited to 50 documents with 5-minute TTL

## Next Steps
1. Consider implementing optimistic updates for better UX
2. Add retry logic for failed database operations
3. Implement better error recovery mechanisms
4. Add integration tests for note switching scenarios