# Offline Sync Foundation - Manual Test Page
## Test Date: 2025-08-30

### Prerequisites
- [ ] PostgreSQL running (docker compose up -d postgres)
- [ ] Development server running (npm run dev)
- [ ] Electron app built (npm run electron:dev)

### Test Scenarios

## 1. Queue Reliability Tests

### 1.1 Idempotency Test
**Purpose**: Verify duplicate operations are prevented

**Steps**:
1. Open developer console
2. Create a note with ID "test-idempotency-001"
3. Disconnect network (simulate offline)
4. Edit the note content 3 times with same change
5. Reconnect network
6. Check database: `SELECT COUNT(*) FROM offline_queue WHERE entity_id = 'test-idempotency-001';`

**Expected**: Only 1 operation in queue despite 3 attempts

### 1.2 Priority Queue Test
**Purpose**: Verify high-priority operations process first

**Steps**:
1. Create 3 notes while offline:
   - Note A: Normal save (priority 0)
   - Note B: Urgent save (priority 10)
   - Note C: Medium save (priority 5)
2. Reconnect network
3. Monitor sync order in sync-status-indicator

**Expected**: Processing order: B → C → A

### 1.3 TTL Expiration Test
**Purpose**: Verify expired operations are handled

**Steps**:
1. Create note "test-ttl-001" while offline
2. Wait 5 minutes (or manually update expires_at in DB)
3. Trigger sync
4. Check dead letter: `SELECT * FROM offline_dead_letter WHERE entity_id = 'test-ttl-001';`

**Expected**: Operation moved to dead letter with "Operation expired" message

## 2. Full-Text Search Tests

### 2.1 Basic Search
**Purpose**: Verify FTS works with ProseMirror content

**Steps**:
1. Create note with content: "The quick brown fox jumps over the lazy dog"
2. Search for "quick fox"
3. Search for "lazy cat" 
4. Search with fuzzy: "quik fox" (typo intentional)

**Expected**:
- "quick fox" returns the note
- "lazy cat" returns no results
- "quik fox" returns the note (fuzzy match)

### 2.2 Multi-Language Search
**Purpose**: Verify unaccent and special characters

**Steps**:
1. Create note: "café résumé naïve"
2. Search: "cafe resume naive"
3. Create note: "日本語 テスト"
4. Search: "テスト"

**Expected**: Both searches return appropriate notes

## 3. Conflict Detection Tests

### 3.1 Simple Conflict
**Purpose**: Verify basic conflict detection

**Steps**:
1. Open note in two browser tabs
2. Tab 1: Edit paragraph 1
3. Tab 2: Edit same paragraph differently
4. Save both within 5 seconds

**Expected**: Second save triggers conflict dialog

### 3.2 Version-Based Conflict
**Purpose**: Verify version tracking

**Steps**:
1. Create note, save (version 1)
2. Edit and save (version 2)
3. Use version history to revert to version 1
4. Make different edit
5. Save

**Expected**: Conflict detected, shows version 2 vs new edit

## 4. Platform-Specific Tests

### 4.1 Electron Offline Mode
**Purpose**: Verify Electron queue processing

**Steps**:
1. Launch Electron app
2. Create/edit notes while offline
3. Check sync status indicator shows "Offline"
4. Reconnect
5. Verify automatic sync

**Expected**: Queue processes automatically on reconnect

### 4.2 Web Export/Import
**Purpose**: Verify Web fallback works

**Steps**:
1. Open Web version
2. Create notes while "offline" (disconnect API)
3. Click Export Queue in sync status
4. Save JSON file
5. Reconnect and Import Queue

**Expected**: Operations successfully imported and processed

## 5. Version History Tests

### 5.1 Version List
**Purpose**: Verify version tracking

**Steps**:
1. Create note "version-test-001"
2. Make 5 edits with saves
3. Open version history panel
4. Check version list

**Expected**: 5 versions shown with timestamps

### 5.2 Version Compare
**Purpose**: Verify diff functionality

**Steps**:
1. Select version 2 and version 4
2. Click Compare
3. Review diff display

**Expected**: Clear visualization of changes between versions

### 5.3 Version Restore
**Purpose**: Verify rollback works

**Steps**:
1. Select version 3
2. Click Restore
3. Confirm in dialog
4. Check editor content

**Expected**: Content reverted to version 3, new version 6 created

## 6. Integration Tests

### 6.1 End-to-End Flow
**Purpose**: Full workflow validation

**Steps**:
1. Start fresh (clear DB)
2. Create note "e2e-test"
3. Add 3 annotations
4. Go offline
5. Edit all annotations
6. Add 2 more annotations
7. Delete 1 annotation
8. Go online
9. Verify sync
10. Search for annotations
11. Check version history

**Expected**: All operations sync correctly, search finds content, history shows all versions

## Test Results

| Test Case | Status | Notes |
|-----------|--------|-------|
| 1.1 Idempotency | ⬜ Pending | |
| 1.2 Priority Queue | ⬜ Pending | |
| 1.3 TTL Expiration | ⬜ Pending | |
| 2.1 Basic Search | ⬜ Pending | |
| 2.2 Multi-Language | ⬜ Pending | |
| 3.1 Simple Conflict | ⬜ Pending | |
| 3.2 Version Conflict | ⬜ Pending | |
| 4.1 Electron Offline | ⬜ Pending | |
| 4.2 Web Export/Import | ⬜ Pending | |
| 5.1 Version List | ⬜ Pending | |
| 5.2 Version Compare | ⬜ Pending | |
| 5.3 Version Restore | ⬜ Pending | |
| 6.1 End-to-End | ⬜ Pending | |

## Issues Found
<!-- Document any issues discovered during testing -->

## Performance Metrics
- Queue processing speed: ___ ops/second
- Search response time: ___ ms
- Conflict detection time: ___ ms
- Version history load: ___ ms

## Sign-off
- Tester: _______________
- Date: _______________
- Build Version: _______________