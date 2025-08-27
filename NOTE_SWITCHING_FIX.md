# Note Switching Empty Editor Fix

## Problem
When switching between notes, the TipTap editor would show empty content even though the content was properly saved in PostgreSQL. The content would only appear after a page reload.

## Root Cause
The `clearEditorDocsForNote()` function was aggressively deleting ALL cached Y.Doc instances when switching notes. This caused:
1. The editor to show empty while waiting for PostgreSQL to load
2. Unnecessary database queries on every note switch
3. Poor user experience with empty editor flashes

## Solution Implemented

### 1. Smart Cache Management (`lib/yjs-provider.ts`)
Instead of clearing docs on note switch, implemented LRU (Least Recently Used) cache:

```typescript
// Cache limits
const MAX_EDITOR_DOCS = 50
const EDITOR_DOC_TTL = 5 * 60 * 1000  // 5 minutes

// Track access times
const editorDocsLastAccess = new Map<string, number>()

// Smart cleanup function
function cleanupEditorDocsCache(): void {
  // Only cleanup if exceeding limit
  // Remove oldest, unused docs
  // Keep recently accessed docs
}
```

### 2. Deprecated Aggressive Clearing
Changed `clearEditorDocsForNote()` to only "age" entries instead of deleting:

```typescript
export function clearEditorDocsForNote(noteId: string): void {
  // Just age entries by 1 minute for cleanup priority
  editorDocsLastAccess.forEach((lastAccess, key) => {
    if (key.startsWith(`${noteId}-`)) {
      editorDocsLastAccess.set(key, lastAccess - 60000)
    }
  })
}
```

### 3. Removed Clear Call on Note Switch
In `annotation-canvas-modern.tsx`, removed the aggressive clear:

```typescript
useEffect(() => {
  // Removed: clearEditorDocsForNote(noteId)
  // The composite key system already provides isolation
}, [noteId])
```

## Benefits
1. **Instant Content Display** - Cached docs show content immediately
2. **Better Performance** - Fewer database queries
3. **Smooth UX** - No empty editor flashes
4. **Memory Efficient** - Smart eviction keeps memory usage reasonable

## How It Works
1. Each editor Y.Doc is cached with key: `${noteId}-${panelId}`
2. When accessing a doc, its last access time is updated
3. When switching notes, docs remain cached
4. If cache exceeds 50 docs, oldest unused ones are removed
5. Docs not accessed for 5 minutes are eligible for removal

## Testing
1. Create multiple notes with different content
2. Switch rapidly between notes
3. Content should appear instantly without empty states
4. Check browser console for cache hits
5. Verify PostgreSQL still receives updates

## Architecture Compliance
This solution maintains compliance with the PRP:
- PostgreSQL remains the persistence layer
- Y.js handles real-time collaboration
- Binary data stored as BYTEA
- Each note+panel has isolated storage
- No IndexedDB usage