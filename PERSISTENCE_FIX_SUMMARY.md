# PostgreSQL Persistence Fix Summary

## Issue Identified
After reloading the app, both notes were showing the same content (only the last word of Note 1). The investigation revealed:

1. **Fragment Mismatch**: TipTap was using the 'default' fragment field while the persistence layer was expecting 'prosemirror'
2. **Update Filtering**: Small updates (< 30 bytes) were being incorrectly filtered out, losing single character insertions
3. **Migration Issue**: Existing data was stored in 'default' fragment but new code expected 'prosemirror'

## Root Causes

### 1. Fragment Field Mismatch
- TipTap Collaboration extension defaults to using 'default' as the fragment field name
- Our persistence checks were looking for content in 'prosemirror' fragment
- When loading, the system found empty 'prosemirror' fragments

### 2. Overly Aggressive Update Filtering
```typescript
// Previous code was skipping updates < 30 bytes
if (update.length < 30) {
  // Skip...
}
```
- Single character insertions in Y.js are typically 18 bytes
- These valid updates were being discarded

### 3. No Migration Path
- Existing documents had content in 'default' fragment
- New code expected 'prosemirror' fragment
- No migration logic to handle the transition

## Fixes Applied

### 1. Removed Update Size Filtering
**File**: `/lib/yjs-provider.ts`
- Removed the check that skipped updates < 30 bytes
- All Y.js updates are now persisted regardless of size
- Single character edits are no longer lost

### 2. Dynamic Fragment Field Selection
**File**: `/lib/yjs-provider.ts`
- Added detection logic to check which fragment contains content
- Sets a metadata flag indicating which field to use:
```typescript
if (defaultFragment.length > 0 && prosemirrorFragment.length === 0) {
  subdoc.getMap('_meta').set('fragmentField', 'default')
} else if (prosemirrorFragment.length > 0) {
  subdoc.getMap('_meta').set('fragmentField', 'prosemirror')
}
```

### 3. TipTap Configuration Update
**File**: `/components/canvas/tiptap-editor.tsx`
- TipTap now dynamically selects the fragment field based on the metadata flag
- Backward compatible with existing 'default' fragment data
- New documents will use 'prosemirror' fragment

### 4. Fragment Initialization
**File**: `/lib/yjs-provider.ts`
- Added `subdoc.getXmlFragment('prosemirror')` initialization for new documents
- Ensures the fragment exists before TipTap tries to use it

## Migration Strategy
The fix implements a backward-compatible migration strategy:
1. Existing documents continue using 'default' fragment
2. New documents use 'prosemirror' fragment
3. No data migration required - documents work with their original fragment
4. Fragment field is determined dynamically on load

## Testing Recommendations
1. Test with existing notes that have content
2. Create new notes and verify they persist correctly
3. Verify single character edits are saved
4. Check that reloading preserves all content
5. Test switching between multiple notes

## Database Cleanup
To remove test entries with empty content:
```sql
DELETE FROM yjs_updates WHERE doc_name LIKE 'note-175632%' AND doc_name LIKE '%-panel-%';
```

## Next Steps
1. Monitor for any edge cases with the migration
2. Consider adding a background job to compact old documents
3. Eventually migrate all documents to use 'prosemirror' fragment consistently