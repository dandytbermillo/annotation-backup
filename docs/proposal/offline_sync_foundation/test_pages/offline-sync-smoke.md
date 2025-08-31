# Offline Sync Foundation - Manual Test Page

## Test Date: 2025-08-30

## Preflight Setup
- [ ] PostgreSQL ≥ 12 is running (e.g., `docker compose up -d postgres`)
- [ ] Extensions installed: unaccent, pg_trgm
  - psql: `SELECT extname FROM pg_extension WHERE extname IN ('unaccent','pg_trgm');`
- [ ] Migrations applied: 010_document_saves_fts.up.sql, 011_offline_queue_reliability.up.sql
  - Recommended: `./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh setup`
- [ ] Admin key (if protecting admin endpoints)
  - Export: `export ADMIN_API_KEY=your-secure-admin-key`
- [ ] Development server is running: `npm run dev`
- [ ] Electron app is running for IPC tests: `npm run electron:dev`
- [ ] Health check returns 200:
  - `curl -s http://localhost:3000/api/health | jq -e '.ok == true'`

## Reusable Snippets
- Auth header (if ADMIN_API_KEY set): `-H "x-admin-key: $ADMIN_API_KEY"`
- API base: `API=http://localhost:3000/api`
- Seed data: `./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh setup`
- Cleanup data: `./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh cleanup`

## Database Verification (psql)
- document_saves columns present:
  - `\d+ document_saves` should show: note_id, panel_id, content (jsonb), version, created_at, document_text, search_vector
- Indexes present:
  - `SELECT indexname FROM pg_indexes WHERE tablename='document_saves' AND indexname IN ('idx_document_saves_search','idx_document_saves_trgm');`
- offline_queue constraints:
  - `SELECT conname FROM pg_constraint WHERE conrelid='offline_queue'::regclass AND conname='offline_queue_idempotency_key_uniq';`

### Prerequisites

- [ ] PostgreSQL running (`docker compose up -d postgres`)
- [ ] Development server running (`npm run dev`)
- [ ] Electron app built (`npm run electron:dev`)

## 1. Offline Queue Tests

### 1.1 Idempotency Enforcement

Purpose: Verify duplicate operations are prevented

Steps:
1. Open Electron app
2. Go offline (disable network)
3. Create a note with title "Test Note 1"
4. Edit the same note title to "Updated Note 1"
5. Edit again to "Updated Note 1 Again" 
6. Check queue depth in UI
7. Go online
8. Verify only unique operations are processed

Expected: Queue shows proper count, no duplicates processed

### 1.2 Priority Ordering

Purpose: Verify high-priority operations process first

Steps:
1. Clear queue (if any pending)
2. Go offline
3. Create regular note (priority 0)
4. Create important note with high priority flag
5. Create another regular note
6. Check queue order
7. Go online and watch processing order

Expected: High priority note syncs first

### 1.3 TTL Expiry

Purpose: Verify expired operations are not processed

Steps:
1. Insert test operation with past expiry:
```sql
INSERT INTO offline_queue 
(type, table_name, entity_id, data, idempotency_key, expires_at, status)
VALUES 
('update', 'notes', gen_random_uuid(), '{"test": true}'::jsonb, 
 gen_random_uuid()::text, NOW() - INTERVAL '1 hour', 'pending');
```
2. Process queue
3. Check dead letter table

Expected: Operation moved to dead letter with "Operation expired" message

### 1.4 Dependency Ordering (depends_on)
Purpose: Verify B waits for A

Steps (psql):
1. Insert A with a fixed UUID:
```
INSERT INTO offline_queue (id, type, table_name, entity_id, data, idempotency_key, status, created_at)
VALUES ('00000000-0000-0000-0000-0000000000aa', 'update', 'notes', gen_random_uuid(), '{}'::jsonb, gen_random_uuid()::text, 'pending', NOW());
```

2. Insert B depending on A:
```
INSERT INTO offline_queue (type, table_name, entity_id, data, idempotency_key, depends_on, status, created_at)
VALUES ('update', 'notes', gen_random_uuid(), '{}'::jsonb, gen_random_uuid()::text, ARRAY['00000000-0000-0000-0000-0000000000aa']::uuid[], 'pending', NOW());
```

3. Flush queue (Electron UI or admin flow if exposed).
4. Verify B remains pending until A is processed:
```
SELECT status FROM offline_queue WHERE depends_on @> ARRAY['00000000-0000-0000-0000-0000000000aa']::uuid[];
```

Expected: A processed first; B held until A no longer pending/failed

## 2. Full-Text Search Tests

### 2.1 Basic Search

Purpose: Verify FTS works with ProseMirror content

Steps:
1. Create note with content: "The quick brown fox jumps over the lazy dog"
2. Create another with: "PostgreSQL full-text search is powerful"
3. Search for "fox"
4. Search for "postgres"
5. Search for "powerful search"

Expected: Appropriate notes returned with highlights

### 2.2 Fuzzy Search

Purpose: Verify trigram similarity works

Steps:
1. Create note with "testing"
2. Search for "tetsing" (typo) with fuzzy enabled
3. Search for "testign" with fuzzy enabled

Expected: Both searches return appropriate notes

## 3. Conflict Detection Tests

### 3.1 Simple Conflict

Purpose: Verify version conflicts are detected

Steps:
1. Create note in Electron
2. Edit in browser (version 2)
3. Go offline in Electron
4. Edit same note (based on version 1)
5. Go online
6. Verify conflict dialog appears

Expected: Conflict detected, shows version 2 vs new edit

## 4. Platform-Specific Tests

### 4.1 Electron Offline Mode

Purpose: Verify Electron queue works

Steps:
1. Open Electron app
2. Create note while online (verify immediate sync)
3. Go offline (disable network)
4. Create 3 notes
5. Edit 2 notes
6. Delete 1 note
7. Check queue status indicator
8. Re-enable network

Expected: Queue processes automatically on reconnect

### 4.2 Web Export/Import

Purpose: Verify Web fallback works

Steps:
1. Open web version
2. Simulate offline (can't actually go offline)
3. Export queue as JSON
4. Save file
5. Open another browser/incognito
6. Import the JSON file
7. Process imported operations

Expected: Operations successfully imported and processed

### 4.3 Dead-Letter Triage (Admin)
Purpose: Verify requeue/discard endpoints

Steps (replace KEY):
1. Create a dead-letter row (simulate):
```
psql -c "INSERT INTO offline_dead_letter (idempotency_key, type, table_name, entity_id, data, error_message, retry_count) VALUES ('dead-test-1','update','notes',gen_random_uuid(),'{}','Max retries',5)"
```

2. Requeue:
```
curl -s -X POST $API/offline-queue/dead-letter/requeue \
  -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"ids":["<UUID-OF-DEAD-ROW>"]}' | jq
```

3. Discard (for another row):
```
curl -s -X POST $API/offline-queue/dead-letter/discard \
  -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"ids":["<UUID-OF-DEAD-ROW>"]}' | jq
```

Expected: Requeue inserts into offline_queue (pending) and archives dead-letter; discard archives only

## 5. Version History Tests

### 5.1 Version List

Purpose: Verify version tracking

Steps:
1. Create note
2. Edit 5 times with different content
3. Open version history panel
4. Verify all versions listed
5. Check timestamps are correct

Expected: 5 versions shown with timestamps

### 5.2 Version Compare

Purpose: Verify diff functionality

Steps:
1. Use note from 5.1
2. Compare version 2 and 4
3. View diff highlighting
4. Restore version 3
5. Verify new version 6 created

Expected: Content reverted to version 3, new version 6 created

## 6. Integration Tests

### 6.1 End-to-End Flow

Purpose: Verify complete workflow

Steps:
1. Start fresh (clear data)
2. Create note "Project Plan" (online)
3. Go offline
4. Add annotation "Important deadline"
5. Create branch "Alternative approach"
6. Edit main note
7. Go online
8. Verify all synced
9. Search for "deadline"
10. Check version history

Expected: All operations sync correctly, search finds content, history shows all versions

## 7. API & DB Quick Checks (copy-paste)

### 7.1 API Health & Auth
- Health:
  - `curl -s $API/health | jq`
- Export (auth):
  - `curl -s -H "x-admin-key: $ADMIN_API_KEY" "$API/offline-queue/export?status=pending" | jq '.checksum,.version'`
- Import validate_only:
  - `curl -s -X POST -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" $API/offline-queue/import -d '{"version":2,"operations":[{"type":"update","table_name":"notes","entity_id":"00000000-0000-0000-0000-000000000001","data":{"test":true},"idempotency_key":"dup-key-1"}],"validate_only":true}' | jq`
- Import duplicate skip:
  - Use same idempotency_key in two ops; confirm second is skipped when not validation-only.

### 7.2 FTS (psql)
- `SELECT pm_extract_text('{"type":"doc","content":[{"type":"text","text":"hello world"}]}'::jsonb);`
- `SELECT ts_headline('english','hello world',plainto_tsquery('english','world'),'StartSel=<mark>, StopSel=</mark>');`

## 8. Observability & Performance
- queueStatus:
  - Electron IPC: `window.electron.ipcRenderer.invoke('postgres-offline:queueStatus')`
  - Expect fields: byStatus, expired, deadLetter; UI badges present (pending/processing/failed/expired/dead)
- Performance sampling (dev box):
  - `time curl -s "$API/search?q=test&type=documents" > /dev/null`
  - `time curl -s -X POST "$API/postgres-offline/queue/flush" -H "Content-Type: application/json" -d '{"operations":[]}' > /dev/null`

## Coverage Checklist

- Offline Queue (Electron): Enqueue offline; flush (pending→processing→delete); ordering by priority DESC, created_at ASC; TTL expiry; depends_on honored; idempotency enforced; dead-letter after max retries.
- Web Offline UX: Offline banner when disconnected; fail-fast writes (no client persistence); export JSON with checksum; import validates and skips duplicates; validation-only mode.
- IPC/API Contracts: postgres-offline:enqueueOffline, queueStatus, flushQueue channels work; /api/search, /api/versions/*, /api/offline-queue/*, /api/health endpoints exist and return expected shapes.
- Full-Text Search: pm_extract_text extracts ProseMirror text; search_vector populated; unaccent handles diacritics; trigram fuzzy finds near-matches; ts_rank ordering and ts_headline excerpts work.
- Version History: List versions with size/timestamps; restore-as-new creates new version; base_version/base_hash guards produce 409 on mismatch; compare returns diff.
- Conflict Detection: Version mismatch detected; content drift identified; UI shows keep local/use server/auto-merge options; resolution applies correctly.
- Migrations/Schema: unaccent, pg_trgm extensions enabled; document_saves has all columns; GIN indexes on search_vector; trigram index on document_text; offline_queue has idempotency_key unique constraint.
- Performance & Stability (dev targets): Queue processing < 100ms/op; search < 200ms; version list/diff < 500ms; no regressions in notes/branches/panels flows.

## Test Results

| Test Case | Status | Notes |
|-----------|--------|-------|
| 1.1 Idempotency | ⬜ Pending | |
| 1.2 Priority | ⬜ Pending | |
| 1.3 TTL Expiry | ⬜ Pending | |
| 1.4 Dependency | ⬜ Pending | |
| 2.1 Basic Search | ⬜ Pending | |
| 2.2 Fuzzy Search | ⬜ Pending | |
| 3.1 Conflict | ⬜ Pending | |
| 4.1 Electron Offline | ⬜ Pending | |
| 4.2 Web Export | ⬜ Pending | |
| 4.3 Dead-Letter | ⬜ Pending | |
| 5.1 Version List | ⬜ Pending | |
| 5.2 Version Compare | ⬜ Pending | |
| 6.1 End-to-End | ⬜ Pending | |

## Issues Found

(Document any issues discovered during testing)

## Performance Metrics

- Queue processing speed: ___ ops/second
- Search response time: ___ ms
- Conflict detection time: ___ ms
- Version history load: ___ ms

## Sign-off

- Tester: _______________
- Date: _______________
- Build Version: _______________