#!/bin/bash
#
# Quick Links Flow Verification Script
# Tests the Entry-Workspace hierarchy integration
#
# Prerequisites:
# - Postgres running (docker compose up postgres)
# - Dev server running (npm run dev)
#
# Run: ./verify-quick-links-flow.sh

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "===== Quick Links Flow Verification ====="
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Workspace search API (all workspaces)
echo "Test 1: Workspace search API (all workspaces)"
echo "GET /api/dashboard/workspaces/search"
response=$(curl -s "$BASE_URL/api/dashboard/workspaces/search")
echo "$response" | head -c 500
echo ""
workspace_count=$(echo "$response" | grep -o '"id"' | wc -l)
echo "Found $workspace_count workspaces"
echo ""

# Test 2: Workspace search API (filtered by entry)
echo "Test 2: Workspace search API (filtered by entry)"
# Get first entry ID from the workspaces response
entry_id=$(echo "$response" | grep -o '"entryId":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$entry_id" ]; then
  echo "Using entry ID: $entry_id"
  echo "GET /api/dashboard/workspaces/search?entryId=$entry_id"
  filtered_response=$(curl -s "$BASE_URL/api/dashboard/workspaces/search?entryId=$entry_id")
  echo "$filtered_response" | head -c 500
  echo ""
  filtered_count=$(echo "$filtered_response" | grep -o '"id"' | wc -l)
  echo "Found $filtered_count workspaces for entry $entry_id"
else
  echo "SKIP: No entry ID found in workspaces"
fi
echo ""

# Test 3: Entries API
echo "Test 3: Entries API"
echo "GET /api/entries"
entries_response=$(curl -s "$BASE_URL/api/entries?limit=5")
echo "$entries_response" | head -c 500
echo ""
entry_count=$(echo "$entries_response" | grep -o '"id"' | wc -l)
echo "Found $entry_count entries"
echo ""

# Test 4: Entry workspaces API
echo "Test 4: Entry workspaces API (if entry exists)"
if [ -n "$entry_id" ]; then
  echo "GET /api/entries/$entry_id/workspaces"
  entry_ws_response=$(curl -s "$BASE_URL/api/entries/$entry_id/workspaces")
  echo "$entry_ws_response" | head -c 500
  echo ""
else
  echo "SKIP: No entry ID available"
fi
echo ""

# Summary
echo "===== Summary ====="
echo "API Endpoints Tested:"
echo "  [x] GET /api/dashboard/workspaces/search - All workspaces"
echo "  [x] GET /api/dashboard/workspaces/search?entryId=X - Filtered by entry"
echo "  [x] GET /api/entries - List entries"
echo "  [x] GET /api/entries/:id/workspaces - Entry workspaces"
echo ""
echo "Manual Testing Required:"
echo "  [ ] Click Quick Link in dashboard → navigates to correct entry/workspace"
echo "  [ ] Entry Navigator shows active entry highlighted"
echo "  [ ] Workspace tabs show only workspaces for current entry"
echo "  [ ] Cmd+K picker defaults to current entry filter"
echo "  [ ] Toggle 'All Entries' in Cmd+K picker shows all workspaces"
echo ""
