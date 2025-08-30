-- SQL Validation Snippets for Offline Sync Foundation
-- Run these queries to validate the implementation
-- Database: annotation_dev

-- ============================================
-- 1. SCHEMA VALIDATION
-- ============================================

-- Check if all required columns exist in offline_queue
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'offline_queue'
    AND column_name IN (
        'idempotency_key', 'priority', 'expires_at', 
        'depends_on', 'origin_device_id', 'schema_version'
    )
ORDER BY ordinal_position;

-- Check if offline_dead_letter exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'offline_dead_letter'
) as dead_letter_exists;

-- Check FTS columns in document_saves
SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'document_saves'
    AND column_name IN ('document_text', 'search_vector');

-- Check if pm_extract_text function exists
SELECT EXISTS (
    SELECT FROM pg_proc
    WHERE proname = 'pm_extract_text'
) as pm_extract_function_exists;

-- ============================================
-- 2. QUEUE STATUS MONITORING
-- ============================================

-- Current queue status overview
SELECT 
    status,
    COUNT(*) as count,
    MIN(created_at) as oldest,
    MAX(created_at) as newest,
    AVG(retry_count) as avg_retries
FROM offline_queue
GROUP BY status
ORDER BY status;

-- Operations by priority
SELECT 
    priority,
    COUNT(*) as count,
    status
FROM offline_queue
WHERE status = 'pending'
GROUP BY priority, status
ORDER BY priority DESC;

-- Check for expired operations
SELECT 
    id,
    entity_id,
    type,
    expires_at,
    NOW() - expires_at as expired_duration
FROM offline_queue
WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW()
LIMIT 10;

-- Operations with dependencies
SELECT 
    id,
    entity_id,
    depends_on,
    status
FROM offline_queue
WHERE depends_on IS NOT NULL
    AND array_length(depends_on, 1) > 0
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 3. IDEMPOTENCY VALIDATION
-- ============================================

-- Check for duplicate idempotency keys (should be empty)
SELECT 
    idempotency_key,
    COUNT(*) as duplicates
FROM offline_queue
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- Recent operations with idempotency keys
SELECT 
    id,
    idempotency_key,
    entity_id,
    type,
    created_at
FROM offline_queue
WHERE idempotency_key IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 4. DEAD LETTER QUEUE
-- ============================================

-- Dead letter queue statistics
SELECT 
    COUNT(*) as total_failed,
    COUNT(DISTINCT entity_id) as unique_entities,
    AVG(retry_count) as avg_retries,
    MIN(failed_at) as oldest_failure,
    MAX(failed_at) as recent_failure
FROM offline_dead_letter
WHERE archived = false;

-- Most common failure reasons
SELECT 
    error_message,
    COUNT(*) as occurrences
FROM offline_dead_letter
WHERE archived = false
GROUP BY error_message
ORDER BY occurrences DESC
LIMIT 10;

-- Operations ready for retry from dead letter
SELECT 
    id,
    entity_id,
    type,
    retry_count,
    error_message,
    failed_at
FROM offline_dead_letter
WHERE archived = false
    AND retry_count < 5
ORDER BY failed_at DESC
LIMIT 10;

-- ============================================
-- 5. FULL-TEXT SEARCH VALIDATION
-- ============================================

-- Test ProseMirror text extraction
SELECT 
    pm_extract_text('{
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Hello "},
                    {"type": "text", "text": "World", "marks": [{"type": "bold"}]}
                ]
            }
        ]
    }'::jsonb) as extracted_text;

-- Check FTS vectors are being created
SELECT 
    COUNT(*) as total_documents,
    COUNT(search_vector) as documents_with_vector,
    COUNT(*) - COUNT(search_vector) as missing_vectors
FROM document_saves;

-- Sample FTS search
SELECT 
    panel_id,
    ts_headline(document_text, query) as highlighted,
    ts_rank(search_vector, query) as rank
FROM document_saves,
    to_tsquery('english', 'test & annotation') query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 5;

-- ============================================
-- 6. VERSION HISTORY
-- ============================================

-- Documents with most versions
SELECT 
    panel_id,
    COUNT(*) as version_count,
    MIN(version) as first_version,
    MAX(version) as latest_version,
    MAX(updated_at) - MIN(updated_at) as time_span
FROM document_saves
GROUP BY panel_id
HAVING COUNT(*) > 1
ORDER BY version_count DESC
LIMIT 10;

-- Recent version changes
SELECT 
    panel_id,
    version,
    LENGTH(content::text) as content_size,
    updated_at
FROM document_saves
WHERE updated_at > NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC
LIMIT 10;

-- ============================================
-- 7. CONFLICT DETECTION
-- ============================================

-- Check for potential conflicts (saves within 5 seconds)
WITH recent_saves AS (
    SELECT 
        panel_id,
        version,
        updated_at,
        LAG(updated_at) OVER (PARTITION BY panel_id ORDER BY version) as prev_updated
    FROM document_saves
    WHERE updated_at > NOW() - INTERVAL '1 day'
)
SELECT 
    panel_id,
    version,
    updated_at,
    prev_updated,
    updated_at - prev_updated as time_diff
FROM recent_saves
WHERE prev_updated IS NOT NULL
    AND updated_at - prev_updated < INTERVAL '5 seconds'
ORDER BY updated_at DESC;

-- Documents with base_version tracking
SELECT 
    panel_id,
    version,
    base_version,
    base_hash,
    updated_at
FROM document_saves
WHERE base_version IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;

-- ============================================
-- 8. PERFORMANCE METRICS
-- ============================================

-- Queue processing performance
SELECT 
    DATE_TRUNC('hour', processed_at) as hour,
    COUNT(*) as operations_processed,
    AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_time_seconds
FROM offline_queue
WHERE status = 'completed'
    AND processed_at IS NOT NULL
GROUP BY DATE_TRUNC('hour', processed_at)
ORDER BY hour DESC
LIMIT 24;

-- Index usage statistics
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
    AND tablename IN ('offline_queue', 'document_saves', 'offline_dead_letter')
ORDER BY idx_scan DESC;

-- Table sizes
SELECT 
    relname as table_name,
    pg_size_pretty(pg_total_relation_size(relid)) as total_size,
    pg_size_pretty(pg_relation_size(relid)) as table_size,
    pg_size_pretty(pg_indexes_size(relid)) as indexes_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
    AND relname IN ('offline_queue', 'document_saves', 'offline_dead_letter')
ORDER BY pg_total_relation_size(relid) DESC;

-- ============================================
-- 9. DATA INTEGRITY CHECKS
-- ============================================

-- Check for orphaned queue entries
SELECT 
    oq.id,
    oq.entity_id,
    oq.table_name,
    oq.type
FROM offline_queue oq
LEFT JOIN notes n ON oq.entity_id = n.id::text AND oq.table_name = 'notes'
LEFT JOIN annotations a ON oq.entity_id = a.id::text AND oq.table_name = 'annotations'
LEFT JOIN panels p ON oq.entity_id = p.id::text AND oq.table_name = 'panels'
WHERE oq.status = 'pending'
    AND n.id IS NULL 
    AND a.id IS NULL 
    AND p.id IS NULL
LIMIT 10;

-- Check for schema version mismatches
SELECT 
    schema_version,
    COUNT(*) as count
FROM offline_queue
GROUP BY schema_version
ORDER BY schema_version;

-- ============================================
-- 10. CLEANUP QUERIES
-- ============================================

-- Archive old completed operations (dry run - SELECT first)
SELECT COUNT(*) as operations_to_archive
FROM offline_queue
WHERE status = 'completed'
    AND processed_at < NOW() - INTERVAL '7 days';

-- Archive old dead letter entries (dry run)
SELECT COUNT(*) as dead_letter_to_archive
FROM offline_dead_letter
WHERE archived = false
    AND failed_at < NOW() - INTERVAL '30 days';

-- Identify candidates for FTS vector rebuild
SELECT 
    panel_id,
    version,
    document_text IS NOT NULL as has_text,
    search_vector IS NULL as missing_vector
FROM document_saves
WHERE document_text IS NOT NULL
    AND search_vector IS NULL
LIMIT 10;

-- ============================================
-- 11. USEFUL DIAGNOSTIC QUERIES
-- ============================================

-- Recent queue activity timeline
SELECT 
    DATE_TRUNC('minute', created_at) as minute,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'processing') as processing,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM offline_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY DATE_TRUNC('minute', created_at)
ORDER BY minute DESC;

-- Connection pool status (if using pg_stat_activity)
SELECT 
    state,
    COUNT(*) as connections,
    MAX(NOW() - state_change) as max_idle_time
FROM pg_stat_activity
WHERE datname = 'annotation_dev'
GROUP BY state;

-- Lock monitoring
SELECT 
    locktype,
    relation::regclass as table_name,
    mode,
    granted,
    COUNT(*) as lock_count
FROM pg_locks
WHERE relation IN (
    'offline_queue'::regclass,
    'document_saves'::regclass,
    'offline_dead_letter'::regclass
)
GROUP BY locktype, relation, mode, granted
ORDER BY granted, lock_count DESC;