-- Script to verify database write reduction after applying patches

-- Check recent document_saves to see version patterns
SELECT 
  note_id,
  panel_id,
  version,
  created_at,
  LENGTH(content::text) as content_size
FROM document_saves
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 20;

-- Count versions per panel in last hour
SELECT 
  note_id,
  panel_id,
  COUNT(*) as version_count,
  MIN(created_at) as first_save,
  MAX(created_at) as last_save,
  EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as duration_seconds
FROM document_saves
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY note_id, panel_id
ORDER BY version_count DESC;

-- Show version gaps to verify server-side versioning
SELECT 
  note_id,
  panel_id,
  version,
  LAG(version) OVER (PARTITION BY note_id, panel_id ORDER BY version) as prev_version,
  version - LAG(version) OVER (PARTITION BY note_id, panel_id ORDER BY version) as version_gap
FROM document_saves
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY note_id, panel_id, version;