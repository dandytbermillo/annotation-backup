#!/bin/bash

# Debug script for workspace divergence issue (Direct PostgreSQL connection)
# Usage: ./scripts/debug-workspace-divergence-direct.sh <note_id> <panel_id>

NOTE_ID=$1
PANEL_ID=$2

# PostgreSQL connection settings - adjust these if needed
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}
PGDATABASE=${PGDATABASE:-annotation_dev}
PGUSER=${PGUSER:-postgres}
PGPASSWORD=${PGPASSWORD:-postgres}

# Export for psql to use
export PGPASSWORD

if [ -z "$NOTE_ID" ] || [ -z "$PANEL_ID" ]; then
    echo "Usage: $0 <note_id> <panel_id>"
    echo "Example: $0 123e4567-e89b-12d3-a456-426614174000 987fcdeb-51a2-43f1-9abc-def012345678"
    echo ""
    echo "To find your note_id and panel_id:"
    echo "1. Open browser DevTools Network tab"
    echo "2. Edit the document"
    echo "3. Look for requests to /api/postgres-offline/documents"
    echo "4. The URL will contain noteId and panelId"
    exit 1
fi

echo "========================================="
echo "Workspace Divergence Debug Report"
echo "========================================="
echo "Timestamp: $(date)"
echo "Note ID: $NOTE_ID"
echo "Panel ID: $PANEL_ID"
echo "Database: $PGDATABASE@$PGHOST:$PGPORT"
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "ERROR: psql command not found. Please install PostgreSQL client tools."
    echo "On macOS: brew install postgresql"
    echo "On Ubuntu: apt-get install postgresql-client"
    exit 1
fi

echo "1. WORKSPACE CONFIGURATION:"
echo "----------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -t -c "
SELECT 'Default Workspace: ' || id || ' (created: ' || created_at || ')'
FROM workspaces WHERE is_default = true;
" 2>/dev/null || echo "Failed to connect to database. Check your PostgreSQL settings."

echo ""
echo "2. WORKSPACE USAGE FOR THIS NOTE:"
echo "----------------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "
SELECT DISTINCT workspace_id, COUNT(*) as version_count, MAX(version) as latest_version
FROM document_saves 
WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
GROUP BY workspace_id;
" 2>/dev/null

echo ""
echo "3. RECENT DOCUMENT HISTORY (last 10 versions):"
echo "------------------------------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "
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
" 2>/dev/null

echo ""
echo "4. OFFLINE QUEUE ENTRIES FOR THIS DOCUMENT:"
echo "--------------------------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "
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
" 2>/dev/null

echo ""
echo "5. API DEBUG ENDPOINT OUTPUT:"
echo "------------------------------"
API_URL="http://localhost:3000/api/postgres-offline/debug/documents?noteId=$NOTE_ID&panelId=$PANEL_ID"
echo "Fetching from: $API_URL"
if curl -s -f "$API_URL" 2>/dev/null | python3 -m json.tool 2>/dev/null; then
    echo ""
else
    echo "Failed to fetch debug endpoint. Is the Next.js server running on port 3000?"
    echo "Start it with: npm run dev"
fi

echo ""
echo "6. DUPLICATE VERSION CHECK:"
echo "----------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "
SELECT version, COUNT(*) as duplicate_count, 
       STRING_AGG(DISTINCT workspace_id::text, ', ') as workspaces,
       STRING_AGG(DISTINCT LEFT(MD5(content::text), 8), ', ') as content_hashes
FROM document_saves
WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
GROUP BY version
HAVING COUNT(*) > 1
ORDER BY version DESC;
" 2>/dev/null

echo ""
echo "7. ALL WORKSPACES IN SYSTEM:"
echo "-----------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "
SELECT id, name, is_default, created_at
FROM workspaces
ORDER BY created_at;
" 2>/dev/null

echo ""
echo "8. RECENT SAVES (last minute):"
echo "-------------------------------"
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "
SELECT note_id, panel_id, version, workspace_id, 
       LEFT(MD5(content::text), 8) as content_hash,
       created_at
FROM document_saves
WHERE created_at > NOW() - INTERVAL '1 minute'
ORDER BY created_at DESC
LIMIT 20;
" 2>/dev/null

echo ""
echo "========================================="
echo "TROUBLESHOOTING NOTES:"
echo "========================================="
echo "1. If database connection fails, check:"
echo "   - PostgreSQL is running (postgres container or local)"
echo "   - Credentials are correct (PGPASSWORD=postgres)"
echo "   - Database exists (annotation_dev)"
echo ""
echo "2. If API endpoint fails, ensure:"
echo "   - Next.js server is running (npm run dev)"
echo "   - Server is on port 3000"
echo ""
echo "3. To find note_id and panel_id:"
echo "   - Open browser DevTools > Network tab"
echo "   - Edit the document"
echo "   - Look for requests to /api/postgres-offline/documents"
echo "   - The request will show noteId and panelId"
echo ""
echo "========================================="
echo "END OF REPORT"
echo "========================================="