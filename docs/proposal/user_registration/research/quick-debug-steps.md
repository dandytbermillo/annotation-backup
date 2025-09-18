# Quick Debug Steps for Workspace Divergence

## Prerequisites
1. **Start PostgreSQL** (either Docker or local)
2. **Start Next.js server**: `npm run dev`
3. **Have psql installed** (for the debug script to work)

## Step 1: Find Your Note and Panel IDs

### Method A: Browser DevTools
1. Open Chrome/Firefox DevTools (F12)
2. Go to Network tab
3. Edit your document ("first1.md")
4. Look for POST requests to `/api/postgres-offline/documents`
5. Check the Request URL - it contains:
   - `noteId` (UUID format)
   - `panelId` (UUID format or "main")

### Method B: Database Query
```bash
# Find recent documents
psql -h localhost -U postgres -d annotation_dev -c "
SELECT DISTINCT note_id, panel_id, MAX(created_at) as last_edit
FROM document_saves
WHERE created_at > NOW() - INTERVAL '10 minutes'
GROUP BY note_id, panel_id
ORDER BY last_edit DESC;
"
```

## Step 2: Reproduce the Issue

1. **Clear the queues** (already done)
2. **Open Browser A** - Edit "first1.md", type "Content from Browser A"
3. **Open Browser B** - Open same file, should see "Content from Browser A"
4. **In Browser B** - Change to "Content from Browser B"
5. **Switch to Browser A** - Refresh or wait for autosave
6. **Note if content reverts** to "Content from Browser A"

## Step 3: Capture Debug Info Immediately

Run the debug script right after seeing the divergence:

```bash
# Use the direct connection version (no Docker required)
./scripts/debug-workspace-divergence-direct.sh <note_id> <panel_id>

# Example with real UUIDs:
./scripts/debug-workspace-divergence-direct.sh 7f3e4d2c-9a1b-4c5d-8e2f-1234567890ab main
```

## Step 4: Manual Quick Checks

If the script fails, run these queries manually:

### Check workspace consistency:
```sql
psql -h localhost -U postgres -d annotation_dev -c "
SELECT note_id, panel_id, 
       COUNT(DISTINCT workspace_id) as workspace_count,
       STRING_AGG(DISTINCT workspace_id::text, ', ') as workspaces
FROM document_saves
WHERE note_id = 'YOUR_NOTE_ID' 
  AND panel_id = 'YOUR_PANEL_ID'
GROUP BY note_id, panel_id;
"
```

### Check recent versions:
```sql
psql -h localhost -U postgres -d annotation_dev -c "
SELECT version, workspace_id,
       LEFT(MD5(content::text), 8) as content_hash,
       created_at
FROM document_saves
WHERE note_id = 'YOUR_NOTE_ID' 
  AND panel_id = 'YOUR_PANEL_ID'
ORDER BY version DESC
LIMIT 5;
"
```

### Check offline queue:
```sql
psql -h localhost -U postgres -d annotation_dev -c "
SELECT type, status, 
       (data->>'version')::int as version,
       created_at
FROM offline_queue
WHERE table_name = 'document_saves'
  AND data->>'noteId' = 'YOUR_NOTE_ID'
ORDER BY created_at DESC;
"
```

## Step 5: What to Look For

### 🔴 Red Flags:
- **Different workspace_ids** in document_saves for same note
- **Duplicate versions** with different content hashes
- **Queue entries** with old versions still pending
- **Version gaps** (e.g., 1, 2, 5, 6 - missing 3, 4)

### 🟢 Expected Behavior:
- Single workspace_id for all versions
- Sequential version numbers
- Empty or processed queue entries
- Matching content hashes for same version

## Step 6: Share the Evidence

Copy and share:
1. The full output of the debug script
2. Screenshots of Browser A and B showing different content
3. Network tab showing the POST requests
4. Any error messages in browser console

## Alternative: Use the API Debug Endpoint

If you can't run psql, use the debug API:

```bash
curl "http://localhost:3000/api/postgres-offline/debug/documents?noteId=YOUR_NOTE_ID&panelId=YOUR_PANEL_ID" | python3 -m json.tool
```

This will show recent document history and queue entries in JSON format.