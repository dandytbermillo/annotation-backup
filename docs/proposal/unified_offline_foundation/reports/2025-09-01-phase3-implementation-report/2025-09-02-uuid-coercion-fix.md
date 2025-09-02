# UUID Coercion Fix for Postgres-Offline Endpoints

**Date**: 2025-09-02  
**Status**: ✅ Resolved  
**Severity**: High  
**Affected Version**: Phase 3 Post-Implementation  

## Problem
Annotation persistence failed with repeated "invalid input syntax for type uuid" errors in branches/batch endpoint, causing infinite error loops during autosave.

### Detailed Symptoms
- Error: `invalid input syntax for type uuid: "note-1755925277292"` in branches/batch endpoint
- Error: `insert or update on table "document_saves" violates foreign key constraint "document_saves_note_id_fkey"`
- Detail: `Key (note_id)=(21745e66-9d67-50ee-b443-cffa38dab7e9) is not present in table "notes"`
- Autosave kept retrying with same non-existent note_id, causing infinite error loops
- Errors repeated continuously in terminal, making the application unusable

## Root Cause Analysis
1. **Missing UUID Coercion**: The `/api/postgres-offline/branches/batch` endpoint was trying to insert slug IDs directly into UUID columns
2. **Missing Auto-Create**: The `/api/postgres-offline/documents/batch` endpoint didn't auto-create missing notes, causing foreign key violations
3. **Slug Rejection**: The `/api/postgres-offline/documents/[noteId]/[panelId]` endpoint rejected slug IDs with 400 errors
4. **No Validation**: No conversion of slug IDs to UUIDs before database operations

## Solution Applied

### 1. Added UUID Coercion Function
```typescript
// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))
```

### 2. Implemented Auto-Create Pattern for Notes
```typescript
// Ensure the note exists (auto-create if missing)
await client.query(
  `INSERT INTO notes (id, title, metadata, created_at, updated_at)
   VALUES ($1::uuid, 'Untitled', '{}'::jsonb, NOW(), NOW())
   ON CONFLICT (id) DO NOTHING`,
  [noteKey]
)
```

### 3. Branch ID Validation
```typescript
// Validate branch ID - if not a valid UUID, generate a new one
const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const branchId = (id && uuidRegex.test(String(id).trim())) 
  ? String(id).trim() 
  : uuidv5(`branch:${id || Date.now()}`, ID_NAMESPACE)
```

## Files Modified
- `app/api/postgres-offline/branches/route.ts:10-11` - Added UUID coercion imports and function
- `app/api/postgres-offline/branches/batch/route.ts:11-12,66-79` - Added UUID coercion for both branch ID and noteId, plus auto-create
- `app/api/postgres-offline/documents/[noteId]/[panelId]/route.ts:11-12,36` - Added coerceEntityId for route params
- `app/api/postgres-offline/documents/batch/route.ts:11-12,93-103,234-244` - Added UUID coercion and auto-create for both POST and PUT methods

## Verification

### Test Commands
```bash
# Test branches with slug IDs
curl -X POST http://localhost:3001/api/postgres-offline/branches/batch \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [{
      "id": "branch-test-456",
      "noteId": "note-1755925277292",
      "parentId": "main",
      "type": "note",
      "originalText": "Test branch with slug IDs",
      "anchors": {"start": 0, "end": 10}
    }]
  }'
# Result: SUCCESS (HTTP 200)
# Response: {"success": true, "results": [{"success": true, "id": "7a09a725-3697-5db1-87dd-78a9516e2555"}]}

# Test documents with slug IDs  
curl -X PUT http://localhost:3001/api/postgres-offline/documents/batch \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [{
      "data": {
        "noteId": "note-1755925277292",
        "panelId": "branch-9a4b2235-cbc8-45f2-a507-031f00d5f1ad",
        "content": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Updated content"}]}]}
      }
    }]
  }'
# Result: SUCCESS (HTTP 200)
# Response: {"success": true, "processed": 1, "skipped": 0, "failed": 0}

# Test with problematic note ID that was causing errors
curl -X PUT http://localhost:3001/api/postgres-offline/documents/batch \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [{
      "data": {
        "noteId": "21745e66-9d67-50ee-b443-cffa38dab7e9",
        "panelId": "test-panel",
        "content": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Test"}]}]}
      }
    }]
  }'
# Result: SUCCESS (HTTP 200) - Note auto-created, document saved
```

### Test Results
- ✅ Branches endpoint accepts slug noteIds without UUID syntax errors
- ✅ Documents endpoint accepts slug IDs and auto-converts to UUIDs
- ✅ Auto-create prevents foreign key violations
- ✅ No more infinite error loops in terminal
- ✅ Both POST and PUT methods work correctly
- ✅ Idempotency maintained with ON CONFLICT handling

## Key Learnings
1. **Consistency is Critical**: All postgres-offline endpoints must handle both UUIDs and slug IDs uniformly
2. **Deterministic UUID Generation**: Use UUIDv5 for consistent slug→UUID mapping across services
3. **Defensive Programming**: Auto-create parent entities to prevent FK violations during autosave
4. **Namespace Stability**: The same namespace (`7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a`) must be used across all services
5. **Test Both Formats**: Always test with both UUID and slug formats to ensure compatibility
6. **Error Prevention**: Better to auto-create than to fail with FK violations during user edits

## Related
- Original implementation: [Phase 3 Implementation Report](../2025-09-01-phase3-implementation-report.md)
- Expert patches referenced: 0007-phase3-uuid-coercion-and-params-fix.patch (pattern only, not applied)
- Patch 0011b pattern: Notes endpoint explicit ID handling (reference for branch ID handling)
- Follow-up issues: None identified
- Testing performed: Live curl tests with both slug and UUID formats
- Artifacts: [→ ./2025-09-02-uuid-coercion-fix-artifacts/](./2025-09-02-uuid-coercion-fix-artifacts/INDEX.md)