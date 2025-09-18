#!/bin/bash

# Debug script for workspace divergence issue
# Usage: ./scripts/debug-workspace-divergence.sh <note_id> <panel_id>

NOTE_ID=$1
PANEL_ID=$2

if [ -z "$NOTE_ID" ] || [ -z "$PANEL_ID" ]; then
    echo "Usage: $0 <note_id> <panel_id>"
    echo "Example: $0 123e4567-e89b-12d3-a456-426614174000 987fcdeb-51a2-43f1-9abc-def012345678"
    exit 1
fi

echo "========================================="
echo "Workspace Divergence Debug Report"
echo "========================================="
echo "Timestamp: $(date)"
echo "Note ID: $NOTE_ID"
echo "Panel ID: $PANEL_ID"
echo ""

echo "1. WORKSPACE CONFIGURATION:"
echo "----------------------------"
docker exec annotation_postgres psql -U postgres -d annotation_dev -t -c "
SELECT 'Default Workspace: ' || id || ' (created: ' || created_at || ')'
FROM workspaces WHERE is_default = true;
"

echo ""
echo "2. WORKSPACE USAGE FOR THIS NOTE:"
echo "----------------------------------"
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT DISTINCT workspace_id, COUNT(*) as version_count, MAX(version) as latest_version
FROM document_saves 
WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
GROUP BY workspace_id;
"

echo ""
echo "3. RECENT DOCUMENT HISTORY (last 10 versions):"
echo "------------------------------------------------"
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT 
  version,
  workspace_id,
  LEFT(MD5(content::text), 8) AS content_hash,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
FROM document_saves
WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
ORDER BY version DESC
LIMIT 10;
"

echo ""
echo "4. OFFLINE QUEUE ENTRIES FOR THIS DOCUMENT:"
echo "--------------------------------------------"
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT 
  id,
  type,
  status,
  retry_count,
  (data->>'version')::int AS payload_version,
  LEFT(MD5(COALESCE(data->>'content', '')), 8) AS content_hash,
  created_at,
  updated_at
FROM offline_queue
WHERE table_name = 'document_saves'
  AND (data->>'noteId' = '$NOTE_ID' OR data->>'note_id' = '$NOTE_ID')
  AND (data->>'panelId' = '$PANEL_ID' OR data->>'panel_id' = '$PANEL_ID')
ORDER BY created_at DESC;
"

echo ""
echo "5. API DEBUG ENDPOINT OUTPUT:"
echo "------------------------------"
echo "Fetching from: http://localhost:3000/api/postgres-offline/debug/documents?noteId=$NOTE_ID&panelId=$PANEL_ID"
curl -s "http://localhost:3000/api/postgres-offline/debug/documents?noteId=$NOTE_ID&panelId=$PANEL_ID" | python3 -m json.tool 2>/dev/null || echo "Failed to fetch debug endpoint (is the server running?)"

echo ""
echo "6. DUPLICATE VERSION CHECK:"
echo "----------------------------"
docker exec annotation_postgres psql -U postgres -d annotation_dev -c "
SELECT version, COUNT(*) as duplicate_count, 
       STRING_AGG(DISTINCT workspace_id::text, ', ') as workspaces,
       STRING_AGG(DISTINCT LEFT(MD5(content::text), 8), ', ') as content_hashes
FROM document_saves
WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
GROUP BY version
HAVING COUNT(*) > 1
ORDER BY version DESC;
"

echo ""
echo "========================================="
echo "END OF REPORT"
echo "========================================="