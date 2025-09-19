#!/bin/bash

# Test script to verify reload behavior when editing notes
# This will help us understand if it really takes two reloads to see changes

echo "=== Testing Reload Behavior for Note Changes ==="
echo "Timestamp: $(date)"
echo ""

# Test configuration
NOTE_ID="first1"
PANEL_ID="main"
TEST_CONTENT="Test content at $(date +%s)"
DB_NAME="annotation_dev"

echo "1. Checking current content in database for note: $NOTE_ID"
echo "=================================================="
PGPASSWORD=postgres psql -h localhost -U postgres -d $DB_NAME -t -c "
  SELECT 
    version,
    substring(content::text, 1, 100) as content_preview,
    created_at
  FROM document_saves 
  WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
  ORDER BY version DESC 
  LIMIT 3;
" | sed 's/^/  /'

echo ""
echo "2. Simulating a save via API"
echo "============================="
RESPONSE=$(curl -s -X POST http://localhost:3001/api/postgres-offline/documents \
  -H "Content-Type: application/json" \
  -d "{
    \"noteId\": \"$NOTE_ID\",
    \"panelId\": \"$PANEL_ID\",
    \"content\": \"<p>$TEST_CONTENT</p>\",
    \"baseVersion\": 0
  }")

echo "API Response: $RESPONSE"

echo ""
echo "3. Immediately checking database (simulating first reload)"
echo "========================================================="
sleep 0.1  # Very short delay
PGPASSWORD=postgres psql -h localhost -U postgres -d $DB_NAME -t -c "
  SELECT 
    version,
    substring(content::text, 1, 100) as content_preview,
    created_at
  FROM document_saves 
  WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
  ORDER BY version DESC 
  LIMIT 1;
" | sed 's/^/  /'

echo ""
echo "4. Checking after a delay (simulating second reload)"
echo "===================================================="
sleep 2  # Wait for any async operations
PGPASSWORD=postgres psql -h localhost -U postgres -d $DB_NAME -t -c "
  SELECT 
    version,
    substring(content::text, 1, 100) as content_preview,
    created_at
  FROM document_saves 
  WHERE note_id = '$NOTE_ID' AND panel_id = '$PANEL_ID'
  ORDER BY version DESC 
  LIMIT 1;
" | sed 's/^/  /'

echo ""
echo "5. Testing GET endpoint (what the UI would fetch)"
echo "================================================="
curl -s "http://localhost:3001/api/postgres-offline/documents?noteId=$NOTE_ID&panelId=$PANEL_ID" | jq '.version, .content' 2>/dev/null || echo "Failed to fetch"

echo ""
echo "6. Checking cache behavior by fetching twice"
echo "==========================================="
echo "First fetch:"
time curl -s "http://localhost:3001/api/postgres-offline/documents?noteId=$NOTE_ID&panelId=$PANEL_ID" > /dev/null 2>&1
echo "Second fetch (should be same or faster if cached):"
time curl -s "http://localhost:3001/api/postgres-offline/documents?noteId=$NOTE_ID&panelId=$PANEL_ID" > /dev/null 2>&1

echo ""
echo "=== Test Complete ==="