-- Debug Queries for Branch Panel Reopen Issue
-- These queries were used to diagnose and verify the fix

-- =============================================================================
-- PANEL CLOSE LIFECYCLE
-- =============================================================================

-- Check panel close events
SELECT
  created_at,
  action,
  metadata->>'panelId' as panel_id,
  metadata->>'panelNoteId' as panel_note,
  metadata->>'currentNoteId' as current_note,
  metadata->>'beforeCount' as before_count,
  metadata->>'afterCount' as after_count,
  metadata->>'removedCount' as removed_count,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action IN ('panel_close_start', 'panel_removed_from_items',
                 'panel_close_items_updated', 'panel_removed_from_state')
ORDER BY created_at DESC
LIMIT 20;

-- =============================================================================
-- PANEL CREATE LIFECYCLE
-- =============================================================================

-- Check panel create events (especially early returns)
SELECT
  created_at,
  action,
  metadata->>'panelId' as panel_id,
  metadata->>'targetNoteId' as target_note,
  metadata->>'currentCanvasItemsCount' as items_count,
  metadata->>'reason' as reason,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action IN ('handle_create_panel', 'create_panel_check_existing',
                 'create_panel_early_return', 'create_panel_proceeding',
                 'panel_already_exists')
ORDER BY created_at DESC
LIMIT 30;

-- =============================================================================
-- VERIFY FIX IS WORKING
-- =============================================================================

-- After closing a panel, you should see 'panel_removed_from_state' logs
SELECT
  created_at,
  metadata->>'panelId' as panel_id,
  metadata->>'noteId' as note_id,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action='panel_removed_from_state'
ORDER BY created_at DESC
LIMIT 10;

-- After reopening, you should see 'create_panel_proceeding' (NOT early_return)
SELECT
  created_at,
  metadata->>'panelId' as panel_id,
  metadata->>'targetNoteId' as note_id,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action IN ('create_panel_early_return', 'create_panel_proceeding')
ORDER BY created_at DESC
LIMIT 10;

-- =============================================================================
-- FULL PANEL LIFECYCLE TRACE
-- =============================================================================

-- Trace a specific panel through close and reopen
-- Replace 'YOUR_PANEL_ID' with actual panel ID
SELECT
  created_at,
  component,
  action,
  metadata->>'panelId' as panel_id,
  metadata->>'beforeCount' as before,
  metadata->>'afterCount' as after,
  content_preview
FROM debug_logs
WHERE metadata->>'panelId' = 'YOUR_PANEL_ID'
  AND component IN ('AnnotationCanvas', 'BranchItem')
ORDER BY created_at DESC
LIMIT 50;

-- =============================================================================
-- BRANCH ITEM EVENTS
-- =============================================================================

-- Check if branch data loading is working correctly
SELECT
  created_at,
  action,
  metadata->>'branchId' as branch_id,
  metadata->>'noteId' as note_id,
  metadata->>'branchStoreKey' as store_key,
  content_preview
FROM debug_logs
WHERE component='BranchItem'
  AND action IN ('loading_missing_branch_data', 'branch_data_loaded',
                 'branch_not_found_in_api', 'branch_data_load_failed')
ORDER BY created_at DESC
LIMIT 20;

-- =============================================================================
-- COMBINED VIEW: Close + Reopen Sequence
-- =============================================================================

-- Shows the complete sequence for debugging
SELECT
  created_at,
  component,
  action,
  metadata->>'panelId' as panel_id,
  CASE
    WHEN action LIKE '%close%' THEN '🔴 CLOSE'
    WHEN action LIKE '%create%' THEN '🟢 CREATE'
    WHEN action LIKE '%removed%' THEN '🗑️ REMOVE'
    ELSE '⚪ OTHER'
  END as event_type,
  content_preview
FROM debug_logs
WHERE component IN ('AnnotationCanvas', 'BranchItem')
  AND (
    action IN ('panel_close_start', 'panel_removed_from_items',
               'panel_close_items_updated', 'panel_removed_from_state',
               'handle_create_panel', 'create_panel_check_existing',
               'create_panel_early_return', 'create_panel_proceeding')
  )
ORDER BY created_at DESC
LIMIT 50;

-- =============================================================================
-- DIAGNOSTIC: Find Stuck Panels
-- =============================================================================

-- If panels are still not reopening, this query helps find which panels
-- might still be stuck in state.panels but missing from canvasItems
-- (Note: This requires console.log inspection, not directly queryable)

-- Instead, check the debug logs for panels that show early_return
SELECT
  created_at,
  metadata->>'panelId' as stuck_panel,
  metadata->>'reason' as why_stuck,
  content_preview
FROM debug_logs
WHERE component='AnnotationCanvas'
  AND action='create_panel_early_return'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- =============================================================================
-- VERIFICATION: Panel State Sync Check
-- =============================================================================

-- After the fix, every panel_close_start should be followed by:
-- 1. panel_removed_from_items
-- 2. panel_close_items_updated
-- 3. panel_removed_from_state  ← THE FIX

-- Check for any panel closes that DON'T have corresponding state removal
SELECT
  close_logs.created_at as close_time,
  close_logs.metadata->>'panelId' as panel_id,
  state_logs.created_at as state_removal_time,
  CASE
    WHEN state_logs.created_at IS NULL THEN '❌ MISSING STATE REMOVAL'
    ELSE '✅ STATE REMOVED'
  END as fix_status
FROM
  (SELECT * FROM debug_logs
   WHERE action='panel_close_start'
   AND created_at > NOW() - INTERVAL '1 hour') close_logs
LEFT JOIN
  (SELECT * FROM debug_logs
   WHERE action='panel_removed_from_state'
   AND created_at > NOW() - INTERVAL '1 hour') state_logs
ON close_logs.metadata->>'panelId' = state_logs.metadata->>'panelId'
  AND state_logs.created_at BETWEEN close_logs.created_at AND close_logs.created_at + INTERVAL '1 second'
ORDER BY close_logs.created_at DESC;
