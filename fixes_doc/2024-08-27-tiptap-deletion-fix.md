# TipTap Content Deletion on Note Switch Fix
**Date**: 2024-08-27  
**Issue**: TipTap editor contents deleted when clicking on notes in sidebar  
**Author**: Claude

## Problem Description
When clicking on any note in the sidebar, the TipTap editor contents were being deleted. Data was correctly persisting to PostgreSQL, but switching between notes would cause the content to disappear.

## Root Cause
The issue was caused by aggressive cleanup in the `destroyNote` function and component lifecycle:

1. **Overly aggressive cleanup**: `destroyNote()` was destroying ALL editor Y.Docs for a note
2. **Component remounting**: Using `key={selectedNoteId}` caused full unmount/mount cycles
3. **Empty Y.Doc persistence**: New empty Y.Docs were being created and persisted, overwriting content

## Solutions Applied

### 1. Modified destroyNote to preserve editor docs
**File**: `lib/yjs-provider.ts` (lines 563-574)

Changed from:
```typescript
// Destroy all editor docs for this note
editorDocs.forEach((doc, key) => {
  if (key.startsWith(`${noteId}-`)) {
    doc.destroy()
    keysToDelete.push(key)
  }
})
```

To:
```typescript
// No longer destroy editor docs - they're managed by smart cache
// This preserves content when switching between notes
```

### 2. Added empty update protection
**File**: `lib/yjs-provider.ts` (lines 154-177)

Added check before persisting:
```typescript
// Filter out empty or tiny updates
if (update.length < 30) {
  const stateVector = Y.encodeStateVector(subdoc)
  if (stateVector.length < 10) {
    console.log(`Skipping empty update for ${docKey}`)
    return
  }
}

// Check if prosemirror doc is empty
const content = subdoc.getXmlFragment('prosemirror')
if (content && content.length === 0) {
  const jsonContent = subdoc.getText('content')
  if (!jsonContent || jsonContent.length === 0) {
    console.log(`Skipping empty prosemirror update for ${docKey}`)
    return
  }
}
```

### 3. Removed aggressive cleanup from component
**File**: `components/annotation-canvas-modern.tsx`

Removed the `destroyNote()` call from useEffect cleanup that was causing content loss.

## How It Works Now
1. When switching notes, editor Y.Docs remain in cache
2. Smart LRU cache management handles memory (max 50 docs, 5min TTL)
3. Empty updates are filtered out before persistence
4. Content loads instantly when returning to previously viewed notes

## Testing
1. Create a note with TipTap content
2. Switch to another note
3. Switch back to the first note
4. Content should be preserved
5. Check PostgreSQL - no empty updates should be persisted

## Benefits
- Content preserved when switching notes
- Faster note switching (cached content)
- No data loss
- Prevents empty content from overwriting real data