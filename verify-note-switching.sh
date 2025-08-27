#!/bin/bash

echo "🔍 Verifying Note Switching Fix"
echo "==============================="
echo ""

# Check current cache status in the database
echo "1. Current documents in PostgreSQL:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    COUNT(*) as update_count,
    MAX(timestamp) as last_update
FROM yjs_updates 
WHERE doc_name LIKE '%-panel-%'
GROUP BY doc_name
ORDER BY last_update DESC
LIMIT 10;"

echo ""
echo "2. Testing Instructions:"
echo "   a) Open http://localhost:3000"
echo "   b) Create or select Note 1"
echo "   c) Add some content (e.g., 'Note 1 content')"
echo "   d) Create or select Note 2"
echo "   e) Add different content (e.g., 'Note 2 content')"
echo "   f) Switch back to Note 1"
echo "   g) Content should appear immediately (no empty editor)"
echo "   h) Switch to Note 2"
echo "   i) Content should appear immediately"
echo ""
echo "3. Expected Behavior:"
echo "   ✅ Content appears instantly when switching notes"
echo "   ✅ No empty editor flashes"
echo "   ✅ Each note maintains its own content"
echo "   ✅ Content persists after page reload"
echo ""
echo "4. Browser Console Commands:"
echo "   To check editor cache status, paste this in console:"
echo ""
cat << 'EOF'
// Check Y.Doc cache status
console.log('Checking editor Y.Doc cache...');
const checkCache = () => {
  const editorElements = document.querySelectorAll('.tiptap-editor');
  editorElements.forEach(el => {
    const panelId = el.getAttribute('data-panel');
    console.log(`Panel ${panelId}:`, el.textContent.trim().substring(0, 50) + '...');
  });
};
checkCache();

// Monitor cache hits
let originalGetEditorYDoc;
if (window.getEditorYDoc) {
  originalGetEditorYDoc = window.getEditorYDoc;
  window.getEditorYDoc = function(panelId, noteId) {
    console.log(`📝 Getting Y.Doc for note=${noteId}, panel=${panelId}`);
    return originalGetEditorYDoc.apply(this, arguments);
  };
}
EOF

echo ""
echo "5. To see real-time persistence activity:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    octet_length(update) as size,
    timestamp
FROM yjs_updates 
WHERE timestamp > NOW() - INTERVAL '5 minutes'
ORDER BY timestamp DESC
LIMIT 10;"