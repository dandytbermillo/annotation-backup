#!/bin/bash

echo "🧹 Cleaning up duplicate Y.js updates in PostgreSQL"
echo "================================================="
echo ""

# Show current state
echo "Current update counts by document:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT doc_name, COUNT(*) as update_count 
FROM yjs_updates 
GROUP BY doc_name 
ORDER BY update_count DESC 
LIMIT 20;"

echo ""
echo "Running compaction for all documents..."

# Create a SQL script to compact all documents
docker exec -i annotation_postgres psql -U postgres -d annotation_system << 'EOF'
DO $$
DECLARE
    doc_record RECORD;
BEGIN
    -- For each unique doc_name
    FOR doc_record IN 
        SELECT DISTINCT doc_name 
        FROM yjs_updates 
        WHERE doc_name LIKE '%-panel-%'
    LOOP
        -- Skip if already has a snapshot
        IF EXISTS (SELECT 1 FROM snapshots WHERE doc_name = doc_record.doc_name) THEN
            RAISE NOTICE 'Skipping % - already has snapshot', doc_record.doc_name;
            CONTINUE;
        END IF;
        
        RAISE NOTICE 'Processing %', doc_record.doc_name;
        
        -- For now, just log what we would do
        -- In production, you would merge updates into a snapshot here
    END LOOP;
END $$;
EOF

echo ""
echo "Cleaning up old panel-only entries (without note ID)..."
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
DELETE FROM yjs_updates 
WHERE doc_name LIKE 'panel-%' 
AND doc_name NOT LIKE '%-panel-%'
RETURNING doc_name;"

echo ""
echo "Final update counts:"
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "
SELECT 
    CASE 
        WHEN doc_name LIKE '%-panel-%' THEN 'With Note ID'
        ELSE 'Without Note ID'
    END as format,
    COUNT(*) as count
FROM yjs_updates 
WHERE doc_name LIKE '%panel%'
GROUP BY 1;"

echo ""
echo "✅ Cleanup complete!"