# Test Pages

This folder contains manual test materials for the offline sync foundation feature.
Canonical path (per CLAUDE.md): this folder is the source of truth for manual test pages and runbooks.
If a sibling folder named test_page/ exists, treat it as a legacy mirror and prefer this folder for updates.
## Contents

- **offline-sync-smoke.md**: Manual smoke test page with scenarios and coverage checklist
- **offline-sync-test.html**: Interactive browser-based test suite with visual dashboard
- **README.md**: This file

## Quick Start (Recommended)

### 1) Start services
```bash
docker compose up -d postgres
npm run dev  # and npm run electron:dev for IPC/Electron tests
```

### 2) Apply migrations and seed
```bash
./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh setup
```

### 3) Set admin auth (if using protected endpoints)
```bash
export ADMIN_API_KEY=your-secure-admin-key
```

### 4) Health check
```bash
curl -s http://localhost:3000/api/health | jq -e '.ok == true'
```

### 5) Run API smoke tests (optional headless)
```bash
node docs/proposal/offline_sync_foundation/test_scripts/api-smoke-test.js
```

### 6) Follow offline-sync-smoke.md step-by-step and mark results

### 7) Or use the interactive HTML test page
```bash
# Open in browser (after npm run dev is running)
open http://localhost:3000/docs/proposal/offline_sync_foundation/test_pages/offline-sync-test.html
```

## Interactive HTML Test Page

The `offline-sync-test.html` provides a visual, browser-based test suite with:

### Features
- **Real-time Status Indicators** - Online/offline detection with visual badges
- **Test Progress Dashboard** - Live counters, progress bar, success rate
- **Interactive Test Runner** - Run individual tests or full suites
- **Detailed Logging** - Color-coded, timestamped test execution log
- **Response Time Monitoring** - Track API performance metrics

### How to Use
1. Open the HTML file in a browser (see command above)
2. Click **"Run All Tests"** to execute the complete test suite
3. Or run individual test groups:
   - Test Offline Queue
   - Test Search
   - Test Versions
4. View results in real-time with color-coded status indicators
5. Check the test log for detailed execution information

### Keyboard Shortcuts
- `Ctrl/Cmd + R` - Run all tests
- `Ctrl/Cmd + L` - Clear results
- `Ctrl/Cmd + E` - Open export/import modal

## Cleanup
```bash
./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh cleanup
```

## Test Coverage Areas

- **Offline Queue**: Idempotency, priority ordering, TTL expiry, dependency chains
- **Full-Text Search**: ProseMirror extraction, fuzzy matching, highlights
- **Version History**: Auto-increment, compare/diff, restore
- **Conflict Detection**: Version mismatch, resolution UI
- **Platform-Specific**: Electron offline mode, Web export/import
- **Dead-Letter**: Requeue/discard admin operations
- **Performance**: Response times, queue processing speed

## Key Commands Reference

### API Testing
```bash
# Set API base
export API=http://localhost:3000/api

# Health check
curl -s $API/health | jq

# Export queue (with auth)
curl -s -H "x-admin-key: $ADMIN_API_KEY" "$API/offline-queue/export?status=pending" | jq

# Import validation
curl -s -X POST -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  $API/offline-queue/import -d '{"version":2,"operations":[],"validate_only":true}' | jq
```

### Database Verification
```sql
-- Check extensions
SELECT extname FROM pg_extension WHERE extname IN ('unaccent','pg_trgm');

-- Verify document_saves schema
\d+ document_saves

-- Check indexes
SELECT indexname FROM pg_indexes WHERE tablename='document_saves';

-- Verify queue constraints
SELECT conname FROM pg_constraint WHERE conrelid='offline_queue'::regclass;

-- Check queue status enum (should be: pending, processing, failed)
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'offline_operation_status'::regtype;
```

### Performance Testing
```bash
# Search performance
time curl -s "$API/search?q=test&type=documents" > /dev/null

# Queue flush performance
time curl -s -X POST "$API/postgres-offline/queue/flush" \
  -H "Content-Type: application/json" -d '{"operations":[]}' > /dev/null
```

## Expected Test Results

### Queue Status Flow
- ✅ `pending` → `processing` → **DELETE** (not "completed")
- ❌ Failed operations → `failed` status → dead-letter after max retries

### Dead-Letter Schema
- ✅ Uses `error_message` column (not "reason")
- ✅ Has `retry_count` and `last_error_at`

### Duplicate Detection
- ✅ Based on `idempotency_key` uniqueness
- ✅ Same key = duplicate (skipped)
- ❌ Different key = new operation (processed)

## Troubleshooting

### Common Issues

1. **"completed" status error**
   - The queue only has: `pending`, `processing`, `failed`
   - Successful operations are DELETED, not marked "completed"

2. **"reason" column not found**
   - Dead-letter uses `error_message` column
   - Update tests to use correct column name

3. **Foreign key constraint errors**
   - Seed valid notes/panels before operations
   - Use real UUIDs, not test strings

4. **Duplicate not detected**
   - Must use SAME `idempotency_key`
   - Different keys = different operations

## Sign-off Checklist

Before marking test complete:
- [ ] All preflight checks passed
- [ ] Database migrations applied
- [ ] Extensions verified (unaccent, pg_trgm)
- [ ] API endpoints responding
- [ ] Queue operations tested
- [ ] Search functionality verified
- [ ] Version history working
- [ ] Performance metrics recorded

## Support

For issues or questions:
- Check `docs/proposal/offline_sync_foundation/fixing_doc/` for known fixes
- Review implementation plan in `IMPLEMENTATION_PLAN.md`
- Consult `CLAUDE.md` for project conventions