#!/bin/bash

echo "🧪 Testing Post-Reload Persistence Fix"
echo "====================================="
echo ""

echo "1. Check recent updates (should show new timestamps after reload):"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    COUNT(*) as update_count,
    MAX(timestamp) as latest_update,
    NOW() - MAX(timestamp) as time_since_last_update
FROM yjs_updates 
WHERE doc_name LIKE 'note-%-panel-main'
GROUP BY doc_name
ORDER BY latest_update DESC
LIMIT 5;"

echo ""
echo "2. Monitor real-time updates:"
echo "   Run this command in another terminal to see updates as they happen:"
echo "   watch -n 1 \"docker exec annotation_postgres psql -U postgres -d annotation_system -c 'SELECT doc_name, timestamp FROM yjs_updates ORDER BY timestamp DESC LIMIT 5;'\""
echo ""

echo "3. Manual Testing Steps:"
echo "   Phase 1 - Initial Setup:"
echo "   a) Clear browser data and restart dev server"
echo "   b) Create Note 1 and type: 'Initial content'"
echo "   c) Reload the page (Cmd+R)"
echo "   d) Verify: 'Initial content' is preserved ✓"
echo ""
echo "   Phase 2 - Post-Reload Persistence:"
echo "   e) Add text: ' - Edit after reload'"
echo "   f) Wait 2 seconds for persistence"
echo "   g) Check database for new timestamp (run step 1 command again)"
echo "   h) Reload the page again"
echo "   i) Verify: 'Initial content - Edit after reload' is preserved ✓"
echo ""
echo "   Phase 3 - Continuous Editing:"
echo "   j) Continue adding text: ' - Another edit'"
echo "   k) Switch to another note and back"
echo "   l) Reload once more"
echo "   m) All edits should be preserved ✓"
echo ""

echo "4. Browser Console Test:"
cat << 'EOF'
// Monitor persistence in real-time
(() => {
  console.log('🔍 Monitoring Y.js persistence...');
  let updateCount = 0;
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    if (args[0]?.includes('/api/persistence/persist')) {
      updateCount++;
      console.log(`✅ Persistence update #${updateCount} sent at`, new Date().toLocaleTimeString());
    }
    return originalFetch.apply(this, args);
  };
})();
EOF

echo ""
echo "Expected behavior:"
echo "✅ All edits persist after reload (not just initial content)"
echo "✅ Database shows new timestamps for post-reload edits"
echo "✅ Console shows persistence requests for each edit"
echo "✅ Content accumulates correctly across multiple reload cycles"