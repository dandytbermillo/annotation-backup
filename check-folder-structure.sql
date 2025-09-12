-- Check folder structure and note distribution
SELECT 
    CASE 
        WHEN parent_id IS NULL THEN 'ROOT'
        WHEN parent_id = '995a97dc-f46e-4e8a-ad4f-ce69e4edb788' THEN 'RECENT FOLDER'
        WHEN parent_id = '5874d493-b6af-4711-9157-ddb21fdde4b3' THEN 'KNOWLEDGE BASE'
        ELSE 'OTHER'
    END as location,
    type,
    COUNT(*) as count
FROM items
WHERE deleted_at IS NULL
GROUP BY location, type
ORDER BY location, type;

-- Show a sample of notes and their parent
SELECT id, name, parent_id, type, path
FROM items
WHERE type = 'note' AND deleted_at IS NULL
LIMIT 10;