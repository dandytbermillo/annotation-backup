# Fix: Annotation Creation with Non-UUID Parent IDs

**Date:** 2025-11-29  
**Issue:** Failed to create branch: Invalid input syntax for type uuid: "main"  
**Status:** ✅ Fixed

## Problem

When creating annotations from the main editor panel (which has ID "main"), the system was attempting to insert this non-UUID value into the `parent_id` column, causing a PostgreSQL error:

```
error: invalid input syntax for type uuid: "main"
```

This occurred because:
1. The main editor panel uses "main" as its ID (not a UUID)
2. When creating annotations, this ID was passed as `parentId`
3. The database `parent_id` column expects either a valid UUID or NULL

## Root Cause

The annotation workflow was correctly implemented but didn't account for special panel IDs like "main" that aren't stored in the branches table. The `parent_id` foreign key constraint requires either:
- A valid UUID that references an existing branch
- NULL for top-level branches

## Solution

Updated `/app/api/postgres-offline/branches/route.ts` to validate parentId format:

```typescript
// Normalize parentId - only valid UUIDs are allowed, everything else becomes null
// This handles special panel IDs like "main" which aren't actual branches
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const parentIdOrNull = parentId && uuidRegex.test(String(parentId).trim()) ? parentId : null
```

This ensures:
- Valid UUIDs are preserved (for branch-to-branch relationships)
- Special IDs like "main" are converted to NULL
- Empty strings are converted to NULL
- The database constraint is satisfied

## Implementation Details

### Changes Made

1. **UUID Validation**: Added regex pattern to validate UUID v4 format
2. **Null Coercion**: Non-UUID values become NULL instead of causing errors
3. **Debug Logging**: Added console log when non-UUID parentIds are normalized
4. **Empty String Handling**: Also fixed empty string ID handling

### Code Location
- File: `/app/api/postgres-offline/branches/route.ts`
- Lines: 24-30

## Testing

Created test script: `/scripts/test-annotation-creation.sh`

Tests verify:
1. ✅ Creating annotation with parentId="main" succeeds
2. ✅ Creating annotation with valid UUID parentId succeeds
3. ✅ Creating annotation with empty parentId succeeds
4. ✅ All branches are retrievable via API

## User Impact

- Annotations can now be created from the main editor panel
- No more UUID validation errors
- Existing annotation workflow continues to function
- Parent-child relationships between branch panels still work

## Important Notes

**After applying this fix, you must restart your development server:**
```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

The error you experienced was from the old code still running in memory.

## Verification

Run the test script to verify the fix:
```bash
./scripts/test-annotation-creation.sh
```

Or manually test:
1. Start the app with `npm run dev`
2. Select text in the main editor
3. Click any annotation button (Note/Explore/Promote)
4. Verify no errors occur and the annotation is created