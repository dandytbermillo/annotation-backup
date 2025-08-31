# Test Failures Analysis and Fixes
*Date: 2025-08-31*

## Failed Tests Analysis

### 1. Queue Enqueue Test
**Issue**: Test is using `/offline-queue/import` endpoint which expects batch operations
**Current Code**: Sends operations wrapped in `{ version: 2, operations: [...] }`
**Fix**: Already correct format, but test checks wrong response field

### 2. Idempotency Check
**Issue**: Test expects duplicate to be prevented at API level
**Reality**: Database constraint prevents duplicates (returns error)
**Fix**: Test should expect error response for duplicate insertion

### 3. Import Duplicates
**Issue**: Test expects `data.skipped` but API returns `data.results.skipped`
**Current Response Structure**:
```json
{
  "success": true,
  "results": {
    "imported": 0,
    "skipped": 1,
    "failed": 0,
    "errors": []
  }
}
```
**Fix**: Update test to check `data.results.skipped`

### 4. Version Compare
**Issue**: Test needs at least 2 versions to compare
**Fix**: Test should first create 2 versions before attempting compare

### 5. Dead-letter Ops
**Issue**: Routes exist but test expects different response
**Routes Available**:
- `/api/offline-queue/dead-letter/requeue`
- `/api/offline-queue/dead-letter/discard`
**Fix**: Test should accept 401 (auth required) as valid response

## Fixes to Apply

### Fix 1: Update HTML Test Page

The test page needs these corrections:

1. **Import duplicates test** - Check `data.results.skipped` instead of `data.skipped`
2. **Idempotency test** - Expect error for duplicate (database constraint working)
3. **Version compare** - Create test data first
4. **Dead-letter test** - Already checks for 401, might be endpoint path issue
5. **Enqueue test** - Check `data.results.imported` instead of `data.imported`

### Fix 2: Alternative - Update API Response

Make the API response flatter by spreading results:
```typescript
return NextResponse.json({
  success: true,
  ...results,  // Spread imported, skipped, failed
  results,     // Keep nested for backwards compatibility
  metadata
})
```

This would make both `data.skipped` and `data.results.skipped` work.