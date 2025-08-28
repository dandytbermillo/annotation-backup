#!/bin/bash

echo "🧪 Testing Reload Content Fix"
echo "============================"
echo ""

echo "1. Check Y.js update sizes in PostgreSQL:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    COUNT(*) as update_count,
    MIN(LENGTH(update)) as smallest_update,
    MAX(LENGTH(update)) as largest_update,
    AVG(LENGTH(update))::int as avg_update_size
FROM yjs_updates 
WHERE doc_name LIKE 'note-%-panel-main'
GROUP BY doc_name
ORDER BY doc_name DESC
LIMIT 5;"

echo ""
echo "2. Check for small updates (single keystrokes):"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    LENGTH(update) as size,
    timestamp
FROM yjs_updates 
WHERE doc_name LIKE 'note-%-panel-main'
  AND LENGTH(update) < 30
ORDER BY timestamp DESC
LIMIT 10;"

echo ""
echo "3. Manual Testing Steps:"
echo "   a) Clear browser data and restart dev server"
echo "   b) Create Note 1 and type: 'Hello World 123'"
echo "   c) Create Note 2 and type: 'Testing ABC 456'"
echo "   d) Make single character edits in both notes"
echo "   e) Reload the page (Cmd+R or F5)"
echo "   f) Note 1 should show: 'Hello World 123' (not just '3')"
echo "   g) Note 2 should show: 'Testing ABC 456' (not just '3')"
echo ""

echo "4. Check for prosemirror vs default fragments:"
echo "   In browser console, run:"
cat << 'EOF'
// Check fragment usage
(() => {
  const checkFragments = () => {
    if (window.ydoc) {
      const defaultFrag = window.ydoc.getXmlFragment('default');
      const prosemirrorFrag = window.ydoc.getXmlFragment('prosemirror');
      console.log('Default fragment length:', defaultFrag?.length || 0);
      console.log('Prosemirror fragment length:', prosemirrorFrag?.length || 0);
      console.log('Metadata:', window.ydoc.getMap('metadata').toJSON());
    }
  };
  setTimeout(checkFragments, 1000);
})();
EOF

echo ""
echo "Expected behavior:"
echo "✅ Full content preserved after reload (not just last character)"
echo "✅ Small updates (18-20 bytes) are persisted"
echo "✅ Each note maintains its own unique content"
echo "✅ No content mixing between notes"