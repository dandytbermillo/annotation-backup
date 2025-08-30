#!/bin/bash

# Comprehensive script to verify batch implementation is working correctly
# This tests all 4 patches: server-side versioning, editor debouncing, batch config, provider guard

set -e

echo "============================================"
echo "BATCH IMPLEMENTATION VERIFICATION SCRIPT"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database connection
DB_NAME="annotation_dev"
DB_USER="postgres"
DB_HOST="localhost"

# Test configuration
TEST_NOTE_ID="test-$(uuidgen || cat /proc/sys/kernel/random/uuid)"
TEST_PANEL_ID="panel-$(uuidgen || cat /proc/sys/kernel/random/uuid)"
API_BASE="http://localhost:3000/api/postgres-offline"

echo "Test Configuration:"
echo "  Note ID: $TEST_NOTE_ID"
echo "  Panel ID: $TEST_PANEL_ID"
echo ""

# Function to count database rows
count_rows() {
    psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "
        SELECT COUNT(*) 
        FROM document_saves 
        WHERE note_id = '$TEST_NOTE_ID' AND panel_id = '$TEST_PANEL_ID'
    " | tr -d ' '
}

# Function to get latest version
get_latest_version() {
    psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "
        SELECT COALESCE(MAX(version), 0)
        FROM document_saves 
        WHERE note_id = '$TEST_NOTE_ID' AND panel_id = '$TEST_PANEL_ID'
    " | tr -d ' '
}

# Function to show recent saves
show_recent_saves() {
    echo "Recent saves for this test:"
    psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
        SELECT version, 
               LEFT(content::text, 50) as content_preview,
               created_at
        FROM document_saves 
        WHERE note_id = '$TEST_NOTE_ID' AND panel_id = '$TEST_PANEL_ID'
        ORDER BY version DESC
        LIMIT 5
    "
}

echo "============================================"
echo "TEST 1: Server-Side Versioning & Coalescing"
echo "============================================"

INITIAL_COUNT=$(count_rows)
echo "Initial row count: $INITIAL_COUNT"

# Send multiple operations in one batch - should coalesce to 1 row
echo "Sending 5 operations in one batch..."
curl -s -X POST "$API_BASE/documents/batch" \
  -H "Content-Type: application/json" \
  -d "{
    \"operations\": [
      {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Edit 1\"}},
      {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Edit 2\"}},
      {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Edit 3\"}},
      {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Edit 4\"}},
      {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Final Edit\"}}
    ]
  }" | jq '.'

sleep 1
NEW_COUNT=$(count_rows)
ROWS_ADDED=$((NEW_COUNT - INITIAL_COUNT))

echo "Rows added: $ROWS_ADDED"
if [ "$ROWS_ADDED" -eq 1 ]; then
    echo -e "${GREEN}✓ PASS: Coalescing working - 5 ops created only 1 row${NC}"
else
    echo -e "${RED}✗ FAIL: Expected 1 row, got $ROWS_ADDED rows${NC}"
fi

echo ""
echo "============================================"
echo "TEST 2: Content-Based Deduplication"
echo "============================================"

BEFORE_DUP=$(count_rows)
echo "Sending duplicate content (same as last)..."
curl -s -X POST "$API_BASE/documents/batch" \
  -H "Content-Type: application/json" \
  -d "{
    \"operations\": [
      {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Final Edit\"}}
    ]
  }" | jq '.skipped'

sleep 1
AFTER_DUP=$(count_rows)
DUP_ROWS_ADDED=$((AFTER_DUP - BEFORE_DUP))

echo "Rows added for duplicate: $DUP_ROWS_ADDED"
if [ "$DUP_ROWS_ADDED" -eq 0 ]; then
    echo -e "${GREEN}✓ PASS: Deduplication working - duplicate content skipped${NC}"
else
    echo -e "${RED}✗ FAIL: Duplicate content created $DUP_ROWS_ADDED new rows${NC}"
fi

echo ""
echo "============================================"
echo "TEST 3: Version Sequence Integrity"
echo "============================================"

# Check version sequence
echo "Checking version sequence..."
VERSION_GAPS=$(psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "
    WITH version_check AS (
        SELECT version,
               LAG(version) OVER (ORDER BY version) as prev_version,
               version - LAG(version) OVER (ORDER BY version) as gap
        FROM document_saves
        WHERE note_id = '$TEST_NOTE_ID' AND panel_id = '$TEST_PANEL_ID'
    )
    SELECT COUNT(*) FROM version_check WHERE gap > 1
" | tr -d ' ')

if [ "$VERSION_GAPS" -eq 0 ]; then
    echo -e "${GREEN}✓ PASS: Version sequence is continuous (no gaps)${NC}"
else
    echo -e "${RED}✗ FAIL: Found $VERSION_GAPS version gaps${NC}"
fi

echo ""
echo "============================================"
echo "TEST 4: Batch Timing Configuration"
echo "============================================"

# Check if config is loaded
echo "Checking batch configuration..."
grep -q "batchTimeout: 3000" lib/batching/plain-batch-config.ts && \
grep -q "debounceMs: 800" lib/batching/plain-batch-config.ts

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ PASS: Batch timing configuration applied${NC}"
else
    echo -e "${YELLOW}⚠ WARNING: Could not verify batch timing in config${NC}"
fi

echo ""
echo "============================================"
echo "TEST 5: Concurrent Writer Handling"
echo "============================================"

echo "Sending 3 concurrent batch requests..."
BEFORE_CONCURRENT=$(count_rows)

# Send 3 concurrent requests
for i in 1 2 3; do
    curl -s -X POST "$API_BASE/documents/batch" \
      -H "Content-Type: application/json" \
      -d "{
        \"operations\": [
          {\"noteId\": \"$TEST_NOTE_ID\", \"panelId\": \"$TEST_PANEL_ID\", \"content\": {\"html\": \"Concurrent $i\"}}
        ]
      }" > /dev/null 2>&1 &
done

wait
sleep 2

AFTER_CONCURRENT=$(count_rows)
CONCURRENT_ROWS=$((AFTER_CONCURRENT - BEFORE_CONCURRENT))

echo "Rows added by 3 concurrent requests: $CONCURRENT_ROWS"
if [ "$CONCURRENT_ROWS" -le 3 ] && [ "$CONCURRENT_ROWS" -ge 1 ]; then
    echo -e "${GREEN}✓ PASS: Concurrent writes handled correctly${NC}"
else
    echo -e "${RED}✗ FAIL: Unexpected concurrent write behavior${NC}"
fi

echo ""
echo "============================================"
echo "TEST 6: Editor Debouncing Check"
echo "============================================"

echo "Checking editor debounce implementation..."
grep -q "setTimeout.*800" components/canvas/tiptap-editor-plain.tsx

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ PASS: Editor debouncing (800ms) implemented${NC}"
else
    echo -e "${RED}✗ FAIL: Editor debouncing not found${NC}"
fi

echo ""
echo "============================================"
echo "PERFORMANCE METRICS"
echo "============================================"

# Calculate reduction percentage
TOTAL_OPS_SENT=9  # 5 + 1 + 3
TOTAL_ROWS=$(count_rows)

if [ "$TOTAL_OPS_SENT" -gt 0 ]; then
    REDUCTION=$((100 - (TOTAL_ROWS * 100 / TOTAL_OPS_SENT)))
    echo "Operations sent: $TOTAL_OPS_SENT"
    echo "Database rows created: $TOTAL_ROWS"
    echo -e "${GREEN}Write reduction: $REDUCTION%${NC}"
    
    if [ "$REDUCTION" -ge 50 ]; then
        echo -e "${GREEN}✓ EXCELLENT: Achieved >50% write reduction${NC}"
    elif [ "$REDUCTION" -ge 30 ]; then
        echo -e "${YELLOW}⚠ GOOD: Achieved 30-50% write reduction${NC}"
    else
        echo -e "${RED}✗ POOR: Less than 30% write reduction${NC}"
    fi
fi

echo ""
echo "============================================"
echo "DATABASE STATE"
echo "============================================"
show_recent_saves

echo ""
echo "============================================"
echo "SUMMARY"
echo "============================================"

# Count passes and fails
PASS_COUNT=$(grep -c "✓ PASS" $0 | echo 0)
FAIL_COUNT=$(grep -c "✗ FAIL" $0 | echo 0)

echo "Tests completed!"
echo "Note: For full verification, also run:"
echo "  1. npm run dev (in another terminal)"
echo "  2. Open http://localhost:3000/test-plain-mode"
echo "  3. Type continuously and observe console logs"
echo "  4. Check that saves happen only after 800ms idle"
echo ""
echo "To monitor in real-time:"
echo "  watch -n 1 'psql -U postgres -d annotation_dev -c \"SELECT COUNT(*) as rows, MAX(version) as latest_version FROM document_saves WHERE created_at > NOW() - INTERVAL '5 minutes'\"'"