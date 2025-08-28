#!/bin/bash

echo "🧪 Testing Infinite Load Loop Fix"
echo "================================="
echo ""

echo "1. Watch Terminal Output:"
echo "   Before fix: Continuous GET /api/persistence/load requests"
echo "   After fix: Should be quiet when idle"
echo ""

echo "2. Database Activity Check:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    COUNT(*) as total_requests_last_minute
FROM pg_stat_activity 
WHERE query LIKE '%yjs_updates%'
    AND state = 'active'
    AND query_start > NOW() - INTERVAL '1 minute';"

echo ""
echo "3. Testing Protocol:"
echo ""
echo "   📊 Phase 1 - Monitor Terminal:"
echo "   a) Start dev server: npm run dev"
echo "   b) Watch terminal output"
echo "   c) Open http://localhost:3000"
echo "   d) Click on a note"
echo "   e) Terminal should show ONE load request, not continuous"
echo ""
echo "   🔄 Phase 2 - Test Persistence:"
echo "   f) Type some content"
echo "   g) See [UPDATE] messages in console"
echo "   h) Reload page"
echo "   i) Content should persist"
echo "   j) Terminal should NOT flood with requests"
echo ""
echo "   🚫 Phase 3 - Verify No Loops:"
echo "   k) Leave the app idle for 30 seconds"
echo "   l) Terminal should be quiet"
echo "   m) No repeated GET requests"
echo ""

echo "4. Console Verification:"
cat << 'EOF'
// Check for proper memoization
console.log('Checking Y.Doc memoization...');
// You should see these patterns:
// [getEditorYDoc] Setting up persistence for cached doc note-XXX
// [LOAD] Loading data for note-XXX (ONCE)
// NOT repeating load messages
EOF

echo ""
echo "5. Performance Check:"
echo "   Run this to monitor request frequency:"
echo "   watch -n 1 'grep -c \"GET /api/persistence/load\" ~/.npm/_logs/$(ls -t ~/.npm/_logs/ | head -1)'"
echo ""

echo "Expected Results:"
echo "✅ Only ONE load request per note/panel"
echo "✅ Terminal quiet when idle"
echo "✅ Persistence works after reload"
echo "✅ No performance degradation"