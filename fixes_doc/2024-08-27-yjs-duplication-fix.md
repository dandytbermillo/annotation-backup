# Y.js Content Duplication Fix
**Date**: 2024-08-27  
**Issue**: Content duplicating in TipTap editor on page reload  
**Author**: Claude

## Problem Description
When reloading the app, content in the TipTap editor would duplicate. For example, "sample text" would appear as:
```
sample text
sample text
```

## Root Causes
1. **Double content source**: TipTap was receiving content from both:
   - The `content` prop passed from branch data
   - Y.js document loaded from persistence

2. **useEffect content update**: A useEffect in tiptap-editor.tsx was calling `setContent` whenever the content prop changed, even when using Y.js collaboration

3. **Update accumulation**: Y.js updates were accumulating in PostgreSQL without compaction, causing all historical updates to be re-applied on reload

## Solutions Applied

### 1. Fixed TipTap Editor Component
**File**: `components/canvas/tiptap-editor.tsx`

```typescript
// Line 226 - Only update content when NOT using Y.js
useEffect(() => {
  if (editor && !ydoc && content !== editor.getHTML() && !editor.isFocused) {
    editor.commands.setContent(content)
  }
}, [editor, content, ydoc])
```

### 2. Fixed Canvas Panel Component  
**File**: `components/canvas/canvas-panel.tsx`

```typescript
// Line 571 - Pass empty content when using Y.js
<TiptapEditor
  content={ydoc ? '' : currentBranch.content}
  ...
/>
```

### 3. Enhanced Y.js Provider
**File**: `lib/yjs-provider.ts`

- Added proper persistence key namespacing: `${noteId}-panel-${panelId}`
- Implemented auto-compaction after 50 updates
- Fixed timing of initial load flag with 'persistence' origin
- Added delay to ensure Y.js processes updates before marking complete

## Testing
1. Create new note with content
2. Reload the page
3. Content should appear once without duplication
4. Check PostgreSQL for proper key format

## Related Files
- `/fix-yjs-persistence.ts` - Helper functions for Y.js persistence
- `/YJS_DUPLICATION_FIX.md` - Detailed documentation
- `/cleanup-duplicates.sh` - Database cleanup script