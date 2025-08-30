# Batch Implementation Test Resources

This directory contains all test pages and scripts used to verify the batch implementation is working correctly.

## Test Pages

### 1. test-batch-verification.tsx
**Location**: `test_pages/test-batch-verification.tsx`  
**Deploy to**: `app/test-batch-verification/page.tsx`  
**Access**: http://localhost:3000/test-batch-verification

**Features**:
- Real-time metrics dashboard showing operations, batches, DB rows, and write reduction %
- Visual debounce indicator (yellow = waiting, blue = saving, green = saved)
- Automated test suite with 3 tests:
  - Test 1: Rapid typing simulation
  - Test 2: Batch coalescing (5 ops → 1 row)
  - Test 3: Content deduplication
- Implementation status checklist

**Key Points**:
- Creates a real test note on mount
- Uses useRef for proper debounce timer management
- Shows write reduction percentage in real-time

### 2. test-plain-mode.tsx
**Location**: `test_pages/test-plain-mode.tsx`  
**Deploy to**: `app/test-plain-mode/page.tsx`  
**Access**: http://localhost:3000/test-plain-mode

**Features**:
- Creates a test note automatically
- Tests batch API save and document retrieval
- Shows console logs for debugging
- Displays note creation status

**Key Points**:
- Uses batch API endpoint for saves
- Waits for note creation before allowing tests
- Shows full API responses in console

## Test Scripts

### 1. verify-batch-implementation.sh
**Location**: `test_scripts/verify-batch-implementation.sh`  
**Deploy to**: `scripts/verify-batch-implementation.sh`

**Usage**:
```bash
chmod +x scripts/verify-batch-implementation.sh
./scripts/verify-batch-implementation.sh
```

**Tests**:
1. Server-side versioning & coalescing
2. Content-based deduplication
3. Version sequence integrity
4. Batch timing configuration
5. Concurrent writer handling
6. Editor debouncing check

**Output**: 
- Pass/fail for each test
- Performance metrics
- Write reduction percentage

### 2. monitor-batch-metrics.sql
**Location**: `test_scripts/monitor-batch-metrics.sql`  
**Deploy to**: `scripts/monitor-batch-metrics.sql`

**Usage**:
```bash
psql -U postgres -d annotation_dev < scripts/monitor-batch-metrics.sql
```

**Queries**:
1. Current session metrics (last 10 minutes)
2. Version explosion check (identifies problematic panels)
3. Write frequency analysis (per-minute bar chart)
4. Deduplication effectiveness
5. Batch coalescing verification (time gaps)
6. Performance score rating
7. Live tail of last 10 saves

### 3. test-batch-api.js
**Location**: `test_scripts/test-batch-api.js`  
**Deploy to**: Project root

**Usage**:
```bash
node test-batch-api.js
```

**Tests**:
1. Coalescing multiple ops for same panel
2. Duplicate content detection
3. Different panels (no coalescing)
4. Idempotency key handling

## How to Deploy All Test Resources

```bash
# 1. Copy test pages
cp docs/proposal/adding_batch_save/test_pages/test-batch-verification.tsx app/test-batch-verification/page.tsx
cp docs/proposal/adding_batch_save/test_pages/test-plain-mode.tsx app/test-plain-mode/page.tsx

# 2. Copy test scripts
cp docs/proposal/adding_batch_save/test_scripts/verify-batch-implementation.sh scripts/
cp docs/proposal/adding_batch_save/test_scripts/monitor-batch-metrics.sql scripts/
cp docs/proposal/adding_batch_save/test_scripts/test-batch-api.js ./

# 3. Make scripts executable
chmod +x scripts/verify-batch-implementation.sh
chmod +x test-batch-api.js

# 4. Start dev server
npm run dev

# 5. Access test pages
open http://localhost:3000/test-batch-verification
open http://localhost:3000/test-plain-mode
```

## Expected Results

### Successful Implementation Shows:
1. **Write Reduction**: 80-95% fewer database writes
2. **Coalescing**: Multiple operations → 1 database row
3. **Deduplication**: Identical content skipped
4. **Debouncing**: 800ms delay before saves
5. **Version Integrity**: Sequential versions without gaps

### Key Metrics:
- Before: 10-15 rows for typing "hello world"
- After: 1-2 rows for the same input
- Batch API response: `{"processed": 1, "skipped": 0}` for coalesced ops
- Duplicate saves: `{"processed": 0, "skipped": 1}` 

## Troubleshooting

### Test Page Shows 0% Write Reduction
- Refresh the page and try again
- Check if debounce timer is being properly cancelled
- Verify test note was created successfully

### Test 2 Shows "Expected 1 row, got 0"
- This means content already exists (deduplication working!)
- Clear database or use unique content for each test

### "Failed to save document" Error
- Ensure test note is created first (wait for green status)
- Check if database is running
- Verify foreign key constraints

### No Debouncing Visible
- Check browser console for errors
- Verify setTimeout is set to 800ms
- Ensure debounceTimerRef is properly managed