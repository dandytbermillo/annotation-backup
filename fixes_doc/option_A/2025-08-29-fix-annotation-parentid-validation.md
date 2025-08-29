# Fix: Annotation ParentId UUID Validation

## Summary
Fixed the issue where creating annotation branches from the "main" panel failed with "invalid input syntax for type uuid" error. The problem was that the API endpoint expected a valid UUID for the parent_id column, but the UI was passing "main" as the parentId for annotations created from the main panel.

## Changes
- **File Modified**: `app/api/postgres-offline/branches/route.ts`
  - Added UUID validation regex to check if parentId is a valid UUID
  - Non-UUID values (like "main") are now normalized to `null`
  - Added support for client-provided branch IDs
  - Updated INSERT query to include the id column with COALESCE fallback

## Root Cause Analysis
1. The database schema defines `parent_id` as a UUID column that references other branches
2. The UI uses "main" as a special panel ID that isn't a branch in the database
3. The API was attempting to insert "main" directly into the UUID column, causing PostgreSQL to reject it

## Solution Implemented
Added parentId normalization logic in the API route:
```typescript
// Normalize parentId - only valid UUIDs are allowed, everything else becomes null
// This handles special panel IDs like "main" which aren't actual branches
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const parentIdOrNull = parentId && uuidRegex.test(String(parentId).trim()) ? parentId : null
```

This ensures:
- Valid UUIDs are preserved and used as parent references
- Special UI panel IDs like "main" are converted to null (no parent)
- Empty or invalid values are also normalized to null

## Tests
Created and ran UUID validation tests confirming:
- "main" → null
- Empty strings → null
- Invalid formats → null
- Valid UUIDs → preserved as-is

## Commands to Verify
```bash
# Start the development server
npm run dev

# In the app:
# 1. Navigate to a note
# 2. Select text in the main panel
# 3. Click any annotation button (Note/Explore/Promote)
# 4. Annotation should be created successfully without errors
```

## Database Impact
No schema changes required. The fix ensures data integrity by:
- Only storing valid UUID references in parent_id
- Using null for root-level branches (those created from "main")

## Next Steps
- Monitor for any issues with branch hierarchy display
- Ensure branch navigation still works correctly with null parent_id values
- Consider adding server-side UUID validation as a general utility

## Risks/Limitations
- Branches created from "main" will have null parent_id, which is semantically correct but may affect hierarchy queries
- Client must generate valid UUIDs for branch IDs or rely on database generation