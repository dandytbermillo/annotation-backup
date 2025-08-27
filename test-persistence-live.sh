#!/bin/bash

echo "🔍 Testing TipTap PostgreSQL Persistence"
echo "========================================"

# Get initial count
INITIAL_COUNT=$(docker exec -i annotation_postgres psql -U postgres -d annotation_system -t -c "SELECT COUNT(*) FROM yjs_updates;" | tr -d ' ')
echo "Initial update count: $INITIAL_COUNT"

echo ""
echo "📝 Please make some edits in the TipTap editor..."
echo "   1. Open http://localhost:3001"
echo "   2. Click 'Start Monitoring' in the bottom-right"
echo "   3. Edit some text in the editor"
echo "   4. Wait a few seconds"
echo ""
echo "Press Enter when you've made some edits..."
read

# Get new count
NEW_COUNT=$(docker exec -i annotation_postgres psql -U postgres -d annotation_system -t -c "SELECT COUNT(*) FROM yjs_updates;" | tr -d ' ')
echo ""
echo "New update count: $NEW_COUNT"

# Calculate difference
DIFF=$((NEW_COUNT - INITIAL_COUNT))

if [ $DIFF -gt 0 ]; then
    echo "✅ Success! $DIFF new updates were persisted to PostgreSQL"
    
    # Show recent updates
    echo ""
    echo "Recent updates:"
    docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "SELECT doc_name, octet_length(update) as size, timestamp FROM yjs_updates ORDER BY timestamp DESC LIMIT 5;"
else
    echo "❌ No new updates detected. TipTap changes might not be persisting."
fi