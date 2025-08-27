# Y.js Content Duplication Fix Summary

## Problem
Content was duplicating in TipTap editor when reloading the app. For example, "sample text" would appear as:
```
sample text
sample text
```

## Root Causes
1. **TipTap was receiving content from two sources**: 
   - From the `content` prop (branch data)
   - From Y.js document persistence
   
2. **Content was being set even when using Y.js collaboration**:
   - A `useEffect` in TipTap was calling `setContent` on prop changes
   - This was adding content on top of Y.js loaded content

3. **Y.js updates were accumulating**:
   - Every edit creates a new update in PostgreSQL
   - On reload, ALL updates were being re-applied
   - No automatic compaction was happening

## Solutions Applied

### 1. Fixed TipTap Editor Component (`components/canvas/tiptap-editor.tsx`)

```typescript
// Before: Always updated content
useEffect(() => {
  if (editor && content !== editor.getHTML() && !editor.isFocused) {
    editor.commands.setContent(content)
  }
}, [editor, content])

// After: Only update when NOT using Y.js
useEffect(() => {
  if (editor && !ydoc && content !== editor.getHTML() && !editor.isFocused) {
    editor.commands.setContent(content)
  }
}, [editor, content, ydoc])
```

### 2. Fixed Canvas Panel Component (`components/canvas/canvas-panel.tsx`)

```typescript
// Before: Always passed branch content
<TiptapEditor
  content={currentBranch.content}
  ...
/>

// After: Empty content when using Y.js
<TiptapEditor
  content={ydoc ? '' : currentBranch.content}
  ...
/>
```

### 3. Enhanced Y.js Provider (`lib/yjs-provider.ts`)

- Added proper initial load handling with 'persistence' origin
- Implemented automatic compaction after 50 updates
- Fixed timing to ensure updates aren't persisted during initial load
- Added proper note ID namespacing for persistence keys

```typescript
// Persistence key now includes note ID
const docKey = `${noteId || 'default'}-panel-${panelId}`

// Auto-compaction to prevent update accumulation
if (updateCount > 50) {
  await enhancedProvider.persistence.compact(docKey)
  updateCount = 0
}
```

## Architecture (Per PRP Requirements)

Following the PostgreSQL persistence PRP:
- **Binary Storage**: Y.js updates stored as BYTEA in PostgreSQL
- **Persistence Flow**: 
  1. Initial load tries snapshot first, then merges updates
  2. New updates are persisted incrementally
  3. Automatic compaction prevents accumulation
  4. Each note+panel has isolated storage

## Testing

1. **Create a new note** - Should start empty
2. **Add content** - Should persist to PostgreSQL
3. **Reload the page** - Content should appear once (no duplication)
4. **Check database**:
   ```bash
   docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
   SELECT doc_name, COUNT(*) as updates 
   FROM yjs_updates 
   WHERE doc_name LIKE '%-panel-%' 
   GROUP BY doc_name;"
   ```

## Key Principles (from Y.js docs)

1. **Y.applyUpdate merges content** - It doesn't replace
2. **Use origin parameter** - Prevent persistence loops
3. **Compact regularly** - Prevent update accumulation
4. **Content source clarity** - Either from props OR from Y.Doc, never both

## Next Steps

1. Run `./cleanup-duplicates.sh` to clean old updates
2. Test with fresh browser session or incognito mode
3. Monitor auto-compaction logs in console
4. Consider implementing periodic snapshot creation for better performance