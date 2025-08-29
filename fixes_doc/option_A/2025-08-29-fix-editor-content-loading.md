# Fix: Editor Content Loading in Plain Mode

## Summary
Fixed the issue where editor content was saved to PostgreSQL but not displayed when switching notes or reloading. The problem was due to improper timing between PlainOfflineProvider initialization and content loading in TiptapEditorPlain.

## Changes

### 1. Fixed Content Loading in TiptapEditorPlain (`components/canvas/tiptap-editor-plain.tsx`)
- Replaced the problematic `useMemo` approach with proper `useEffect` for async content loading
- Added `loadedContent` state to properly track when content is loaded from the provider
- Added separate `useEffect` to update editor content once both editor and content are ready
- Fixed timing issue where content was trying to be set before editor was initialized

### 2. Fixed Provider Initialization in CanvasPanel (`components/canvas/canvas-panel.tsx`)
- Added state management for plainProvider instead of relying on synchronous require
- Added polling mechanism to wait for PlainOfflineProvider initialization
- Added loading state to show "Initializing plain mode provider..." while waiting
- Only renders TiptapEditorPlain once the provider is available

## Key Issues Fixed

1. **Timing Issue**: The editor was trying to load content before the PlainOfflineProvider was initialized
2. **Async Loading**: Content loading was happening in `useMemo` which couldn't properly handle async operations
3. **Editor Updates**: Content wasn't being set in the editor after it was loaded asynchronously

## Testing

Created test script: `scripts/test-plain-mode-content-loading.sh` to verify:
- Content can be saved via API
- Content can be loaded via API
- Editor properly displays loaded content

## Commands

To test the fix:
```bash
# Set plain mode
export NEXT_PUBLIC_COLLAB_MODE=plain

# Run dev server
npm run dev

# Run test script
./scripts/test-plain-mode-content-loading.sh
```

## Verification Steps

1. Start the app in plain mode
2. Create a note and add some content
3. Save the content (it auto-saves)
4. Switch to another note or reload the page
5. Return to the original note
6. Content should be displayed properly

## Known Limitations

- TypeScript errors exist in other parts of the codebase but don't affect this fix
- The polling mechanism for provider initialization adds a slight delay on first load
- Content loading is still synchronous within the provider, which could be optimized

## Next Steps

1. Consider implementing a proper provider initialization event system
2. Add more comprehensive error handling for content loading failures
3. Optimize the provider initialization to avoid polling