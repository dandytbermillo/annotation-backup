#!/bin/bash

echo "🧪 Testing New Note Isolation"
echo "============================"
echo ""

# Get current timestamp for unique identification
TIMESTAMP=$(date +%s)

echo "1. Creating test data with timestamp: $TIMESTAMP"

# Test the API directly with a new note ID
NOTE_ID="test-note-$TIMESTAMP"
PANEL_ID="main"
DOC_NAME="${NOTE_ID}-panel-${PANEL_ID}"

echo ""
echo "2. Testing persistence with new key format:"
echo "   Note ID: $NOTE_ID"
echo "   Panel ID: $PANEL_ID"
echo "   Doc Name: $DOC_NAME"

# Create a test update
echo ""
echo "3. Persisting test data..."
curl -X POST http://localhost:3000/api/persistence/persist \
  -H "Content-Type: application/json" \
  -d "{
    \"docName\": \"$DOC_NAME\",
    \"update\": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  }" \
  -w "\n   HTTP Status: %{http_code}\n" \
  -s

# Check if it was saved
echo ""
echo "4. Checking database for new format..."
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name, 
    octet_length(update) as size, 
    timestamp 
FROM yjs_updates 
WHERE doc_name = '$DOC_NAME'
ORDER BY timestamp DESC 
LIMIT 1;"

echo ""
echo "5. Verifying isolation - checking for cross-contamination..."
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    COUNT(DISTINCT substring(doc_name from '^([^-]+-[^-]+)')) as unique_notes,
    COUNT(*) as total_updates
FROM yjs_updates 
WHERE doc_name LIKE '%-panel-%';"

echo ""
echo "✅ Test complete! Check results above."