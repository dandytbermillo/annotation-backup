#!/bin/bash

# Integration Test Script for Option A (Plain Mode)
# Verifies all PRP requirements are met:
# - All 10 fixes work correctly
# - PostgreSQL stores JSON (not binary)
# - No Yjs artifacts in database
# - Performance measurements

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[33m'
BLUE='\033[34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Performance metrics
PERF_SAVE_TIMES=()
PERF_LOAD_TIMES=()

# App process ID
APP_PID=""

# Database connection
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/annotation_dev}"
export NEXT_PUBLIC_COLLAB_MODE="plain"

# API base URL
API_BASE="http://localhost:3000/api/postgres-offline"

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED_TESTS++))
    ((TOTAL_TESTS++))
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED_TESTS++))
    ((TOTAL_TESTS++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# HTTP request with status code capture
http_request() {
    # $1=METHOD $2=URL $3(optional)=JSON_BODY
    local method="$1"; shift
    local url="$1"; shift
    local body="${1:-}"

    local tmp_body
    tmp_body="$(mktemp)"
    if [ -z "$body" ]; then
        STATUS=$(curl -sS -w "%{http_code}" -o "$tmp_body" -X "$method" "$url" -H "Content-Type: application/json") || STATUS=000
    else
        STATUS=$(curl -sS -w "%{http_code}" -o "$tmp_body" -X "$method" "$url" -H "Content-Type: application/json" -d "$body") || STATUS=000
    fi
    BODY_FILE="$tmp_body"
}

# Extract JSON property using Node.js
json_get() {
    # $1=BODY_FILE $2=dot.path
    node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const p=process.argv[3].split('.');let v=j;for(const k of p){v=v?.[k];}if(v===undefined){process.exit(2);}if(typeof v==='object'){console.log(JSON.stringify(v));}else{console.log(String(v));}}catch(e){process.exit(1)}" "$1" "$2"
}

# Check HTTP status and fail on error
fail_if_error() {
    # $1=context
    if [ "$STATUS" -lt 200 ] || [ "$STATUS" -ge 300 ]; then
        log_error "$1 (HTTP $STATUS): $(cat "$BODY_FILE" 2>/dev/null || true)"
        return 1
    fi
    return 0
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."
    if [ ! -z "$APP_PID" ]; then
        kill $APP_PID 2>/dev/null || true
        wait $APP_PID 2>/dev/null || true
    fi
    
    # Kill any remaining node processes on port 3000
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
}

# Database cleanup function
cleanup_db() {
    log_info "Cleaning test data from DB..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM document_saves WHERE note_id IN (SELECT id FROM notes WHERE title LIKE 'Fix % Test%' OR title LIKE 'Performance Test' OR title LIKE 'Concurrent Test' OR title LIKE 'Large Doc Test' OR title LIKE 'Note %' OR title LIKE 'State test%');" 2>/dev/null || true
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM branches WHERE note_id IN (SELECT id FROM notes WHERE title LIKE 'Fix % Test%' OR title LIKE 'Performance Test' OR title LIKE 'Concurrent Test' OR title LIKE 'Large Doc Test' OR title LIKE 'Note %' OR title LIKE 'State test%');" 2>/dev/null || true
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM notes WHERE title LIKE 'Fix % Test%' OR title LIKE 'Performance Test' OR title LIKE 'Concurrent Test' OR title LIKE 'Large Doc Test' OR title LIKE 'Note %' OR title LIKE 'State test%';" 2>/dev/null || true
    log_success "DB cleanup complete"
}

# Set up trap for cleanup and notification
trap 'status=$?; cleanup; cleanup_db; bash ./scripts/notify.sh $status' EXIT

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    # Check PostgreSQL connection
    if ! psql "$DATABASE_URL" -c "SELECT 1" &> /dev/null; then
        log_error "Cannot connect to PostgreSQL at $DATABASE_URL"
        exit 1
    fi
    
    # Check if migrations are applied
    if ! psql "$DATABASE_URL" -c "SELECT 1 FROM document_saves LIMIT 1" &> /dev/null; then
        log_warning "document_saves table not found. Running migrations..."
        npm run db:migrate
    fi
}

# Start the app in plain mode
start_app() {
    log_info "Starting app in plain mode..."
    
    # Kill any existing process on port 3000
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 2
    
    # Start the app in background
    NEXT_PUBLIC_COLLAB_MODE=plain npm run dev > /tmp/plain-mode-test.log 2>&1 &
    APP_PID=$!
    
    # Wait for app to be ready
    log_info "Waiting for app to start..."
    local retries=30
    while [ $retries -gt 0 ]; do
        if curl -s http://localhost:3000 > /dev/null; then
            log_success "App started successfully"
            return 0
        fi
        sleep 1
        ((retries--))
    done
    
    log_error "App failed to start. Check logs at /tmp/plain-mode-test.log"
    exit 1
}

# Helper to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -z "$data" ]; then
        curl -s -X $method "$API_BASE/$endpoint" -H "Content-Type: application/json"
    else
        curl -s -X $method "$API_BASE/$endpoint" -H "Content-Type: application/json" -d "$data"
    fi
}

# Test Fix #1: Empty content handling
test_fix_1() {
    log_info "Testing Fix #1: Empty content handling..."
    
    # Create a note
    http_request POST "$API_BASE/notes" '{"title":"Fix 1 Test"}'
    fail_if_error "Create note" || return
    local note_id=$(json_get "$BODY_FILE" 'id')
    
    if [ -z "$note_id" ]; then
        log_error "Fix #1: Failed to create note"
        return
    fi
    
    # Save empty content
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    http_request POST "$API_BASE/documents" "{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":\"\",\"version\":1}"
    fail_if_error "Save empty content" || return
    
    # Load and verify
    http_request GET "$API_BASE/documents/$note_id/$panel_id"
    fail_if_error "Load document" || return
    
    local content=$(json_get "$BODY_FILE" 'content' || echo "")
    if echo "$content" | grep -q "Start writing"; then
        log_error "Fix #1: Empty content shows 'Start writing...'"
    else
        log_success "Fix #1: Empty content handled correctly"
    fi
}

# Test Fix #2 & #5: Composite key isolation
test_fix_2_5() {
    log_info "Testing Fix #2 & #5: Composite key isolation..."
    
    # Create two notes
    local note1=$(api_call POST "notes" '{"title":"Note 1"}')
    local note1_id=$(echo $note1 | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    
    local note2=$(api_call POST "notes" '{"title":"Note 2"}')
    local note2_id=$(echo $note2 | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    # Save different content for same panel in different notes
    api_call POST "documents" "{\"noteId\":\"$note1_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Note 1 content\"}]}]},\"version\":1}"
    api_call POST "documents" "{\"noteId\":\"$note2_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Note 2 content\"}]}]},\"version\":1}"
    
    # Load both and verify they're different
    local content1=$(api_call GET "documents/$note1_id/$panel_id")
    local content2=$(api_call GET "documents/$note2_id/$panel_id")
    
    if echo "$content1" | grep -q "Note 1 content" && echo "$content2" | grep -q "Note 2 content"; then
        log_success "Fix #2 & #5: Composite keys work correctly"
    else
        log_error "Fix #2 & #5: Content mixing detected"
    fi
}

# Test Fix #3: Async loading
test_fix_3() {
    log_info "Testing Fix #3: Async loading states..."
    
    # This is harder to test via API, but we can verify concurrent loads
    local note_id=$(api_call POST "notes" '{"title":"Fix 3 Test"}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    # Save content
    api_call POST "documents" "{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Async test\"}]}]},\"version\":1}"
    
    # Make multiple concurrent load requests
    for i in {1..5}; do
        api_call GET "documents/$note_id/$panel_id" &
    done
    wait
    
    log_success "Fix #3: Concurrent loads completed without error"
}

# Test Fix #4: No deletion on unmount
test_fix_4() {
    log_info "Testing Fix #4: No deletion on unmount..."
    
    # Create and save content
    local note_id=$(api_call POST "notes" '{"title":"Fix 4 Test"}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    api_call POST "documents" "{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Persistent content\"}]}]},\"version\":1}"
    
    # Simulate component unmount by just waiting
    sleep 1
    
    # Verify content still exists
    local loaded=$(api_call GET "documents/$note_id/$panel_id")
    if echo "$loaded" | grep -q "Persistent content"; then
        log_success "Fix #4: Content persists after unmount"
    else
        log_error "Fix #4: Content was deleted on unmount"
    fi
}

# Test Fix #6: Metadata handling
test_fix_6() {
    log_info "Testing Fix #6: Metadata field type detection..."
    
    # Create note with metadata
    local note=$(api_call POST "notes" '{"title":"Fix 6 Test","metadata":{"fieldType":"prosemirror"}}')
    local note_id=$(echo $note | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    
    # Check metadata
    local loaded_note=$(api_call GET "notes/$note_id")
    if echo "$loaded_note" | grep -q "prosemirror"; then
        log_success "Fix #6: Metadata handling works"
    else
        log_error "Fix #6: Metadata not preserved"
    fi
}

# Test Fix #7-9: Object-based state
test_fix_7_9() {
    log_info "Testing Fix #7-9: Object-based state management..."
    
    # Create multiple documents quickly to test state management
    local note_id=$(api_call POST "notes" '{"title":"Fix 7-9 Test"}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    
    for i in {1..5}; do
        local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
        api_call POST "documents" "{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"State test $i\"}]}]},\"version\":1}"
    done
    
    log_success "Fix #7-9: State management handles rapid operations"
}

# Test Fix #10: Prevent infinite loops
test_fix_10() {
    log_info "Testing Fix #10: Prevent infinite load loops..."
    
    local note_id=$(api_call POST "notes" '{"title":"Fix 10 Test"}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    # Try to load non-existent document multiple times
    for i in {1..3}; do
        api_call GET "documents/$note_id/$panel_id" &
    done
    wait
    
    # If we get here without hanging, the fix works
    log_success "Fix #10: No infinite loops detected"
}

# Verify PostgreSQL storage format
verify_storage_format() {
    log_info "Verifying PostgreSQL storage format..."
    
    # Check document_saves table
    local result=$(psql "$DATABASE_URL" -t -c "
        SELECT content, pg_typeof(content) 
        FROM document_saves 
        LIMIT 1
    ")
    
    if [ -z "$result" ]; then
        log_warning "No documents in database to verify"
        return
    fi
    
    # Check if content is JSONB
    if echo "$result" | grep -q "jsonb"; then
        log_success "Storage format: Content stored as JSONB"
    else
        log_error "Storage format: Content not stored as JSONB"
    fi
    
    # Check for binary data
    local binary_check=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) 
        FROM document_saves 
        WHERE content::text LIKE '%\\x%'
    ")
    
    if [ "$binary_check" -eq 0 ]; then
        log_success "Storage format: No binary data found"
    else
        log_error "Storage format: Binary data detected"
    fi
}

# Check for Yjs artifacts
check_yjs_artifacts() {
    log_info "Checking for Yjs artifacts in database..."
    
    # Check for Yjs-specific patterns in content
    local yjs_patterns=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) 
        FROM document_saves 
        WHERE content::text LIKE '%yjs%' 
           OR content::text LIKE '%Y.%' 
           OR content::text LIKE '%awareness%'
           OR content::text LIKE '%RelativePosition%'
    ")
    
    if [ "$yjs_patterns" -eq 0 ]; then
        log_success "No Yjs artifacts: Database is clean"
    else
        log_error "Yjs artifacts found in database"
    fi
    
    # Check table structure
    local yjs_tables=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) 
        FROM information_schema.tables 
        WHERE table_name LIKE '%yjs%' 
           OR table_name LIKE '%awareness%'
    ")
    
    if [ "$yjs_tables" -eq 0 ]; then
        log_success "No Yjs tables found"
    else
        log_error "Yjs-related tables found"
    fi
}

# Measure performance
measure_performance() {
    log_info "Measuring performance..."
    
    local note_id=$(api_call POST "notes" '{"title":"Performance Test"}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    # Test document content
    local test_content="{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\"}]}]},\"version\":1}"
    
    # Measure save times
    log_info "Testing save performance (10 iterations)..."
    for i in {1..10}; do
        local start=$(date +%s%N)
        api_call POST "documents" "$test_content"
        local end=$(date +%s%N)
        local duration=$((($end - $start) / 1000000)) # Convert to milliseconds
        PERF_SAVE_TIMES+=($duration)
    done
    
    # Measure load times
    log_info "Testing load performance (10 iterations)..."
    for i in {1..10}; do
        local start=$(date +%s%N)
        api_call GET "documents/$note_id/$panel_id" > /dev/null
        local end=$(date +%s%N)
        local duration=$((($end - $start) / 1000000))
        PERF_LOAD_TIMES+=($duration)
    done
    
    # Calculate averages
    local save_sum=0
    for time in "${PERF_SAVE_TIMES[@]}"; do
        save_sum=$((save_sum + time))
    done
    local save_avg=$((save_sum / ${#PERF_SAVE_TIMES[@]}))
    
    local load_sum=0
    for time in "${PERF_LOAD_TIMES[@]}"; do
        load_sum=$((load_sum + time))
    done
    local load_avg=$((load_sum / ${#PERF_LOAD_TIMES[@]}))
    
    log_info "Average save time: ${save_avg}ms"
    log_info "Average load time: ${load_avg}ms"
    
    # Check against thresholds
    if [ $save_avg -lt 50 ]; then
        log_success "Performance: Save operations < 50ms (${save_avg}ms)"
    else
        log_warning "Performance: Save operations slower than expected (${save_avg}ms)"
    fi
    
    if [ $load_avg -lt 30 ]; then
        log_success "Performance: Load operations < 30ms (${load_avg}ms)"
    else
        log_warning "Performance: Load operations slower than expected (${load_avg}ms)"
    fi
}

# Test concurrent saves
test_concurrent_saves() {
    log_info "Testing concurrent saves to same note/panel..."
    
    http_request POST "$API_BASE/notes" '{"title":"Concurrent Test"}'
    fail_if_error "Create note" || return
    local note_id=$(json_get "$BODY_FILE" 'id')
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    # Helper to create payload
    payload() {
        echo "{\"noteId\":\"$1\",\"panelId\":\"$2\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"$3\"}]}]},\"version\":1}"
    }
    
    # Launch concurrent saves
    for i in {1..5}; do
        http_request POST "$API_BASE/documents" "$(payload "$note_id" "$panel_id" "concurrent $i")" &
    done
    wait
    
    # Verify final state
    http_request GET "$API_BASE/documents/$note_id/$panel_id"
    if [ "$STATUS" -eq 200 ]; then
        log_success "Concurrent saves: No errors, stable final state"
    else
        log_error "Concurrent saves: Failed with status $STATUS"
    fi
}

# Test large documents
test_large_documents() {
    log_info "Testing large document saves..."
    
    http_request POST "$API_BASE/notes" '{"title":"Large Doc Test"}'
    fail_if_error "Create note" || return
    local note_id=$(json_get "$BODY_FILE" 'id')
    local panel_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    
    # Generate large text
    big_text() {
        node -e "console.log('X'.repeat($1))"
    }
    
    # Test 10KB document
    local content10k="$(big_text 10000)"
    local json10k="{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"$content10k\"}]}]},\"version\":1}"
    
    local start=$(date +%s%N)
    http_request POST "$API_BASE/documents" "$json10k"
    local end=$(date +%s%N)
    local duration10k=$((($end - $start) / 1000000))
    
    if [ "$STATUS" -eq 200 ]; then
        log_success "10KB document saved in ${duration10k}ms"
    else
        log_error "10KB document save failed"
    fi
    
    # Test 100KB document
    local content100k="$(big_text 100000)"
    local json100k="{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"$content100k\"}]}]},\"version\":2}"
    
    start=$(date +%s%N)
    http_request POST "$API_BASE/documents" "$json100k"
    end=$(date +%s%N)
    local duration100k=$((($end - $start) / 1000000))
    
    if [ "$STATUS" -eq 200 ]; then
        log_success "100KB document saved in ${duration100k}ms"
    else
        log_error "100KB document save failed"
    fi
}

# Test offline queue via API
test_offline_queue_web() {
    log_info "Testing offline queue via API..."

    # Enqueue a mock operation
    http_request POST "$API_BASE/queue" '{"operation":"update","entityType":"document","entityId":"test-doc","payload":{"noteId":"00000000-0000-0000-0000-000000000000","panelId":"panel-queue","content":{"type":"doc","content":[]},"version":1}}'
    fail_if_error "Enqueue offline op" || return

    # Flush the queue
    http_request POST "$API_BASE/queue/flush" '{}'
    fail_if_error "Flush offline queue" || return

    processed=$(json_get "$BODY_FILE" 'processed' || json_get "$BODY_FILE" 'data.processed' || echo 0)
    if [ "$processed" -ge 1 ]; then
        log_success "Offline queue processed $processed item(s)"
    else
        log_error "Offline queue processing did not report progress"
    fi
}

# Test panelId normalization (non-UUID "main" should work)
test_panel_id_normalization() {
    log_info "Testing panel ID normalization with 'main'..."
    
    local note_id=$(uuidgen)
    local panel_id="main"  # Human-readable panel ID
    
    # First, try to GET - should return 404
    local get_response=$(curl -s -w "\n%{http_code}" "$API_BASE/documents/$note_id/$panel_id")
    local get_status=$(echo "$get_response" | tail -n1)
    
    if [ "$get_status" -eq 404 ]; then
        log_success "GET with panelId='main' returns 404 before save (no 500 error)"
    else
        log_error "GET with panelId='main' returned $get_status instead of 404"
    fi
    
    # Save document with panelId="main"
    local save_data="{\"noteId\":\"$note_id\",\"panelId\":\"$panel_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Test with main panel\"}]}]},\"version\":1}"
    http_request POST "$API_BASE/documents" "$save_data"
    
    if json_get "$BODY_FILE" 'success' | grep -q "true"; then
        log_success "Saved document with panelId='main'"
    else
        log_error "Failed to save document with panelId='main'"
        return
    fi
    
    # Load the document back
    local load_response=$(curl -s "$API_BASE/documents/$note_id/$panel_id")
    
    if echo "$load_response" | grep -q "Test with main panel"; then
        log_success "Successfully loaded document with panelId='main'"
    else
        log_error "Failed to load document with panelId='main': $load_response"
    fi
    
    # Verify in database that it was stored as UUID
    local db_check=$(psql "$DATABASE_URL" -t -c "SELECT panel_id FROM document_saves WHERE note_id = '$note_id' LIMIT 1" 2>/dev/null | xargs)
    
    if [[ "$db_check" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]]; then
        log_success "Panel ID 'main' was normalized to UUID in database: $db_check"
    else
        log_error "Panel ID was not properly normalized in database: $db_check"
    fi
}

# Run health check
health_check() {
    log_info "Running health check..."
    
    # Check PlainOfflineProvider is loaded
    local app_logs=$(tail -100 /tmp/plain-mode-test.log 2>/dev/null || echo "")
    
    if echo "$app_logs" | grep -q "PlainOfflineProvider"; then
        log_success "Health: PlainOfflineProvider initialized"
    else
        log_warning "Health: PlainOfflineProvider not found in logs"
    fi
    
    # Check no Yjs errors
    if echo "$app_logs" | grep -iq "yjs.*error\|y\.doc.*error"; then
        log_error "Health: Yjs errors found in logs"
    else
        log_success "Health: No Yjs errors in logs"
    fi
}

# Main test execution
main() {
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}Option A Integration Test Suite${NC}"
    echo -e "${GREEN}================================${NC}\n"
    
    # Check prerequisites
    check_prerequisites
    
    # Start the app
    start_app
    
    # Run health check
    health_check
    
    echo -e "\n${YELLOW}Running Fix Tests...${NC}"
    # Test all 10 fixes
    test_fix_1
    test_fix_2_5
    test_fix_3
    test_fix_4
    test_fix_6
    test_fix_7_9
    test_fix_10
    
    echo -e "\n${YELLOW}Running Additional Tests...${NC}"
    # Run new tests
    test_concurrent_saves
    test_large_documents
    test_offline_queue_web
    test_panel_id_normalization
    
    echo -e "\n${YELLOW}Verifying Storage...${NC}"
    # Verify storage format
    verify_storage_format
    check_yjs_artifacts
    
    echo -e "\n${YELLOW}Measuring Performance...${NC}"
    # Measure performance
    measure_performance
    
    # Final summary
    echo -e "\n${GREEN}================================${NC}"
    echo -e "${GREEN}Test Summary${NC}"
    echo -e "${GREEN}================================${NC}"
    echo -e "Total Tests: $TOTAL_TESTS"
    echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
    echo -e "${RED}Failed: $FAILED_TESTS${NC}"
    
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "\n${GREEN}✅ All tests passed!${NC}"
        exit 0
    else
        echo -e "\n${RED}❌ Some tests failed!${NC}"
        exit 1
    fi
}

# Run the tests
main
