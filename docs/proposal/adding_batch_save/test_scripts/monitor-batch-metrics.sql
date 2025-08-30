-- Real-time monitoring queries to verify batch implementation is working

-- ============================================
-- 1. CURRENT SESSION METRICS
-- ============================================
-- Shows write frequency in last 10 minutes
SELECT 
    'Last 10 minutes' as period,
    COUNT(*) as total_rows,
    COUNT(DISTINCT note_id || ':' || panel_id) as unique_panels,
    ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT note_id || ':' || panel_id), 0), 2) as avg_rows_per_panel,
    MAX(version) - MIN(version) + 1 as version_range,
    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as duration_seconds
FROM document_saves
WHERE created_at > NOW() - INTERVAL '10 minutes';

-- ============================================
-- 2. VERSION EXPLOSION CHECK
-- ============================================
-- Identifies panels with excessive versions (indicates batching not working)
SELECT 
    note_id,
    panel_id,
    COUNT(*) as version_count,
    MAX(version) as latest_version,
    ROUND(EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))/60, 2) as edit_duration_minutes,
    CASE 
        WHEN COUNT(*) > 10 AND EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) < 60 
        THEN '❌ EXCESSIVE - Batching may not be working!'
        WHEN COUNT(*) > 5 AND EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) < 60 
        THEN '⚠️  HIGH - Check debouncing'
        ELSE '✅ NORMAL'
    END as status
FROM document_saves
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY note_id, panel_id
ORDER BY version_count DESC
LIMIT 10;

-- ============================================
-- 3. WRITE FREQUENCY ANALYSIS
-- ============================================
-- Shows write patterns per minute (should see gaps if debouncing works)
WITH minute_buckets AS (
    SELECT 
        DATE_TRUNC('minute', created_at) as minute,
        COUNT(*) as writes_per_minute,
        COUNT(DISTINCT note_id || ':' || panel_id) as panels_written
    FROM document_saves
    WHERE created_at > NOW() - INTERVAL '30 minutes'
    GROUP BY DATE_TRUNC('minute', created_at)
)
SELECT 
    TO_CHAR(minute, 'HH24:MI') as time,
    writes_per_minute,
    panels_written,
    REPEAT('█', LEAST(writes_per_minute, 50)) as bar_chart
FROM minute_buckets
ORDER BY minute DESC
LIMIT 15;

-- ============================================
-- 4. DEDUPLICATION EFFECTIVENESS
-- ============================================
-- Check for identical consecutive content (should be minimal with dedup)
WITH content_changes AS (
    SELECT 
        note_id,
        panel_id,
        version,
        content,
        LAG(content) OVER (PARTITION BY note_id, panel_id ORDER BY version) as prev_content,
        created_at
    FROM document_saves
    WHERE created_at > NOW() - INTERVAL '1 hour'
)
SELECT 
    COUNT(*) FILTER (WHERE content::text = prev_content::text) as duplicate_saves,
    COUNT(*) as total_saves,
    ROUND(100.0 * COUNT(*) FILTER (WHERE content::text = prev_content::text) / NULLIF(COUNT(*), 0), 2) as duplicate_percentage
FROM content_changes;

-- ============================================
-- 5. BATCH COALESCING VERIFICATION
-- ============================================
-- Time gaps between saves (should see 800ms+ gaps with debouncing)
WITH save_gaps AS (
    SELECT 
        note_id,
        panel_id,
        version,
        created_at,
        LAG(created_at) OVER (PARTITION BY note_id, panel_id ORDER BY created_at) as prev_created,
        EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY note_id, panel_id ORDER BY created_at))) as gap_seconds
    FROM document_saves
    WHERE created_at > NOW() - INTERVAL '30 minutes'
)
SELECT 
    CASE 
        WHEN gap_seconds < 0.5 THEN '< 0.5s (❌ Too fast - batching issue?)'
        WHEN gap_seconds < 0.8 THEN '0.5-0.8s (⚠️  Close to debounce threshold)'
        WHEN gap_seconds < 2 THEN '0.8-2s (✅ Good - debouncing working)'
        WHEN gap_seconds < 5 THEN '2-5s (✅ Normal editing gaps)'
        ELSE '> 5s (✅ Separate edit sessions)'
    END as gap_range,
    COUNT(*) as occurrences
FROM save_gaps
WHERE gap_seconds IS NOT NULL
GROUP BY 1
ORDER BY 1;

-- ============================================
-- 6. CURRENT PERFORMANCE SCORE
-- ============================================
WITH metrics AS (
    SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT note_id || ':' || panel_id) as unique_panels,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes') as recent_rows
    FROM document_saves
    WHERE created_at > NOW() - INTERVAL '1 hour'
)
SELECT 
    CASE 
        WHEN unique_panels = 0 THEN 'No data'
        WHEN (total_rows::float / unique_panels) < 3 THEN '🏆 EXCELLENT - Batching highly effective'
        WHEN (total_rows::float / unique_panels) < 5 THEN '✅ GOOD - Batching working well'
        WHEN (total_rows::float / unique_panels) < 10 THEN '⚠️  FAIR - Some batching occurring'
        ELSE '❌ POOR - Batching not effective'
    END as performance_rating,
    total_rows,
    unique_panels,
    ROUND(total_rows::numeric / NULLIF(unique_panels, 0), 2) as avg_rows_per_panel
FROM metrics;

-- ============================================
-- 7. LIVE TAIL (Last 10 saves)
-- ============================================
SELECT 
    TO_CHAR(created_at, 'HH24:MI:SS') as time,
    note_id,
    panel_id,
    version,
    LEFT(content::text, 30) || '...' as content_preview
FROM document_saves
ORDER BY created_at DESC
LIMIT 10;