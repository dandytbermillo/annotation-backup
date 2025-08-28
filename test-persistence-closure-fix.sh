#!/bin/bash

echo "🧪 Testing Persistence Handler Closure Fix"
echo "========================================"
echo ""

echo "1. Check console output patterns:"
echo "   You should see these patterns in browser console:"
echo ""
echo "   [SETUP] Setting up persistence handler for note-XXX-panel-main"
echo "   [UPDATE] Persisted update 1 for note-XXX-panel-main"
echo "   [LOAD] Loading existing content for note-XXX-panel-main"
echo "   [UPDATE] Update handler called with initialLoadComplete: true"
echo ""

echo "2. Database check - recent updates:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    COUNT(*) as updates,
    MAX(timestamp) as last_update,
    NOW() - MAX(timestamp) as age
FROM yjs_updates 
WHERE timestamp > NOW() - INTERVAL '10 minutes'
GROUP BY doc_name
ORDER BY last_update DESC
LIMIT 5;"

echo ""
echo "3. Testing Protocol with Console Monitoring:"
echo ""
echo "   📝 Phase 1 - Initial Setup:"
echo "   a) Open browser DevTools Console"
echo "   b) Clear browser data (Cmd+Shift+Delete)"
echo "   c) Navigate to http://localhost:3000"
echo "   d) Create Note 1 and type: 'First content'"
echo "   e) Watch for: [UPDATE] Persisted update 1"
echo ""
echo "   🔄 Phase 2 - First Reload Test:"
echo "   f) Reload page (Cmd+R)"
echo "   g) Watch for: [LOAD] Applied loaded content"
echo "   h) Watch for: [CACHE] Retrieved from cache"
echo "   i) Type: ' - After first reload'"
echo "   j) Watch for: [UPDATE] with initialLoadComplete: true"
echo ""
echo "   🔄 Phase 3 - Second Reload Test:"
echo "   k) Reload again (Cmd+R)"
echo "   l) Content should show: 'First content - After first reload'"
echo "   m) Type: ' - After second reload'"
echo "   n) Watch for: [UPDATE] with initialLoadComplete: true"
echo ""
echo "   🔄 Phase 4 - Third Reload Test:"
echo "   o) Reload once more (Cmd+R)"
echo "   p) Full content preserved: 'First content - After first reload - After second reload'"
echo ""

echo "4. Key Success Indicators in Console:"
echo "   ✅ initialLoadComplete: true after first reload"
echo "   ✅ updateCount incrementing (1, 2, 3...)"
echo "   ✅ No 'Skipping update' messages"
echo "   ✅ [SETUP] Removing old handler messages"
echo ""

echo "5. Quick Database Verification:"
echo "   Run this to see update counts increasing:"
echo "   watch -n 2 \"docker exec annotation_postgres psql -U postgres -d annotation_system -c 'SELECT doc_name, COUNT(*) as updates FROM yjs_updates GROUP BY doc_name ORDER BY updates DESC LIMIT 5;'\""