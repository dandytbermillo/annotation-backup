# UUID Validation Fix for Annotation Creation

## Summary
Fixed the "invalid input syntax for type uuid: 'main'" error that was preventing annotation creation. The issue was caused by a schema mismatch where the database expected UUID type for parent_id but the application uses text identifiers like "main" and "branch-xxx".

## Changes

### Migration Applied
- **Migration 007**: Changed `branches.parent_id` from UUID to TEXT type
  - File: `migrations/007_fix_branches_parent_id_type.up.sql`
  - Changes parent_id column to support all ID formats: "main", "branch-xxx", UUIDs
  - Removes foreign key constraint that was limiting to UUID references only
  - Updates index for performance

### API Route Updated
- **File**: `app/api/postgres-offline/branches/route.ts` (lines 22-29)
  - Removed UUID-only validation that was converting non-UUIDs to NULL
  - Now accepts all non-empty strings as valid parent IDs
  - Only converts empty strings to NULL
  - Preserves parent-child relationships for all panel types

## Commands
```bash
# Apply the migration
npm run db:migrate

# Verify migration status
npm run db:validate

# Test annotation creation
npm run dev
# Then create annotations from main panel and branch panels
```

## Tests
- Migration applied successfully: ✓
- API route updated: ✓ 
- Annotation creation should now work from:
  - Main panel (parent_id = "main")
  - Branch panels (parent_id = "branch-${uuid}")
  - Any other panel with UUID identifier

## Errors Encountered
**Error**: `invalid input syntax for type uuid: 'main'`
- **Root Cause**: Database schema expected UUID type for parent_id, but app uses text identifiers
- **Solution**: Changed column type from UUID to TEXT via migration 007
- **Validation**: Removed UUID-only validation in API route that was breaking non-UUID parent references

## Risks/Limitations
- Migration is backward compatible - existing UUID values work as TEXT
- Foreign key constraint removed - application must handle referential integrity
- Index recreated for TEXT type - performance should remain similar

## Next Steps
1. Test annotation creation from main panel
2. Test annotation creation from branch panels  
3. Verify panel hierarchy is preserved
4. Monitor for any performance impacts from TEXT vs UUID indexing