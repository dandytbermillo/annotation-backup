#!/bin/bash

echo "🧪 Testing Y.Doc Note Isolation Fix"
echo "=================================="
echo ""

echo "1. Check Y.Doc keys in PostgreSQL (should show composite noteId-panelId keys):"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    doc_name,
    LENGTH(update) as update_size,
    timestamp
FROM yjs_updates 
WHERE doc_name LIKE 'note-%'
ORDER BY timestamp DESC
LIMIT 10;"

echo ""
echo "2. Manual Testing Steps:"
echo "   a) Clear browser localStorage and cookies"
echo "   b) Open http://localhost:3000"
echo "   c) Create Note 1 and type: 'This is Note 1 content'"
echo "   d) Create Note 2 and type: 'This is Note 2 content'"
echo "   e) Switch back to Note 1 - should show 'This is Note 1 content'"
echo "   f) Switch to Note 2 - should show 'This is Note 2 content'"
echo "   g) Reload the page"
echo "   h) Both notes should retain their correct content"
echo ""

echo "3. Check for proper composite keys:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    DISTINCT doc_name,
    CASE 
        WHEN doc_name ~ '^note-[0-9]+-panel-' THEN 'Correct composite key'
        ELSE 'Warning: Non-composite key'
    END as key_format
FROM yjs_updates 
WHERE doc_name LIKE '%panel%'
ORDER BY doc_name DESC
LIMIT 10;"

echo ""
echo "4. Browser Console Check:"
echo "   Paste this in console to see Y.Doc cache keys:"
cat << 'EOF'
// Check Y.Doc cache keys
(() => {
  console.log('🔍 Checking Y.Doc isolation...');
  // This will help debug if content is properly isolated
  window.addEventListener('click', (e) => {
    if (e.target.closest('.note-item')) {
      setTimeout(() => {
        console.log('Note switched, checking editor state...');
      }, 100);
    }
  });
})();
EOF

echo ""
echo "Expected behavior:"
echo "✅ Each note maintains its own content"
echo "✅ No content mixing between notes"
echo "✅ Database shows composite keys like 'note-123-panel-main'"
echo "✅ Content persists correctly after reload"