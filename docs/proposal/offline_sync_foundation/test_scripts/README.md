# Test Scripts for Offline Sync Foundation

This directory contains test scripts and validation queries for the offline sync foundation feature.

## Files

### Test Suites (Choose One)
- **comprehensive-feature-test-corrected.js** - 🟢 **RECOMMENDED** - Fully corrected test suite with all fixes
- **comprehensive-feature-test-fixed.js** - 🟡 Alternative test suite with most fixes applied
- **comprehensive-feature-test.js** - 🔴 Original suite (updated but use -corrected.js instead)

### Other Test Files
- **api-smoke-test.js** - Quick API endpoint validation tests
- **integration-helper.sh** - Database setup and seed data helper
- **sql-validation.sql** - SQL queries for database validation (fully updated)
- **test-queue-reliability.js** - Queue reliability and performance tests
- **validate-offline-sync.sh** - Shell script for full validation

## Important: Test Expectations

### Queue Status Flow
The offline queue uses the following status progression:
```
pending → processing → DELETE
```

**There is NO 'completed' status**. Successfully processed items are deleted from the queue, not marked as completed.

### Status Enum Values
The `offline_operation_status` enum contains only:
- `pending` - Operation waiting to be processed
- `processing` - Operation currently being processed
- `failed` - Operation failed after retries

### Dead-Letter Schema
The `offline_dead_letter` table uses these columns:
- `error_message` (NOT "reason")
- `last_error_at` (NOT "failed_at")
- `retry_count`
- `archived` (boolean)

### Idempotency
Duplicate detection is based on the `idempotency_key` column:
- Same key = duplicate (will be skipped)
- Different key = new operation (will be processed)

## Running Tests

### Prerequisites
```bash
# Start PostgreSQL
docker compose up -d postgres

# Apply migrations
./integration-helper.sh setup

# Start dev server
npm run dev
```

### Run Individual Tests
```bash
# API smoke tests
node api-smoke-test.js

# Comprehensive tests (USE THE CORRECTED VERSION!)
node comprehensive-feature-test-corrected.js  # ✅ RECOMMENDED

# Alternative test files (not recommended)
# node comprehensive-feature-test-fixed.js     # Has most fixes
# node comprehensive-feature-test.js           # Original (now updated)

# SQL validation
psql -d annotation_dev -f sql-validation.sql

# Full validation
./validate-offline-sync.sh
```

### Expected Results
- All tests should pass with the corrected expectations
- No references to 'completed' status
- Dead-letter operations use correct column names
- Foreign key constraints are properly seeded

## Common Issues

### "completed status not found"
This is expected. The queue doesn't have a 'completed' status. Processed items are deleted.

### "reason column doesn't exist"
The dead-letter table uses `error_message`, not "reason".

### Foreign Key Violations
Ensure you seed valid UUIDs for notes and panels before testing document_saves operations:
```javascript
// Create note first
await pool.query(
  `INSERT INTO notes (id, title, metadata, created_at, updated_at)
   VALUES ($1, 'Test Note', '{}'::jsonb, NOW(), NOW())`,
  [noteId]
);

// Then create panel
await pool.query(
  `INSERT INTO panels (id, note_id, position, dimensions, state, last_accessed)
   VALUES ($1, $2, '{"x": 0, "y": 0}'::jsonb, '{"width": 400, "height": 300}'::jsonb, 'active', NOW())`,
  [panelId, noteId]
);

// Now you can insert into document_saves
```

## Test Data Requirements

### Valid Table Names
The `offline_queue.table_name` column only accepts:
- `notes`
- `branches`
- `panels`
- `document_saves`

### UUID Format
All ID fields must be valid UUIDs. Don't use test strings like "test-123".
```javascript
// ✅ Correct
const id = crypto.randomUUID();

// ❌ Wrong
const id = "test-123";
```

## SQL Validation Queries

The `sql-validation.sql` file contains queries organized by category:

1. **Schema Validation** - Check columns, types, constraints
2. **Queue Status** - Monitor queue depth and processing
3. **Dead-Letter Analysis** - Review failed operations
4. **Search Validation** - Test FTS functionality
5. **Version History** - Check document versioning
6. **Performance Metrics** - Queue and search performance

### Key Metrics to Monitor
- Queue depth by status (pending, processing, failed)
- Dead-letter accumulation rate
- Average retry count before dead-letter
- Search response times
- Version count per document

## Updates Applied (2025-08-30)

Based on expert review, the following corrections were made:

### Initial Corrections
1. **Status Flow**: Changed all tests from `pending→processing→completed` to `pending→processing→DELETE`
2. **Dead-Letter Fields**: Updated to use `error_message` and `last_error_at` (not `reason`/`failed_at`)
3. **SQL Queries**: Removed all references to `status='completed'` and `processed_at`
4. **Test Data**: Added proper UUID seeding for foreign key constraints
5. **Duplicate Detection**: Fixed to use same `idempotency_key` for true duplicate testing

### Final Patches (2025-08-31)
6. **FK Seeding in Legacy Suite**: Added note seeding before `document_saves` inserts in `comprehensive-feature-test.js` to prevent foreign key violations
7. **Panel ID Column**: Added required `panel_id` column to all panel inserts in `comprehensive-feature-test-corrected.js` (TEXT NOT NULL per migration schema)

These changes ensure tests match the actual database schema and processing logic.