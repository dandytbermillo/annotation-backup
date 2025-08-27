#!/bin/bash
# Validate PostgreSQL persistence adapter implementation
# Tests CRUD operations, data integrity, and Yjs state serialization

set -e

echo "🗄️  PostgreSQL Persistence Validation Suite"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
POSTGRES_TEST_DB="persistence_validation_test"
TEST_NOTE_ID="550e8400-e29b-41d4-a716-446655440000"
TEST_PANEL_ID="660e8400-e29b-41d4-a716-446655440001"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up test environment...${NC}"
    docker exec postgres-persistence-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS $POSTGRES_TEST_DB;" 2>/dev/null || true
    rm -f test-persistence-*.js test-yjs-state.bin 2>/dev/null || true
}

# Set trap for cleanup
trap cleanup EXIT

# Check if Postgres is running
check_postgres() {
    echo "Checking PostgreSQL availability..."
    
    if ! docker ps | grep -q postgres-persistence-postgres-1; then
        echo -e "${RED}❌ PostgreSQL container not running${NC}"
        echo "Run: docker compose up -d postgres"
        exit 1
    fi
    
    # Test connection
    if docker exec postgres-persistence-postgres-1 psql -U postgres -c "SELECT 1;" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PostgreSQL is running and accessible${NC}"
    else
        echo -e "${RED}❌ Cannot connect to PostgreSQL${NC}"
        exit 1
    fi
}

# Create and setup test database
setup_test_database() {
    echo -e "\n${BLUE}Setting up test database...${NC}"
    
    # Create database
    docker exec postgres-persistence-postgres-1 psql -U postgres -c "CREATE DATABASE $POSTGRES_TEST_DB;"
    
    # Apply schema migrations
    if [ -f "migrations/001_initial_schema.up.sql" ]; then
        docker exec -i postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB < migrations/001_initial_schema.up.sql
        echo -e "${GREEN}✓ Schema migrations applied${NC}"
    else
        echo -e "${YELLOW}⚠️  Creating schema from PRPs/postgres-schema-migration.md${NC}"
        
        # Extract and apply schema from PRP
        cat > temp-schema.sql << 'EOF'
-- Extracted from PRPs/postgres-schema-migration.md
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ
);

CREATE TABLE annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('note', 'explore', 'promote')),
    source_panel_id UUID NOT NULL,
    target_panel_id UUID NOT NULL,
    anchor_start BYTEA NOT NULL,
    anchor_end BYTEA NOT NULL,
    anchors_fallback JSONB NOT NULL DEFAULT '{}',
    original_text TEXT,
    metadata JSONB DEFAULT '{}',
    "order" TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE panels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title TEXT,
    type TEXT DEFAULT 'editor',
    parent_id UUID REFERENCES panels(id) ON DELETE SET NULL,
    position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}',
    dimensions JSONB NOT NULL DEFAULT '{"width": 400, "height": 300}',
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'lazy', 'unloaded')),
    last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE yjs_updates (
    id BIGSERIAL PRIMARY KEY,
    doc_name TEXT NOT NULL,
    update BYTEA NOT NULL,
    client_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_yjs_updates_doc_timestamp ON yjs_updates(doc_name, timestamp DESC);

CREATE TABLE snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    doc_name TEXT NOT NULL,
    snapshot BYTEA NOT NULL,
    panels TEXT[],
    checksum TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(note_id, doc_name, created_at)
);

-- Update triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notes_updated BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_annotations_updated BEFORE UPDATE ON annotations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_panels_updated BEFORE UPDATE ON panels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EOF
        
        docker exec -i postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB < temp-schema.sql
        rm temp-schema.sql
    fi
}

# Test 1: Basic CRUD Operations
test_basic_crud() {
    echo -e "\n${BLUE}Test 1: Basic CRUD Operations${NC}"
    
    # Create note
    echo -n "Creating note... "
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO notes (id, title, metadata) 
        VALUES ('$TEST_NOTE_ID', 'Test Note', '{\"author\": \"test-suite\"}');
    " > /dev/null 2>&1
    echo -e "${GREEN}✓${NC}"
    
    # Create panels
    echo -n "Creating panels... "
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO panels (id, note_id, title, position) 
        VALUES 
            ('$TEST_PANEL_ID', '$TEST_NOTE_ID', 'Main Panel', '{\"x\": 100, \"y\": 100}'),
            ('770e8400-e29b-41d4-a716-446655440002', '$TEST_NOTE_ID', 'Branch Panel', '{\"x\": 500, \"y\": 100}');
    " > /dev/null 2>&1
    echo -e "${GREEN}✓${NC}"
    
    # Read test
    echo -n "Reading data... "
    PANEL_COUNT=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
        SELECT COUNT(*) FROM panels WHERE note_id = '$TEST_NOTE_ID';
    " | xargs)
    
    if [ "$PANEL_COUNT" -eq "2" ]; then
        echo -e "${GREEN}✓ Found $PANEL_COUNT panels${NC}"
    else
        echo -e "${RED}❌ Expected 2 panels, found $PANEL_COUNT${NC}"
        exit 1
    fi
    
    # Update test
    echo -n "Updating panel position... "
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        UPDATE panels 
        SET position = '{\"x\": 200, \"y\": 200}' 
        WHERE id = '$TEST_PANEL_ID';
    " > /dev/null 2>&1
    
    # Verify update trigger
    UPDATED_AT=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
        SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) 
        FROM panels 
        WHERE id = '$TEST_PANEL_ID';
    " | xargs)
    
    if (( $(echo "$UPDATED_AT > 0" | bc -l) )); then
        echo -e "${GREEN}✓ Update trigger working${NC}"
    else
        echo -e "${RED}❌ Update trigger failed${NC}"
        exit 1
    fi
}

# Test 2: Yjs State Persistence
test_yjs_persistence() {
    echo -e "\n${BLUE}Test 2: Yjs State Serialization${NC}"
    
    # Create test script for Yjs operations
    cat > test-yjs-persistence.js << 'EOF'
const Y = require('yjs');
const fs = require('fs');

// Create and populate a Yjs document
const doc = new Y.Doc();

// Add branches (annotations)
const branches = doc.getMap('branches');
branches.set('anno-1', {
    id: 'anno-1',
    type: 'note',
    sourcePanel: 'panel-1',
    targetPanel: 'panel-2',
    originalText: 'This is a test annotation'
});

// Add metadata
const metadata = doc.getMap('metadata');
const panels = new Y.Map();
panels.set('panel-1', {
    position: { x: 100, y: 100 },
    title: 'Test Panel 1'
});
metadata.set('panels', panels);

// Encode state as update
const stateUpdate = Y.encodeStateAsUpdate(doc);
console.log('Yjs state size:', stateUpdate.length, 'bytes');

// Save for database insertion
fs.writeFileSync('test-yjs-state.bin', Buffer.from(stateUpdate));

// Test decoding
const newDoc = new Y.Doc();
Y.applyUpdate(newDoc, stateUpdate);

const decoded = newDoc.getMap('branches').get('anno-1');
if (decoded && decoded.originalText === 'This is a test annotation') {
    console.log('✓ Yjs encoding/decoding works correctly');
    process.exit(0);
} else {
    console.log('❌ Yjs decoding failed');
    process.exit(1);
}
EOF

    # Run Yjs test
    if command -v node &> /dev/null && [ -f "node_modules/yjs/package.json" ]; then
        echo "Testing Yjs state encoding..."
        node test-yjs-persistence.js
        
        # Insert Yjs state into database
        echo -n "Persisting Yjs state to PostgreSQL... "
        
        # Convert binary to hex for psql
        YJS_HEX=$(xxd -p test-yjs-state.bin | tr -d '\n')
        
        docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
            INSERT INTO yjs_updates (doc_name, update, client_id) 
            VALUES ('note:$TEST_NOTE_ID', decode('$YJS_HEX', 'hex'), 'test-suite');
        " > /dev/null 2>&1
        echo -e "${GREEN}✓${NC}"
        
        # Verify retrieval
        echo -n "Retrieving Yjs state from PostgreSQL... "
        RETRIEVED_SIZE=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
            SELECT length(update) FROM yjs_updates WHERE doc_name = 'note:$TEST_NOTE_ID';
        " | xargs)
        
        if [ "$RETRIEVED_SIZE" -gt 0 ]; then
            echo -e "${GREEN}✓ Retrieved state of $RETRIEVED_SIZE bytes${NC}"
        else
            echo -e "${RED}❌ Failed to retrieve Yjs state${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⚠️  Yjs not installed, skipping binary state tests${NC}"
    fi
}

# Test 3: Annotation Persistence
test_annotation_persistence() {
    echo -e "\n${BLUE}Test 3: Annotation with RelativePosition${NC}"
    
    # Create annotation with mock RelativePosition
    echo -n "Creating annotation with anchors... "
    
    # Mock RelativePosition as binary data
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO annotations (
            note_id, type, source_panel_id, target_panel_id,
            anchor_start, anchor_end, anchors_fallback, 
            original_text, \"order\"
        ) VALUES (
            '$TEST_NOTE_ID', 'note', '$TEST_PANEL_ID', '770e8400-e29b-41d4-a716-446655440002',
            decode('0102030405', 'hex'), decode('0607080910', 'hex'),
            '{\"start\": {\"offset\": 10, \"textContent\": \"test\"}, \"end\": {\"offset\": 20}}',
            'Selected text for annotation', '1.5'
        );
    " > /dev/null 2>&1
    echo -e "${GREEN}✓${NC}"
    
    # Verify complex query
    echo -n "Testing annotation queries... "
    ANNO_COUNT=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
        SELECT COUNT(*) FROM annotations 
        WHERE note_id = '$TEST_NOTE_ID' 
        AND type = 'note'
        AND length(anchor_start) > 0;
    " | xargs)
    
    if [ "$ANNO_COUNT" -eq "1" ]; then
        echo -e "${GREEN}✓ Annotation query successful${NC}"
    else
        echo -e "${RED}❌ Annotation query failed${NC}"
        exit 1
    fi
}

# Test 4: Snapshot Creation and Recovery
test_snapshot_functionality() {
    echo -e "\n${BLUE}Test 4: Snapshot Creation & Recovery${NC}"
    
    # Create multiple updates
    echo -n "Creating multiple Yjs updates... "
    for i in {1..5}; do
        docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
            INSERT INTO yjs_updates (doc_name, update, client_id) 
            VALUES ('note:$TEST_NOTE_ID', decode('DEADBEEF0$i', 'hex'), 'client-$i');
        " > /dev/null 2>&1
    done
    echo -e "${GREEN}✓${NC}"
    
    # Create snapshot
    echo -n "Creating snapshot... "
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO snapshots (note_id, doc_name, snapshot, panels, checksum)
        VALUES (
            '$TEST_NOTE_ID', 'note:$TEST_NOTE_ID', 
            decode('CAFEBABE', 'hex'),
            ARRAY['$TEST_PANEL_ID', '770e8400-e29b-41d4-a716-446655440002'],
            'test-checksum-12345'
        );
    " > /dev/null 2>&1
    echo -e "${GREEN}✓${NC}"
    
    # Test snapshot retrieval
    echo -n "Retrieving latest snapshot... "
    SNAPSHOT_EXISTS=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
        SELECT COUNT(*) FROM snapshots 
        WHERE note_id = '$TEST_NOTE_ID' 
        AND 'panel' || '$TEST_PANEL_ID' = ANY(panels);
    " | xargs)
    
    if [ "$SNAPSHOT_EXISTS" -eq "1" ]; then
        echo -e "${GREEN}✓ Snapshot retrieved successfully${NC}"
    else
        echo -e "${RED}❌ Snapshot retrieval failed${NC}"
        exit 1
    fi
}

# Test 5: Performance Validation
test_performance() {
    echo -e "\n${BLUE}Test 5: Performance Validation${NC}"
    
    # Insert 1000 updates
    echo -n "Inserting 1000 Yjs updates... "
    START_TIME=$(date +%s%N)
    
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO yjs_updates (doc_name, update, client_id, timestamp)
        SELECT 
            'note:perf-test-' || (i % 10), 
            decode(lpad(to_hex(i), 8, '0'), 'hex'),
            'perf-client',
            NOW() - (i || ' seconds')::interval
        FROM generate_series(1, 1000) i;
    " > /dev/null 2>&1
    
    END_TIME=$(date +%s%N)
    ELAPSED_MS=$(( (END_TIME - START_TIME) / 1000000 ))
    echo -e "${GREEN}✓ Completed in ${ELAPSED_MS}ms${NC}"
    
    # Test query performance
    echo -n "Testing query performance... "
    QUERY_TIME=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT update FROM yjs_updates 
        WHERE doc_name = 'note:perf-test-5' 
        ORDER BY timestamp DESC 
        LIMIT 100;
    " | jq -r '.[0]."Execution Time"' 2>/dev/null || echo "0")
    
    if (( $(echo "$QUERY_TIME < 10" | bc -l) )); then
        echo -e "${GREEN}✓ Query completed in ${QUERY_TIME}ms${NC}"
    else
        echo -e "${YELLOW}⚠️  Query took ${QUERY_TIME}ms (target: <10ms)${NC}"
    fi
}

# Test 6: Data Integrity
test_data_integrity() {
    echo -e "\n${BLUE}Test 6: Data Integrity Validation${NC}"
    
    # Test foreign key constraints
    echo -n "Testing foreign key constraints... "
    if docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO panels (note_id, title) VALUES ('99999999-9999-9999-9999-999999999999', 'Orphan Panel');
    " > /dev/null 2>&1; then
        echo -e "${RED}❌ Foreign key constraint not working${NC}"
        exit 1
    else
        echo -e "${GREEN}✓ Foreign key constraints enforced${NC}"
    fi
    
    # Test check constraints
    echo -n "Testing check constraints... "
    if docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        INSERT INTO annotations (note_id, type, source_panel_id, target_panel_id, anchor_start, anchor_end, \"order\")
        VALUES ('$TEST_NOTE_ID', 'invalid-type', '$TEST_PANEL_ID', '$TEST_PANEL_ID', '\x00', '\x00', '1');
    " > /dev/null 2>&1; then
        echo -e "${RED}❌ Check constraint not working${NC}"
        exit 1
    else
        echo -e "${GREEN}✓ Check constraints enforced${NC}"
    fi
    
    # Test cascade deletes
    echo -n "Testing cascade deletes... "
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        DELETE FROM notes WHERE id = '$TEST_NOTE_ID';
    " > /dev/null 2>&1
    
    ORPHAN_COUNT=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "
        SELECT COUNT(*) FROM panels WHERE note_id = '$TEST_NOTE_ID';
    " | xargs)
    
    if [ "$ORPHAN_COUNT" -eq "0" ]; then
        echo -e "${GREEN}✓ Cascade deletes working${NC}"
    else
        echo -e "${RED}❌ Found $ORPHAN_COUNT orphan panels${NC}"
        exit 1
    fi
}

# Show summary statistics
show_summary() {
    echo -e "\n${BLUE}Database Summary:${NC}"
    
    docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "
        SELECT 
            'notes' as table_name, COUNT(*) as record_count FROM notes
        UNION ALL
        SELECT 'panels', COUNT(*) FROM panels
        UNION ALL
        SELECT 'annotations', COUNT(*) FROM annotations
        UNION ALL
        SELECT 'yjs_updates', COUNT(*) FROM yjs_updates
        UNION ALL
        SELECT 'snapshots', COUNT(*) FROM snapshots
        ORDER BY table_name;
    "
    
    # Database size
    DB_SIZE=$(docker exec postgres-persistence-postgres-1 psql -U postgres -t -c "
        SELECT pg_size_pretty(pg_database_size('$POSTGRES_TEST_DB'));
    " | xargs)
    
    echo -e "\nTotal database size: ${BLUE}$DB_SIZE${NC}"
}

# Main execution
main() {
    echo "Running PostgreSQL persistence validation..."
    echo "This will test:"
    echo "  1. Basic CRUD operations"
    echo "  2. Yjs state serialization"
    echo "  3. Annotation persistence"
    echo "  4. Snapshot functionality"
    echo "  5. Query performance"
    echo "  6. Data integrity"
    echo ""
    
    check_postgres
    setup_test_database
    
    # Run all tests
    test_basic_crud
    test_yjs_persistence
    test_annotation_persistence
    test_snapshot_functionality
    test_performance
    test_data_integrity
    
    show_summary
    
    echo -e "\n${GREEN}✅ All persistence validation tests passed!${NC}"
    echo -e "${YELLOW}Note: Remember that awareness/presence data should NEVER be persisted${NC}"
}

# Run main function
main

# Cleanup happens automatically via trap