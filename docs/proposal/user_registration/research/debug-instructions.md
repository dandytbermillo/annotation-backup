# Debugging Workspace Divergence - Instructions

## Current Status
- ✅ Offline queues have been TRUNCATED (completely empty)
- ✅ Only one workspace exists: `13716608-6f27-4e54-b246-5e9ca7b61064`
- ✅ Debug script created at `scripts/debug-workspace-divergence.sh`

## Steps to Capture Evidence

### 1. Reproduce the Issue with Fresh Data
1. Restart your application to ensure clean state:
   ```bash
   # Stop current server (Ctrl+C)
   npm run dev
   ```

2. Open Browser A and Browser B
3. Create or open the same file (e.g., "first1.md") in both browsers
4. Make an edit in Browser A
5. Switch to Browser B - does it see the change?
6. Make a different edit in Browser B
7. Switch back to Browser A - does it revert Browser B's change?

### 2. Capture Debug Information Immediately
As soon as you see the content revert/diverge, run:

```bash
# Get the note_id and panel_id from the browser console or network tab
# Then run:
./scripts/debug-workspace-divergence.sh <note_id> <panel_id>

# Example:
./scripts/debug-workspace-divergence.sh 123e4567-e89b-12d3-a456-426614174000 main
```

The script will capture:
- Workspace configuration
- All versions of the document
- Content hashes to identify which content is being replayed
- Offline queue entries
- API debug endpoint output
- Duplicate version detection

### 3. Key Things to Look For

1. **Multiple Workspaces**: Check if `workspace_id` differs between rows
2. **Version Gaps**: Look for non-sequential versions or duplicates
3. **Content Hash Patterns**: Same hash appearing with different versions indicates replay
4. **Queue Timing**: Check if queue entries have old timestamps
5. **Stale Payload Versions**: Queue entries with version < current DB version

### 4. Share the Output
Copy the entire output of the debug script and share it. Focus on:
- The "RECENT DOCUMENT HISTORY" section
- The "OFFLINE QUEUE ENTRIES" section
- Any entries in "DUPLICATE VERSION CHECK"

## Quick Checks

### Check for multiple workspaces on the same note:
```sql
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT note_id, COUNT(DISTINCT workspace_id) as workspace_count
FROM document_saves
GROUP BY note_id
HAVING COUNT(DISTINCT workspace_id) > 1;
"
```

### Check for recent queue activity:
```sql
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT table_name, type, status, COUNT(*) 
FROM offline_queue 
WHERE created_at > NOW() - INTERVAL '5 minutes'
GROUP BY table_name, type, status;
"
```

### Monitor real-time saves:
```sql
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT note_id, panel_id, version, workspace_id, created_at
FROM document_saves
WHERE created_at > NOW() - INTERVAL '1 minute'
ORDER BY created_at DESC;
"
```

## Hypothesis Testing

Based on the debug output, we'll identify which scenario is occurring:

1. **Workspace Mismatch**: Different `workspace_id` values → Fix workspace resolution
2. **Version Collision**: Same version, different content → Fix uniqueness constraint
3. **Queue Replay**: Old queue entries with stale versions → Fix queue processing
4. **Direct API Bypass**: No queue entries but still overwrites → Fix API validation
5. **Race Condition**: Rapid successive saves → Add optimistic locking

The debug output will reveal which path needs additional hardening.