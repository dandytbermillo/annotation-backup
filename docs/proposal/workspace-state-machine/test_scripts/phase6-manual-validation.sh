#!/bin/bash
# =============================================================================
# Phase 6 Manual Validation Script
# =============================================================================
#
# This script helps verify the manual test scenarios for Phase 6.
# Run each section and verify the expected behavior.
#
# Prerequisites:
# - Dev server running: npm run dev
# - Database running: docker compose up -d postgres
# - Browser open at http://localhost:3000

echo "=================================================="
echo "Phase 6 Manual Validation - Unified Durability Pipeline"
echo "=================================================="
echo ""

# Database connection
DB_URL="postgresql://postgres:postgres@localhost:5432/annotation_dev"

# Function to query debug logs
query_debug_logs() {
  local component=$1
  local action=$2
  local limit=${3:-10}

  echo "--- Debug Logs: $component / $action ---"
  PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c \
    "SELECT created_at, component, action, metadata::text
     FROM debug_logs
     WHERE component = '$component'
       AND ($action = '' OR action LIKE '%$action%')
     ORDER BY created_at DESC
     LIMIT $limit;"
}

# Function to query workspace state
query_workspaces() {
  echo "--- Current Workspace State ---"
  PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c \
    "SELECT id, name, revision, updated_at, note_count
     FROM note_workspaces
     ORDER BY updated_at DESC
     LIMIT 5;"
}

# Function to query components
query_components() {
  local workspace_id=$1
  echo "--- Components for Workspace: $workspace_id ---"
  PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c \
    "SELECT workspace_id, component_id, component_type, metadata::text
     FROM workspace_components
     WHERE workspace_id = '$workspace_id'
     ORDER BY created_at DESC
     LIMIT 10;"
}

echo "=================================================="
echo "TEST SCENARIO 1: Cold Restore (No Running Components)"
echo "=================================================="
echo ""
echo "Steps:"
echo "1. Open a workspace with notes + panels + components"
echo "2. Add a timer component (don't start it)"
echo "3. Close the browser completely"
echo "4. Reopen the app and navigate to the same workspace"
echo ""
echo "Expected:"
echo "- All notes and panels restored"
echo "- Timer component restored with correct state"
echo "- Timer NOT running (isRunning: false)"
echo ""
echo "Verify with:"
echo "  query_debug_logs 'NoteWorkspace' 'hydrate'"
echo "  query_debug_logs 'WorkspaceComponentStore' 'cold_restore'"
echo ""

echo "=================================================="
echo "TEST SCENARIO 2: Capacity Eviction While Offline (Dirty)"
echo "=================================================="
echo ""
echo "Steps:"
echo "1. Open 4+ workspaces to fill capacity"
echo "2. Make a change in workspace #1 (dirty state)"
echo "3. Go offline (Network tab > Offline)"
echo "4. Try to open workspace #5"
echo ""
echo "Expected:"
echo "- Eviction attempt for dirty workspace should BLOCK"
echo "- UI shows 'Workspace has unsaved changes' notification"
echo "- Dirty workspace state NOT destroyed"
echo ""
echo "Verify with:"
echo "  query_debug_logs 'NoteWorkspaceRuntime' 'eviction'"
echo "  query_debug_logs 'NoteWorkspaceRuntime' 'blocked'"
echo ""

echo "=================================================="
echo "TEST SCENARIO 3: Entry Switching (No Toast Spam)"
echo "=================================================="
echo ""
echo "Steps:"
echo "1. Open annotation entry with a workspace"
echo "2. Navigate to home entry"
echo "3. Navigate back to annotation entry"
echo "4. Repeat 3-4 times"
echo ""
echo "Expected:"
echo "- NO 'Workspace save failed' toasts"
echo "- NO REVISION_MISMATCH errors in console"
echo "- Workspace state preserved correctly"
echo ""
echo "Verify with:"
echo "  query_debug_logs 'NoteWorkspace' 'save_schedule_blocked'"
echo "  query_debug_logs 'NoteWorkspace' 'persist_by_id'"
echo "  # Should see 'save_schedule_blocked_lifecycle' entries"
echo ""

echo "=================================================="
echo "TEST SCENARIO 4: Transient Mismatch Protection"
echo "=================================================="
echo ""
echo "Steps:"
echo "1. Open a workspace with multiple notes/panels"
echo "2. Force a cold restore (clear local state, refresh)"
echo "3. Observe hydration logs"
echo ""
echo "Expected:"
echo "- NO 'persist_blocked_inconsistent_open_notes' without deferring"
echo "- If inconsistent state detected, should defer/retry"
echo "- After max retries, should repair from panels"
echo "- State remains intact"
echo ""
echo "Verify with:"
echo "  query_debug_logs 'NoteWorkspace' 'inconsistent'"
echo "  query_debug_logs 'NoteWorkspace' 'repair'"
echo ""

echo "=================================================="
echo "Helper Functions"
echo "=================================================="
echo ""
echo "Available functions (source this script first):"
echo "  query_debug_logs <component> <action> [limit]"
echo "  query_workspaces"
echo "  query_components <workspace_id>"
echo ""
echo "Example:"
echo "  source docs/proposal/workspace-state-machine/test_scripts/phase6-manual-validation.sh"
echo "  query_debug_logs 'NoteWorkspace' 'lifecycle'"
echo ""
