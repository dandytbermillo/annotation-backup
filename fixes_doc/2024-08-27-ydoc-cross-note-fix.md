# Y.Doc Cross-Note Contamination Fix
**Date**: 2024-08-27  
**Issue**: Y.Doc content shared between different notes, causing content mixing  
**Author**: Claude

## Problem Description
When creating and switching between notes:
- Creating Note 2 would show Note 1's content initially
- Switching back to Note 1 would show Note 2's content
- After reload, both notes would show corrupted content (only first letter)
- Y.Docs were being shared across different notes with the same panel IDs

## Root Cause
In `getEditorYDoc()`, subdocs were stored in the enhanced provider using only `panelId` as the key:
```typescript
enhancedProvider.mainDoc.getMap('editors').set(panelId, subdoc)
```

This caused all notes with the same panel ID (e.g., "main") to share the same Y.Doc instance, leading to content contamination between notes.

## Solutions Applied

### 1. Fixed Y.Doc Storage to Use Composite Keys
**File**: `lib/yjs-provider.ts` (lines 127-147)

Changed from panelId-only storage to composite key storage:
```typescript
// Old (incorrect):
if (!editors.has(panelId)) {
  editors.set(panelId, subdoc)
}

// New (correct):
const cacheKey = noteId ? `${noteId}-${panelId}` : panelId
if (!editors.has(cacheKey)) {
  editors.set(cacheKey, subdoc)
}
```

### 2. Fixed Y.Doc Retrieval
**File**: `lib/yjs-provider.ts` (lines 209-212)

```typescript
// Check and retrieve using composite key
if (editors.has(cacheKey)) {
  const existingDoc = editors.get(cacheKey) as Y.Doc
  // ... cache and return
}
```

### 3. Fixed API Route Params Error
**File**: `app/api/persistence/load/[docName]/route.ts`

```typescript
// Old:
const docName = decodeURIComponent(params.docName)

// New (Next.js 15 format):
const { docName } = await params
const decodedDocName = decodeURIComponent(docName)
```

### 4. Fixed Awareness Import Errors
**Files**: 
- `lib/sync/hybrid-sync-manager.ts`
- `lib/enhanced-yjs-provider-patch.ts`

```typescript
// Old (incorrect):
import * as Y from 'yjs'
// Trying to use Y.Awareness

// New (correct):
import { Awareness } from 'y-protocols/awareness'
```

## How It Works Now
1. Each note-panel combination gets a unique Y.Doc instance
2. Composite keys like `note-123-panel-main` ensure isolation
3. No content sharing between different notes
4. Proper TypeScript types for Next.js 15 API routes
5. Correct imports for Y.js ecosystem modules

## Testing
1. Create Note 1 with content "Hello from Note 1"
2. Create Note 2 - should start empty, add "Hello from Note 2"
3. Switch back to Note 1 - should show "Hello from Note 1"
4. Switch to Note 2 - should show "Hello from Note 2"
5. Reload app - both notes retain their correct content

## Benefits
- Complete isolation between notes
- No content contamination
- Predictable behavior when switching notes
- Proper error handling in API routes
- No more import errors