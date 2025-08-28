#!/bin/bash

echo "🧪 Testing Multiple Reload Persistence Fix"
echo "========================================="
echo ""

echo "1. Current database state:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    COUNT(DISTINCT doc_name) as total_docs,
    COUNT(*) as total_updates,
    MAX(timestamp) as latest_update,
    NOW() - MAX(timestamp) as time_since_last
FROM yjs_updates 
WHERE doc_name LIKE 'note-%-panel-%';"

echo ""
echo "2. Manual Testing Protocol:"
echo ""
echo "   🔄 Reload Cycle 1:"
echo "   a) Clear browser data and restart dev server"
echo "   b) Create Note 1: Type 'Initial content'"
echo "   c) Wait 2 seconds"
echo "   d) Reload (Cmd+R)"
echo "   e) Verify: 'Initial content' persisted ✓"
echo ""
echo "   🔄 Reload Cycle 2:"
echo "   f) Add: ' - First edit'"
echo "   g) Wait 2 seconds"
echo "   h) Reload (Cmd+R)"
echo "   i) Verify: 'Initial content - First edit' persisted ✓"
echo ""
echo "   🔄 Reload Cycle 3:"
echo "   j) Add: ' - Second edit'"
echo "   k) Wait 2 seconds"
echo "   l) Reload (Cmd+R)"
echo "   m) Verify: 'Initial content - First edit - Second edit' persisted ✓"
echo ""
echo "   🔄 Reload Cycle 4+:"
echo "   n) Continue adding edits and reloading"
echo "   o) All edits should persist across unlimited reloads ✓"
echo ""

echo "3. Browser Console Verification:"
cat << 'EOF'
// Paste this to monitor persistence and handler setup
(() => {
  console.log('🔍 Monitoring persistence handlers...');
  
  // Monitor fetch for persistence
  const originalFetch = window.fetch;
  let persistCount = 0;
  window.fetch = function(...args) {
    if (args[0]?.includes('/api/persistence/persist')) {
      persistCount++;
      console.log(`✅ Persistence #${persistCount} at ${new Date().toLocaleTimeString()}`);
    }
    return originalFetch.apply(this, args);
  };
  
  // Check for duplicate handlers warning
  const checkHandlers = () => {
    console.log('Handler check - if you see "already set up", that\'s good!');
  };
  setInterval(checkHandlers, 5000);
})();
EOF

echo ""
echo "4. Database verification after multiple reloads:"
echo "   Run this after completing all reload cycles:"
echo "   ./test-multiple-reload-persistence.sh"
echo ""

echo "Expected behavior:"
echo "✅ Persistence works after 1st reload"
echo "✅ Persistence works after 2nd reload"
echo "✅ Persistence works after 3rd+ reloads"
echo "✅ Console shows 'Persistence handler already set up' (preventing duplicates)"
echo "✅ Each edit creates a new database entry"