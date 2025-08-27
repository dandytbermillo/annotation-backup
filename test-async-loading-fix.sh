#!/bin/bash

echo "🧪 Testing Async Y.Doc Loading Fix"
echo "================================="
echo ""

echo "1. Check if Y.js utils module exists:"
if [ -f "lib/yjs-utils.ts" ]; then
    echo "✅ lib/yjs-utils.ts exists"
else
    echo "❌ lib/yjs-utils.ts missing!"
fi

echo ""
echo "2. Testing in Browser:"
echo "   a) Open http://localhost:3000"
echo "   b) Create Note 1 with content"
echo "   c) Create Note 2 with different content"
echo "   d) Switch to Note 1"
echo "   e) You should see 'Loading content...' briefly"
echo "   f) Then Note 1 content should appear"
echo "   g) Switch to Note 2"
echo "   h) Again see 'Loading content...' then Note 2 content"
echo ""

echo "3. Check PostgreSQL for proper keys:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    COUNT(*) as updates,
    MAX(timestamp) as last_update
FROM yjs_updates 
WHERE doc_name LIKE '%-panel-%'
GROUP BY doc_name
ORDER BY last_update DESC
LIMIT 5;"

echo ""
echo "4. Browser Console Test:"
echo "   Paste this in console to monitor loading states:"
cat << 'EOF'
// Monitor Y.Doc loading
(() => {
  const originalLog = console.log;
  console.log = function(...args) {
    if (args[0] && args[0].includes('Loaded content for panel')) {
      console.warn('🎯 Y.Doc Loaded:', ...args);
    }
    originalLog.apply(console, args);
  };
  console.log('📊 Monitoring Y.Doc loads...');
})();
EOF

echo ""
echo "Expected behavior:"
echo "✅ 'Loading content...' appears when switching notes"
echo "✅ Content loads after a brief moment"
echo "✅ No empty editor state"
echo "✅ Console shows 'Loaded content for panel' messages"