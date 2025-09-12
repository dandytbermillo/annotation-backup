# Fix: Empty Folder Dropdown in Create Note Dialog

**Date**: 2025-09-12  
**Issue**: Folder dropdown was empty when creating notes  
**Status**: ✅ FIXED

## Problem

When clicking "Create New Note" and trying to select a folder, the dropdown was empty despite folders existing in the database.

## Root Cause

The `/api/items` endpoint didn't properly handle the `type=folder` query parameter when no search term was provided. The API logic only handled:
1. Search with optional type filter
2. Get by parentId
3. Get full tree

But NOT:
4. Filter by type only (which is what the dialog needed)

## Solution

Added a new condition in `/api/items/route.ts` to handle type-only filtering:

```typescript
} else if (type && !parentId) {
  // Filter by type only
  query = `
    SELECT * FROM items 
    WHERE deleted_at IS NULL
      AND type = $1
    ORDER BY path
    LIMIT $2
  `
  values = [type, limit]
}
```

## Verification

```bash
# Before fix
curl "http://localhost:3000/api/items?type=folder"
# Returns: {"items": []}

# After fix  
curl "http://localhost:3000/api/items?type=folder"
# Returns: {"items": [
#   {"name": "Knowledge Base", "path": "/knowledge-base"},
#   {"name": "Uncategorized", "path": "/knowledge-base/uncategorized"}
# ]}
```

## Impact

✅ Folder dropdown now shows available folders  
✅ Users can select where to save notes  
✅ Phase 2 folder selection feature fully functional

## Files Modified

- `app/api/items/route.ts` - Added type-only filter condition (lines 39-52)