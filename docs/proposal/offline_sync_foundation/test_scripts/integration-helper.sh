#!/bin/bash

# Integration Test Helper Script
# Automated setup and teardown for integration testing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
DB_NAME="annotation_dev"
DB_USER="postgres"
DB_PASS="postgres"
DB_HOST="localhost"
DB_PORT="5432"
PROJECT_ROOT="$(cd "$(dirname "$0")/../../../../" && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/migrations"
TEST_DATA_DIR="$(dirname "$0")/test_data"

# Helper functions
log() {
    local level=$1
    shift
    case $level in
        info)  echo -e "${BLUE}[INFO]${NC} $*" ;;
        success) echo -e "${GREEN}[SUCCESS]${NC} $*" ;;
        warning) echo -e "${YELLOW}[WARNING]${NC} $*" ;;
        error) echo -e "${RED}[ERROR]${NC} $*" ;;
    esac
}

check_requirements() {
    log info "Checking requirements..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log error "Docker is not installed"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm/pnpm
    if command -v pnpm &> /dev/null; then
        PKG_MANAGER="pnpm"
    elif command -v npm &> /dev/null; then
        PKG_MANAGER="npm"
    else
        log error "Neither npm nor pnpm is installed"
        exit 1
    fi
    
    log success "All requirements met (using $PKG_MANAGER)"
}

setup_database() {
    log info "Setting up database..."
    
    # Start PostgreSQL container
    cd "$PROJECT_ROOT"
    docker compose up -d postgres
    
    # Wait for PostgreSQL to be ready
    log info "Waiting for PostgreSQL to be ready..."
    for i in {1..30}; do
        if docker exec annotation_postgres pg_isready -U $DB_USER > /dev/null 2>&1; then
            log success "PostgreSQL is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            log error "PostgreSQL failed to start"
            exit 1
        fi
        sleep 1
    done
    
    # Create database if not exists
    docker exec annotation_postgres psql -U $DB_USER -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
        docker exec annotation_postgres psql -U $DB_USER -c "CREATE DATABASE $DB_NAME"
    
    log success "Database ready"
}

apply_migrations() {
    log info "Applying migrations..."
    
    # Apply each migration in order
    for migration in 010_document_saves_fts 011_offline_queue_reliability; do
        if [ -f "$MIGRATIONS_DIR/${migration}.up.sql" ]; then
            log info "Applying $migration..."
            docker exec -i annotation_postgres psql -U $DB_USER -d $DB_NAME < "$MIGRATIONS_DIR/${migration}.up.sql" 2>/dev/null || \
                log warning "$migration may already be applied"
        else
            log warning "Migration $migration not found"
        fi
    done
    
    log success "Migrations applied"
}

insert_test_data() {
    log info "Inserting test data..."
    
    # Create test data SQL
    cat > /tmp/test_data.sql << 'EOF'
-- Insert test notes
INSERT INTO notes (id, title, content, metadata, created_at, updated_at)
VALUES 
    ('test-note-001', 'Test Note 1', '{"content": "First test note"}', '{}', NOW(), NOW()),
    ('test-note-002', 'Test Note 2', '{"content": "Second test note"}', '{}', NOW(), NOW()),
    ('test-note-003', 'Search Test', '{"content": "The quick brown fox"}', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test panels
INSERT INTO panels (id, note_id, position, dimensions, state, last_accessed)
VALUES 
    ('test-panel-001', 'test-note-001', '{"x": 100, "y": 100}', '{"width": 400, "height": 300}', 'active', NOW()),
    ('test-panel-002', 'test-note-002', '{"x": 550, "y": 100}', '{"width": 400, "height": 300}', 'active', NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test document saves with versions
INSERT INTO document_saves (note_id, panel_id, content, version, document_text, created_at)
VALUES 
    ('test-note-001', 'test-panel-001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Version 1"}]}]}', 1, 'Version 1', NOW() - INTERVAL '2 hours'),
    ('test-note-001', 'test-panel-001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Version 2 with changes"}]}]}', 2, 'Version 2 with changes', NOW() - INTERVAL '1 hour'),
    ('test-note-001', 'test-panel-001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Version 3 latest"}]}]}', 3, 'Version 3 latest', NOW())
ON CONFLICT (note_id, panel_id, version) DO NOTHING;

-- Update search vectors
UPDATE document_saves 
SET search_vector = to_tsvector('english', document_text)
WHERE search_vector IS NULL;

-- Insert test queue operations
INSERT INTO offline_queue (
    type, table_name, entity_id, data, 
    idempotency_key, priority, status, created_at
)
VALUES 
    ('create', 'notes', 'queue-test-001', '{"title": "Queued Note"}'::jsonb, 
     gen_random_uuid()::text, 5, 'pending', NOW()),
    ('update', 'panels', 'test-panel-001', '{"position": {"x": 200, "y": 200}}'::jsonb,
     gen_random_uuid()::text, 10, 'pending', NOW())
ON CONFLICT (idempotency_key) DO NOTHING;
EOF
    
    # Execute test data
    docker exec -i annotation_postgres psql -U $DB_USER -d $DB_NAME < /tmp/test_data.sql
    rm /tmp/test_data.sql
    
    log success "Test data inserted"
}

run_tests() {
    local test_type=$1
    
    case $test_type in
        unit)
            log info "Running unit tests..."
            cd "$PROJECT_ROOT"
            $PKG_MANAGER run test
            ;;
        integration)
            log info "Running integration tests..."
            cd "$PROJECT_ROOT"
            $PKG_MANAGER run test:integration
            ;;
        e2e)
            log info "Running E2E tests..."
            cd "$PROJECT_ROOT"
            if [ -f "$PROJECT_ROOT/docs/proposal/offline_sync_foundation/test_scripts/api-smoke-test.js" ]; then
                # Start dev server in background
                log info "Starting development server..."
                $PKG_MANAGER run dev > /tmp/dev-server.log 2>&1 &
                DEV_PID=$!
                sleep 5
                
                # Run API smoke tests
                node "$PROJECT_ROOT/docs/proposal/offline_sync_foundation/test_scripts/api-smoke-test.js"
                
                # Kill dev server
                kill $DEV_PID 2>/dev/null || true
            else
                log warning "E2E test script not found"
            fi
            ;;
        queue)
            log info "Running queue reliability tests..."
            if [ -f "$PROJECT_ROOT/docs/proposal/offline_sync_foundation/test_scripts/test-queue-reliability.js" ]; then
                node "$PROJECT_ROOT/docs/proposal/offline_sync_foundation/test_scripts/test-queue-reliability.js"
            else
                log warning "Queue test script not found"
            fi
            ;;
        sql)
            log info "Running SQL validations..."
            if [ -f "$PROJECT_ROOT/docs/proposal/offline_sync_foundation/test_scripts/sql-validation.sql" ]; then
                docker exec -i annotation_postgres psql -U $DB_USER -d $DB_NAME < \
                    "$PROJECT_ROOT/docs/proposal/offline_sync_foundation/test_scripts/sql-validation.sql"
            else
                log warning "SQL validation script not found"
            fi
            ;;
        all)
            run_tests unit
            run_tests integration
            run_tests queue
            run_tests sql
            run_tests e2e
            ;;
        *)
            log error "Unknown test type: $test_type"
            log info "Available: unit, integration, e2e, queue, sql, all"
            exit 1
            ;;
    esac
}

cleanup() {
    log info "Cleaning up..."
    
    # Clear test data
    docker exec annotation_postgres psql -U $DB_USER -d $DB_NAME -c "
        DELETE FROM offline_queue WHERE entity_id LIKE 'test-%' OR entity_id LIKE 'queue-test-%';
        DELETE FROM document_saves WHERE panel_id LIKE 'test-panel-%';
        DELETE FROM panels WHERE id LIKE 'test-panel-%';
        DELETE FROM notes WHERE id LIKE 'test-note-%';
        DELETE FROM offline_dead_letter WHERE entity_id LIKE 'test-%';
    " > /dev/null 2>&1
    
    log success "Cleanup complete"
}

reset_database() {
    log warning "Resetting database..."
    
    # Drop and recreate database
    docker exec annotation_postgres psql -U $DB_USER -c "DROP DATABASE IF EXISTS $DB_NAME"
    docker exec annotation_postgres psql -U $DB_USER -c "CREATE DATABASE $DB_NAME"
    
    # Reapply migrations
    apply_migrations
    
    log success "Database reset complete"
}

monitor_queue() {
    log info "Monitoring queue status..."
    
    watch -n 2 "docker exec annotation_postgres psql -U $DB_USER -d $DB_NAME -c \"
        SELECT status, COUNT(*) as count, 
               MIN(created_at) as oldest,
               AVG(retry_count) as avg_retries
        FROM offline_queue 
        GROUP BY status
        ORDER BY status;
        
        SELECT 'Dead Letter' as queue, COUNT(*) as count
        FROM offline_dead_letter
        WHERE archived = false;
    \""
}

# Main menu
show_menu() {
    echo ""
    echo "======================================="
    echo "   Integration Test Helper"
    echo "======================================="
    echo "1. Setup (Database + Migrations + Test Data)"
    echo "2. Run Unit Tests"
    echo "3. Run Integration Tests"
    echo "4. Run E2E Tests"
    echo "5. Run Queue Tests"
    echo "6. Run SQL Validations"
    echo "7. Run All Tests"
    echo "8. Monitor Queue Status"
    echo "9. Cleanup Test Data"
    echo "10. Reset Database"
    echo "0. Exit"
    echo "======================================="
    echo -n "Select option: "
}

# Parse command line arguments
if [ $# -gt 0 ]; then
    case $1 in
        setup)
            check_requirements
            setup_database
            apply_migrations
            insert_test_data
            ;;
        test)
            check_requirements
            run_tests ${2:-all}
            ;;
        cleanup)
            cleanup
            ;;
        reset)
            reset_database
            ;;
        monitor)
            monitor_queue
            ;;
        *)
            log error "Unknown command: $1"
            echo "Usage: $0 [setup|test|cleanup|reset|monitor]"
            exit 1
            ;;
    esac
else
    # Interactive mode
    check_requirements
    
    while true; do
        show_menu
        read -r option
        
        case $option in
            1)
                setup_database
                apply_migrations
                insert_test_data
                ;;
            2)
                run_tests unit
                ;;
            3)
                run_tests integration
                ;;
            4)
                run_tests e2e
                ;;
            5)
                run_tests queue
                ;;
            6)
                run_tests sql
                ;;
            7)
                run_tests all
                ;;
            8)
                monitor_queue
                ;;
            9)
                cleanup
                ;;
            10)
                reset_database
                ;;
            0)
                log info "Exiting..."
                exit 0
                ;;
            *)
                log error "Invalid option"
                ;;
        esac
    done
fi

log success "Script completed successfully"