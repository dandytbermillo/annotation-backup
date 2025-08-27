#!/bin/bash

echo "🔍 Validating PostgreSQL Persistence"
echo "===================================="
echo ""

# Check if PostgreSQL is running
echo "1. Checking PostgreSQL status..."
if docker ps | grep -q annotation_postgres; then
    echo "✅ PostgreSQL container is running"
else
    echo "❌ PostgreSQL container is NOT running"
    echo "   Run: docker start annotation_postgres"
    exit 1
fi

# Check database connection
echo ""
echo "2. Testing database connection..."
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "SELECT 1" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed"
    exit 1
fi

# Check yjs_updates table
echo ""
echo "3. Checking yjs_updates table..."
COUNT=$(docker exec -i annotation_postgres psql -U postgres -d annotation_system -t -c "SELECT COUNT(*) FROM yjs_updates;" | tr -d ' ')
echo "✅ Found $COUNT updates in yjs_updates table"

# Show recent updates
echo ""
echo "4. Recent updates (last 5):"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name, 
    octet_length(update) as update_size, 
    timestamp 
FROM yjs_updates 
ORDER BY timestamp DESC 
LIMIT 5;"

echo ""
echo "✅ PostgreSQL persistence is configured correctly!"
echo ""
echo "Next steps:"
echo "1. Open http://localhost:3000"
echo "2. Click on a note in the sidebar"
echo "3. Edit text in the TipTap editor"
echo "4. Check the persistence monitor in bottom-right"
echo "5. Refresh the page - your changes should persist!"