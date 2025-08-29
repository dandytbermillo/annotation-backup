# Deep Debug Annotation Creation Fix

## Summary
Fixed root causes of annotation creation failure and infinite loop:
1. **Parent ID Error**: Was setting `parentId` to `null` for main panel instead of `'main'`
2. **Infinite Loop Prevention**: Added tracking to prevent reloading branches for same note
3. **Better Error Logging**: Added detailed error information to server responses

## Changes

### 1. Fixed Parent ID Handling
**File**: `components/canvas/annotation-toolbar.tsx` (line 46)
- Fixed incorrect null assignment for main panel
- Now preserves parent ID as-is ('main', 'branch-xxx', or UUID)

```typescript
// Before: Breaking parent-child relationship
parentId: panel === 'main' ? null : panel.startsWith('branch-') ? panel.substring(7) : panel,

// After: Preserve all formats
parentId: panel,  // Keep as-is: 'main', 'branch-xxx', or UUID
```

### 2. Fixed Infinite Loop
**File**: `components/canvas/canvas-context.tsx` (lines 116, 123, 140-145)
- Added `loadedNotesRef` to track which notes have been loaded
- Prevents reloading branches when note hasn't changed
- Made dataStore globally accessible via window

```typescript
// Track loaded notes
const loadedNotesRef = useRef(new Set<string>())

// Only load if not already loaded
if (isPlainMode && noteId && !loadedNotesRef.current.has(noteId)) {
  // ... load branches ...
  loadedNotesRef.current.add(noteId)
}
```

### 3. Enhanced Error Logging
**File**: `app/api/postgres-offline/branches/route.ts` (lines 49-53)
- Added request body logging on errors
- Return detailed error messages for debugging

```typescript
console.error('Request body:', { id, noteId, parentId, type, originalText, anchors })
return NextResponse.json(
  { error: 'Failed to create branch', details: error instanceof Error ? error.message : 'Unknown error' },
  { status: 500 }
)
```

## Commands
```bash
# Restart development server
npm run dev

# Monitor server logs for detailed errors
# Look for "[POST /api/postgres-offline/branches] Error:" messages
```

## Root Cause Analysis

### Issue 1: 500 Error on Branch Creation
**Root Cause**: Setting `parentId` to `null` when panel was 'main' broke the parent-child relationship. The database expects 'main' as a valid parent ID after migration 007 changed the column to TEXT type.

### Issue 2: Infinite GET Requests
**Root Cause**: The useEffect in CanvasContext was running on every render because:
1. No guard to prevent reloading already loaded notes
2. DataStore updates might trigger re-renders

## Validation
1. Parent ID now correctly handles all formats:
   - 'main' → 'main' (not null)
   - 'branch-xxx' → 'branch-xxx' (not stripped)
   - UUID → UUID (as-is)

2. Branches only load once per note:
   - First load: Fetches from database
   - Subsequent renders: Skips loading

3. Better debugging:
   - Server logs show exact request payload
   - Client receives detailed error messages

## Additional Fix: Database Schema Mismatch

### Issue 3: Missing Required Columns
**Root Cause**: The branches table had NOT NULL constraints on Yjs-specific columns that plain mode doesn't use:
- branch_id, source_panel, target_panel (NOT NULL)
- anchor_start, anchor_end (NOT NULL BYTEA)
- "order" (NOT NULL)

**Solution**: Created migration 008 to make these columns nullable.

**Files Created**:
- `migrations/008_fix_branches_required_columns.up.sql`
- `migrations/008_fix_branches_required_columns.down.sql`

The migration changes:
```sql
ALTER TABLE branches
  ALTER COLUMN branch_id DROP NOT NULL,
  ALTER COLUMN source_panel DROP NOT NULL,
  ALTER COLUMN target_panel DROP NOT NULL,
  ALTER COLUMN anchor_start DROP NOT NULL,
  ALTER COLUMN anchor_end DROP NOT NULL,
  ALTER COLUMN "order" DROP NOT NULL;
```

## Complete Fix Summary
1. ✓ Fixed parentId handling (keeping 'main' instead of null)
2. ✓ Added guard to prevent infinite branch loading
3. ✓ Enhanced error logging for debugging
4. ✓ Fixed database schema constraints

## Next Steps
1. Test full annotation workflow:
   - Create annotation from main panel
   - Create annotation from branch panel
   - Verify parent-child relationships
2. Monitor for any remaining errors in server logs
3. Verify no more infinite loops when switching notes