#!/bin/bash

echo "🧪 Testing TipTap Content Deletion Fix"
echo "====================================="
echo ""

echo "1. Check PostgreSQL for editor content:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    COUNT(*) as update_count,
    SUM(LENGTH(update)) as total_size,
    MAX(timestamp) as last_update
FROM yjs_updates 
WHERE doc_name LIKE '%-panel-%'
GROUP BY doc_name
ORDER BY last_update DESC
LIMIT 10;"

echo ""
echo "2. Manual Testing Steps:"
echo "   a) Open http://localhost:3000"
echo "   b) Create Note 1 and add TipTap content"
echo "   c) Create Note 2 and add different content"
echo "   d) Switch back to Note 1"
echo "   e) Content should be preserved (not deleted)"
echo ""

echo "3. Check for empty updates (should be none):"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    LENGTH(update) as update_size,
    timestamp
FROM yjs_updates 
WHERE doc_name LIKE '%-panel-%'
  AND LENGTH(update) < 30
ORDER BY timestamp DESC
LIMIT 5;"

echo ""
echo "4. Monitor console for skip messages:"
echo "   Look for: 'Skipping empty update for panel...'"
echo ""

echo "Expected behavior:"
echo "✅ TipTap content preserved when switching notes"
echo "✅ No content deletion"
echo "✅ No empty updates in database"
echo "✅ Instant content display when returning to notes"