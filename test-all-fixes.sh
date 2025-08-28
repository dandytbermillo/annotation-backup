#!/bin/bash

echo "🧪 Comprehensive Test - All TipTap Fixes"
echo "========================================"
echo ""

echo "Testing the following fixes:"
echo "1. Y.js content duplication fix"
echo "2. Note switching empty editor fix"
echo "3. Async Y.Doc loading fix"
echo "4. TipTap content deletion fix"
echo "5. Y.Doc cross-note contamination fix"
echo "6. Reload content fix (fragment field mismatch)"
echo "7. Post-reload persistence fix"
echo "8. Multiple reload persistence fix"
echo "9. Persistence closure fix (object-based state)"
echo ""

echo "Database Status:"
echo "---------------"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    COUNT(DISTINCT doc_name) as unique_docs,
    COUNT(*) as total_updates,
    MIN(LENGTH(update)) as smallest_update,
    MAX(LENGTH(update)) as largest_update
FROM yjs_updates 
WHERE doc_name LIKE 'note-%-panel-%';"

echo ""
echo "Composite Key Check:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    CASE 
        WHEN doc_name ~ '^note-[0-9]+-panel-' THEN 'Correct'
        ELSE 'Incorrect'
    END as key_format,
    COUNT(*) as count
FROM yjs_updates 
WHERE doc_name LIKE '%panel%'
GROUP BY key_format;"

echo ""
echo "📋 Manual Testing Checklist:"
echo ""
echo "□ 0. Open browser DevTools Console (F12)"
echo "□ 1. Start fresh: Clear browser data"
echo "□ 2. Create Note 1: Type 'Hello World from Note 1'"
echo "□ 3. Create Note 2: Type 'Testing content in Note 2'"
echo "□ 4. Switch to Note 1: Should see 'Hello World from Note 1'"
echo "□ 5. Switch to Note 2: Should see 'Testing content in Note 2'"
echo "□ 6. Edit Note 1: Add single characters"
echo "□ 7. Edit Note 2: Add single characters"
echo "□ 8. Reload the page (Cmd+R)"
echo "□ 9. Check Note 1: Full content preserved"
echo "□ 10. Check Note 2: Full content preserved"
echo "□ 11. Add more text to both notes after reload"
echo "    → Console should show: [UPDATE] with initialLoadComplete: true"
echo "□ 12. Reload again - new edits should persist"
echo "□ 13. Add even more text after 2nd reload"
echo "    → Console should show: [UPDATE] with initialLoadComplete: true"
echo "□ 14. Reload 3rd time - all edits still persist"
echo ""

echo "✅ Expected Results:"
echo "- No content duplication"
echo "- No empty editors when switching"
echo "- Loading state shown briefly"
echo "- Content preserved when switching"
echo "- No content mixing between notes"
echo "- Full content after reload"
echo "- Post-reload edits persist correctly"
echo "- Unlimited reload cycles supported"
echo ""

echo "❌ Known Issues to Watch For:"
echo "- Import errors for Awareness (run ./install-missing-deps.sh)"
echo "- If content still mixes, check browser console for errors"
echo ""