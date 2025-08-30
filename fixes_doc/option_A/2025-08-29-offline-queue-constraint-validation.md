# Validation Report: Offline Queue CHECK Constraint Issue
Date: 2025-08-29
Type: Validation Report

## Finding Status: ✅ **VALID AND CRITICAL**

## Executive Summary
The finding is **100% accurate**. There is a critical mismatch between the database schema and the application code that will cause runtime failures when attempting to save documents offline.

## Evidence Analysis

### 1. Current Database Schema (migration 004)
**File**: `migrations/004_offline_queue.up.sql` (line 7)
```sql
CREATE TABLE offline_queue (
  ...
  table_name VARCHAR(50) NOT NULL CHECK (table_name IN ('notes', 'branches', 'panels')),
  ...
)
```
**Constraint**: Only allows `'notes'`, `'branches'`, `'panels'` - does NOT include `'document_saves'`

### 2. Application Code Behavior
**File**: `lib/adapters/postgres-offline-adapter.ts` (lines 270-274)
```typescript
const tableNameMap: Record<string, string> = {
  note: 'notes',
  branch: 'branches',
  panel: 'panels',
  document: 'document_saves'  // <-- Attempts to use 'document_saves'
}
```

**Insert Attempt** (lines 279-284):
```typescript
await pool.query(
  `INSERT INTO offline_queue 
   (type, table_name, entity_id, data, status, created_at)
   VALUES ($1, $2, $3, $4::jsonb, 'pending', NOW())`,
  [op.operation, tableName, op.entityId, JSON.stringify(op.payload)]
)
```
When `op.entityType === 'document'`, this will try to insert `table_name = 'document_saves'`

### 3. Processing Logic Expects 'document_saves'
**File**: `lib/adapters/postgres-offline-adapter.ts` (line 388)
```typescript
if (table_name === 'document_saves') {
  // Process document saves
}
```
The adapter's flush logic already expects to handle `'document_saves'` operations.

## Impact Assessment

### Critical Issues
1. **Runtime Failures**: Any attempt to save a document while offline will fail with:
   ```
   ERROR: new row for relation "offline_queue" violates check constraint "offline_queue_check"
   DETAIL: Failing row contains (..., 'document_saves', ...)
   ```

2. **Data Loss Risk**: Document changes made while offline cannot be queued and will be lost

3. **User Experience**: The application will appear broken when offline, contradicting the offline-first architecture

### Affected Workflows
- Document editing while offline
- Auto-save functionality in disconnected state
- Background sync when returning online

## Proposed Migration Validation

The proposed migration is **CORRECT and NECESSARY**:

### Strengths of the Solution
1. **Minimal Change**: Only modifies the CHECK constraint, no structural changes
2. **Reversible**: Includes proper down migration
3. **Safe**: Uses dynamic constraint detection to handle existing constraints
4. **Aligned with Code**: Matches what the adapter already expects

### Migration Code Review
```sql
-- The approach to dynamically find and drop the constraint is correct
DO $$
DECLARE
  chk_name text;
BEGIN
  SELECT conname INTO chk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'offline_queue'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%table_name%'
    AND pg_get_constraintdef(c.oid) ILIKE '%IN (%';
  
  IF chk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE offline_queue DROP CONSTRAINT %I', chk_name);
  END IF;
END $$;

-- New constraint correctly includes 'document_saves'
ALTER TABLE offline_queue
  ADD CONSTRAINT offline_queue_table_name_check
  CHECK (table_name IN ('notes', 'branches', 'panels', 'document_saves'));
```

## Additional Recommendations

### 1. Immediate Action Required
This migration should be applied **immediately** as it's blocking critical functionality.

### 2. Testing Requirements
After applying the migration:
1. Test offline document save operations
2. Verify queue processing when returning online
3. Ensure no constraint violations occur

### 3. Optional Enhancements (Future)
The suggestion about adding a foreign key constraint is valid but not urgent:
```sql
ALTER TABLE document_saves
  ADD CONSTRAINT document_saves_panel_id_fkey
  FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE SET NULL;
```

## Compliance Check

### PRPs/postgres-persistence.md Alignment ✅
- Uses existing offline_queue table (no duplication)
- Reversible migration pattern
- Transaction-safe operations
- Maintains Option A (Yjs-free) requirements

### CLAUDE.md Compliance ✅
- Migration follows naming convention (009_*.sql)
- Includes both .up.sql and .down.sql
- Uses BEGIN/COMMIT for atomicity
- Includes descriptive comments

## Conclusion

**Finding**: VALID ✅
**Severity**: CRITICAL 🔴
**Action**: Apply migration 009 immediately

The CHECK constraint mismatch is a critical bug that will cause runtime failures. The proposed migration is the correct solution and should be applied as soon as possible to restore offline document persistence functionality.

## Commands to Apply Fix

```bash
# Apply the migration
psql -h localhost -U postgres -d annotation_dev -f migrations/009_allow_document_saves_in_offline_queue.up.sql

# Verify the constraint
psql -h localhost -U postgres -d annotation_dev -c "\d offline_queue"

# Test with a document save
curl -X POST http://localhost:3000/api/postgres-offline/documents \
  -H "Content-Type: application/json" \
  -d '{"noteId": "test-note", "panelId": "main", "content": {"test": "data"}}'
```