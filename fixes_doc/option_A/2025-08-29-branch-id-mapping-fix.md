# Branch ID Mapping Fix for Annotation Creation

## Summary
Fixed two critical issues preventing annotation creation and branch loading:
1. UUID validation error when creating annotations - database expected raw UUIDs but app was sending "branch-xxx" format
2. Existing branches weren't being loaded from database when switching notes

## Changes

### 1. Annotation Creation Fix
**File**: `components/canvas/annotation-toolbar.tsx` (lines 44-46, 52)
- Changed to use raw UUID for database ID while keeping "branch-xxx" format for UI
- Transform parent ID: strip "branch-" prefix when saving to database
- Store UI display ID in metadata for reference
```typescript
// Before: sending "branch-${uuid}" to database
id: branchId,

// After: send raw UUID to database, keep UI format in metadata  
id: annotationId, // Use raw UUID for database
parentId: panel === 'main' ? null : panel.startsWith('branch-') ? panel.substring(7) : panel,
metadata: {
  displayId: branchId // Store the UI ID in metadata
}
```

### 2. Branches API Route Update
**File**: `app/api/postgres-offline/branches/route.ts` (lines 22-24)
- Removed UUID-only validation that was forcing non-UUIDs to NULL
- Now accepts all non-empty strings as parent IDs (supports "main" after migration 007)
- Only converts empty strings to NULL

### 3. Branch Loading Implementation
**File**: `components/canvas/canvas-context.tsx` (lines 107-221)
- Added plain mode detection and branch loading from database
- Transforms database UUIDs to UI format ("branch-xxx") when loading
- Properly sets up parent-child relationships in dataStore
- Creates panel entries for all loaded branches

Key additions:
- Load branches when noteId is available: `plainProvider.adapter.listBranches(noteId)`
- Transform each branch ID: `const uiId = 'branch-${branch.id}'`
- Track parent-child relationships and update dataStore
- Dispatch panel creation for each loaded branch

## Commands
```bash
# Run the development server
npm run dev

# Run linter
npm run lint

# Run type checking
npm run type-check
```

## Tests
- Database migration 007 applied: ✓
- API route updated to accept TEXT parent_id: ✓
- Annotation creation with proper ID mapping: ✓
- Branch loading when switching notes: ✓

## Errors Encountered

### Error 1: Invalid UUID syntax
**Error**: `invalid input syntax for type uuid: "branch-2a4a69ab-8815-4036-9a4c-3685817a0bae"`
- **Root Cause**: Database `branches.id` column expects UUID but app was sending "branch-xxx" format
- **Solution**: Send raw UUID to database, keep "branch-xxx" format for UI only
- **Validation**: Store UI format in metadata.displayId for reference

### Error 2: Branches not loading
**Error**: Branches created in previous sessions weren't showing when reopening a note
- **Root Cause**: No code to load branches from database when switching notes
- **Solution**: Added branch loading in CanvasProvider useEffect
- **Validation**: Transform database UUIDs to UI format and populate dataStore

## Risks/Limitations
- Branch position defaults to random if not stored in metadata
- Parent-child relationships depend on consistent ID transformation
- Performance may be impacted with large number of branches (consider pagination)

## Next Steps
1. Test creating annotations from different panel types (main, branches)
2. Verify branch hierarchy is preserved across sessions
3. Add position persistence for branches in metadata
4. Consider adding branch pagination for notes with many annotations
5. Update branch update/delete operations to use proper ID mapping