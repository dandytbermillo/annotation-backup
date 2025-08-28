# Reload Content Fix - Fragment Field Mismatch
**Date**: 2024-08-27  
**Issue**: Both notes showing same content (last word of Note 1) after reload  
**Author**: Claude

## Problem Description
After creating multiple notes with different content and reloading the app, both notes would show the same content - specifically just the last word/character of Note 1. The notes worked correctly during the session but failed on reload.

## Root Causes

### 1. Fragment Field Mismatch
- TipTap was saving content to Y.js 'default' fragment
- Persistence code was checking 'prosemirror' fragment for content validation
- This caused valid updates to be skipped as "empty"

### 2. Small Update Filtering
```typescript
// This was discarding valid single-character updates
if (update.length < 30) {
  // Check prosemirror fragment (but content was in default!)
  const prosemirror = tempDoc.getXmlFragment('prosemirror')
  if (!hasContent) {
    return // Skip the update
  }
}
```

### 3. Last Character Syndrome
Only the final character persisted because:
- Multi-character updates (>30 bytes) were saved
- Single-character updates (<30 bytes) were filtered out
- Only the last multi-character update survived

## Solutions Applied

### 1. Removed Update Size Filtering
**File**: `lib/yjs-provider.ts` (lines 161-173)

Removed the entire block that was filtering small updates:
```typescript
// REMOVED: No longer filter by update size
// All Y.js updates are now persisted
```

### 2. Added Dynamic Fragment Detection
**File**: `lib/yjs-provider.ts` (lines 161-180)

```typescript
// Detect which fragment field contains content
const defaultFragment = subdoc.getXmlFragment('default')
const prosemirrorFragment = subdoc.getXmlFragment('prosemirror')

// Set metadata to indicate which field TipTap should use
if (defaultFragment && defaultFragment.length > 0) {
  subdoc.getMap('metadata').set('useDefaultField', true)
} else if (!prosemirrorFragment || prosemirrorFragment.length === 0) {
  // Initialize prosemirror fragment for new docs
  subdoc.getXmlFragment('prosemirror')
  subdoc.getMap('metadata').set('useDefaultField', false)
}
```

### 3. Updated TipTap to Use Correct Fragment
**File**: `components/canvas/tiptap-editor.tsx` (lines 55-58)

```typescript
// Dynamically select fragment field based on document metadata
const metadata = ydoc.getMap('metadata')
const useDefaultField = metadata.get('useDefaultField')
const field = useDefaultField ? 'default' : 'prosemirror'
```

## How It Works Now

1. **Existing Documents**: Continue using 'default' fragment (backward compatible)
2. **New Documents**: Use 'prosemirror' fragment (standard)
3. **All Updates Persist**: No size filtering means every keystroke is saved
4. **Dynamic Field Selection**: TipTap uses the correct fragment based on doc metadata

## Testing
1. Create Note 1 with "Hello World"
2. Create Note 2 with "Testing 123"
3. Make single-character edits to both
4. Reload the app
5. Both notes should show their complete, correct content

## Benefits
- Full content preservation on reload
- Backward compatible with existing data
- No data migration required
- All updates persist (no filtering)
- Proper note isolation maintained