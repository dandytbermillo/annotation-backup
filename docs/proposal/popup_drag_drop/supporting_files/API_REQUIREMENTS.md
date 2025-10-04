# API Requirements for Popup Drag and Drop

**Feature:** popup_drag_drop

---

## Required API Endpoint

### POST /api/items/bulk-move

**Status:** ⚠️ EXISTS BUT NEEDS ENHANCEMENT (see safety issues below)

**Current Implementation:** `app/api/items/bulk-move/route.ts` (125 lines)

**Purpose:** Move multiple items to a target folder in a single transaction

**Endpoint:** `POST /api/items/bulk-move`

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "itemIds": ["uuid1", "uuid2", "uuid3"],
  "targetFolderId": "folder-uuid"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "movedCount": 3,
  "items": [
    { "id": "uuid1", "parentId": "folder-uuid", "updatedAt": "2025-10-03T..." },
    { "id": "uuid2", "parentId": "folder-uuid", "updatedAt": "2025-10-03T..." },
    { "id": "uuid3", "parentId": "folder-uuid", "updatedAt": "2025-10-03T..." }
  ]
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Invalid request",
  "message": "itemIds and targetFolderId are required"
}
```

**Error Response (404 Not Found):**
```json
{
  "error": "Target folder not found",
  "targetFolderId": "folder-uuid"
}
```

**Error Response (500 Internal Server Error):**
```json
{
  "error": "Failed to move items",
  "message": "Database error details..."
}
```

---

## Current Implementation Issues (MUST FIX)

### Issue 1: No Transaction Safety ❌ CRITICAL
**Current behavior:** Uses sequential `pool.query()` calls without transaction
**Location:** `app/api/items/bulk-move/route.ts:48-111`
**Risk:** Partial moves with no rollback capability

```typescript
// ❌ CURRENT: No transaction
for (const itemId of itemIds) {
  await pool.query('UPDATE items SET parent_id = ...')  // Could fail mid-loop
}
```

**Required fix:**
```typescript
// ✅ CORRECT: Wrap in transaction
const client = await pool.connect()
try {
  await client.query('BEGIN')
  // All updates...
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
}
```

### Issue 2: Wrong Pool Instance ❌ CRITICAL
**Current:** Uses local `new Pool()` instead of `serverPool` from `@/lib/db/pool`
**Location:** `app/api/items/bulk-move/route.ts:4-6`
**Risk:** Connection pool management issues, inconsistent with other endpoints

**Required fix:** Import and use `serverPool`:
```typescript
import { serverPool } from '@/lib/db/pool'
```

### Issue 3: No Workspace Validation ⚠️ HIGH
**Current:** No workspace check before moving items
**Risk:** Could move items across workspaces unintentionally
**All other endpoints** use: `WorkspaceStore.getDefaultWorkspaceId(serverPool)`

**Required fix:** Add workspace validation to ensure items belong to same workspace

### Issue 4: Partial Move Success Tracking ⚠️ MEDIUM
**Current:** Returns `{ success: true, movedItems, count }` but silently skips failed items
**Risk:** UI may not know which specific items failed vs succeeded

**Required fix:** Return detailed results:
```typescript
{
  success: true,
  movedCount: 3,
  skippedCount: 2,
  movedItems: [...],  // Items that actually moved
  skippedItems: [{ id, reason }]  // Items that failed with reasons
}
```

### Issue 5: Path Update Race Condition ⚠️ MEDIUM
**Current:** Updates item path, then separately updates children paths (lines 101-108)
**Risk:** If children path update fails, parent and children out of sync

**Required fix:** Include path updates in same transaction

---

## Implementation Requirements

### Database Operations

**Update parent_id for moved items:**
```sql
UPDATE items
SET parent_id = $1, updated_at = NOW()
WHERE id = ANY($2)
  AND deleted_at IS NULL
RETURNING id, parent_id, updated_at
```

**Parameters:**
- `$1` = targetFolderId
- `$2` = array of itemIds

### Validation

1. **Validate targetFolderId exists:**
   ```sql
   SELECT id FROM items
   WHERE id = $1 AND type = 'folder' AND deleted_at IS NULL
   ```

2. **Validate all itemIds exist:**
   ```sql
   SELECT id FROM items
   WHERE id = ANY($1) AND deleted_at IS NULL
   ```

3. **Prevent circular moves:**
   - Cannot move folder into itself
   - Cannot move folder into its own descendant
   ```sql
   -- Check if target is descendant of any moved folder
   WITH RECURSIVE descendants AS (
     SELECT id FROM items WHERE id = ANY($1)
     UNION
     SELECT i.id FROM items i
     INNER JOIN descendants d ON i.parent_id = d.id
   )
   SELECT id FROM descendants WHERE id = $2
   ```

### Transaction Safety

**Wrap in transaction:**
```typescript
const client = await pool.connect()
try {
  await client.query('BEGIN')

  // Validate target folder exists
  // Validate items exist
  // Check for circular moves
  // Update parent_id for all items
  // Update path for moved items (if path is used)

  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
}
```

---

## Alternative: Use Existing Single Move API

**If bulk-move is not implemented:**

Could fall back to calling existing single-item move API multiple times:

```typescript
// Less efficient but works
for (const itemId of itemIds) {
  await fetch(`/api/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ parentId: targetFolderId })
  })
}
```

**Issues with this approach:**
- ❌ Multiple network requests (slow)
- ❌ Not transactional (partial failures possible)
- ❌ No batch optimization

**Recommendation: Implement bulk-move endpoint**

---

## File Location

**Create new file:**
```
app/api/items/bulk-move/route.ts
```

**Reference existing patterns:**
- `app/api/items/route.ts` - GET/POST patterns
- `app/api/items/[id]/route.ts` - DELETE pattern

---

## Sample Implementation

```typescript
// app/api/items/bulk-move/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { itemIds, targetFolderId } = body

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'itemIds array is required' },
        { status: 400 }
      )
    }

    if (!targetFolderId) {
      return NextResponse.json(
        { error: 'targetFolderId is required' },
        { status: 400 }
      )
    }

    const client = await serverPool.connect()

    try {
      await client.query('BEGIN')

      // Validate target folder exists
      const folderCheck = await client.query(
        'SELECT id FROM items WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
        [targetFolderId, 'folder']
      )

      if (folderCheck.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json(
          { error: 'Target folder not found', targetFolderId },
          { status: 404 }
        )
      }

      // TODO: Add circular move validation

      // Move items
      const result = await client.query(
        `UPDATE items
         SET parent_id = $1, updated_at = NOW()
         WHERE id = ANY($2) AND deleted_at IS NULL
         RETURNING id, parent_id, updated_at`,
        [targetFolderId, itemIds]
      )

      await client.query('COMMIT')

      return NextResponse.json({
        success: true,
        movedCount: result.rows.length,
        items: result.rows
      })

    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

  } catch (error) {
    console.error('Error in bulk-move:', error)
    return NextResponse.json(
      { error: 'Failed to move items', message: String(error) },
      { status: 500 }
    )
  }
}
```

---

## Testing the API

### Test Case 1: Successful Move
```bash
curl -X POST http://localhost:3000/api/items/bulk-move \
  -H "Content-Type: application/json" \
  -d '{
    "itemIds": ["item1", "item2"],
    "targetFolderId": "folder1"
  }'
```

**Expected:** 200 OK with movedCount: 2

### Test Case 2: Invalid Target
```bash
curl -X POST http://localhost:3000/api/items/bulk-move \
  -H "Content-Type: application/json" \
  -d '{
    "itemIds": ["item1"],
    "targetFolderId": "nonexistent"
  }'
```

**Expected:** 404 Not Found

### Test Case 3: Missing Parameters
```bash
curl -X POST http://localhost:3000/api/items/bulk-move \
  -H "Content-Type: application/json" \
  -d '{
    "itemIds": []
  }'
```

**Expected:** 400 Bad Request

---

## Dependencies

- `@/lib/db/pool` - Database connection pool
- `next` - NextRequest, NextResponse types
- Existing items table schema

---

## Rollout Plan

1. **Phase 0:** Fix existing bulk-move API endpoint (CRITICAL - must do first)
   - Add transaction safety (BEGIN/COMMIT/ROLLBACK)
   - Switch to serverPool from @/lib/db/pool
   - Add workspace validation
   - Add detailed success/failure tracking
   - Test API thoroughly with curl/Postman

2. **Phase 1:** Implement drag-drop UI in popup overlay
   - Add drag state management
   - Add drag handlers
   - Wire to fixed API endpoint

3. **Phase 2:** Add safety patterns in UI
   - Track which items actually moved (like delete functionality)
   - Handle partial move failures gracefully
   - Clear selection after successful move

4. **Phase 3:** Integration testing
   - Test all drag scenarios manually
   - Test partial failure cases
   - Test cross-popup moves

5. **Phase 4:** Production deployment

---

## Notes

- ⚠️ **CRITICAL:** The bulk-move API EXISTS but has SAFETY ISSUES that MUST be fixed BEFORE implementing drag-drop UI
- **Transaction safety is non-negotiable** - all moves must be atomic (all succeed or all fail)
- **Success tracking is critical** - UI must know exactly which items moved vs failed (same pattern as delete functionality)
- **Workspace validation required** - prevent cross-workspace moves
- Consider adding rate limiting for bulk operations
- Log all bulk moves for audit trail
- Consider adding undo/redo support later
