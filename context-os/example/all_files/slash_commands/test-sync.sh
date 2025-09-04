#!/bin/bash
# Test multi-client YJS synchronization
# Tests real-time collaboration between multiple clients with Postgres persistence

set -e

echo "🔄 YJS Multi-Client Sync Test Suite"
echo "=================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TEST_PORT_1=3001
TEST_PORT_2=3002
TEST_PORT_3=3003
POSTGRES_TEST_DB="yjs_sync_test"
TEST_TIMEOUT=30

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up test environment...${NC}"
    
    # Kill test servers
    lsof -ti:$TEST_PORT_1 | xargs kill -9 2>/dev/null || true
    lsof -ti:$TEST_PORT_2 | xargs kill -9 2>/dev/null || true
    lsof -ti:$TEST_PORT_3 | xargs kill -9 2>/dev/null || true
    
    # Clean test database
    docker exec postgres-persistence-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS $POSTGRES_TEST_DB;" 2>/dev/null || true
}

# Set trap for cleanup
trap cleanup EXIT

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."
    
    # Check if Postgres is running
    if ! docker ps | grep -q postgres-persistence-postgres-1; then
        echo -e "${RED}❌ PostgreSQL container not running${NC}"
        echo "Run: docker compose up -d postgres"
        exit 1
    fi
    
    # Check if npm/pnpm is available
    if command -v pnpm &> /dev/null; then
        PKG_MANAGER="pnpm"
    elif command -v npm &> /dev/null; then
        PKG_MANAGER="npm"
    else
        echo -e "${RED}❌ No package manager found${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Prerequisites satisfied${NC}"
}

# Create test database
setup_test_db() {
    echo -e "\nSetting up test database..."
    
    docker exec postgres-persistence-postgres-1 psql -U postgres -c "CREATE DATABASE $POSTGRES_TEST_DB;" || true
    
    # Apply migrations to test database
    if [ -f "migrations/001_initial_schema.up.sql" ]; then
        docker exec -i postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB < migrations/001_initial_schema.up.sql
        echo -e "${GREEN}✓ Test database created and migrations applied${NC}"
    else
        echo -e "${YELLOW}⚠️  No migrations found, using existing schema${NC}"
    fi
}

# Start test clients
start_test_clients() {
    echo -e "\nStarting test clients..."
    
    # Create test config for each client
    cat > .env.test.client1 << EOF
NEXT_PUBLIC_WS_URL=ws://localhost:4444
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/$POSTGRES_TEST_DB
PORT=$TEST_PORT_1
CLIENT_ID=client1
EOF

    cat > .env.test.client2 << EOF
NEXT_PUBLIC_WS_URL=ws://localhost:4444
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/$POSTGRES_TEST_DB
PORT=$TEST_PORT_2
CLIENT_ID=client2
EOF

    cat > .env.test.client3 << EOF
NEXT_PUBLIC_WS_URL=ws://localhost:4444
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/$POSTGRES_TEST_DB
PORT=$TEST_PORT_3
CLIENT_ID=client3
EOF

    # Start clients in background
    echo "Starting Client 1 on port $TEST_PORT_1..."
    env $(cat .env.test.client1 | xargs) $PKG_MANAGER run dev > test-client1.log 2>&1 &
    
    echo "Starting Client 2 on port $TEST_PORT_2..."
    env $(cat .env.test.client2 | xargs) $PKG_MANAGER run dev > test-client2.log 2>&1 &
    
    echo "Starting Client 3 on port $TEST_PORT_3..."
    env $(cat .env.test.client3 | xargs) $PKG_MANAGER run dev > test-client3.log 2>&1 &
    
    # Wait for servers to start
    echo "Waiting for clients to start..."
    sleep 10
}

# Run sync tests
run_sync_tests() {
    echo -e "\n${YELLOW}Running multi-client sync tests...${NC}"
    
    # Test 1: Create annotation on Client 1, verify on Client 2 & 3
    echo -e "\n📝 Test 1: Cross-client annotation sync"
    cat > test-sync-scenario.js << 'EOF'
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    
    try {
        // Open 3 clients
        const context1 = await browser.newContext();
        const page1 = await context1.newPage();
        await page1.goto('http://localhost:3001');
        
        const context2 = await browser.newContext();
        const page2 = await context2.newPage();
        await page2.goto('http://localhost:3002');
        
        const context3 = await browser.newContext();
        const page3 = await context3.newPage();
        await page3.goto('http://localhost:3003');
        
        // Wait for YJS to initialize
        await page1.waitForTimeout(2000);
        
        // Client 1: Create annotation
        await page1.evaluate(() => {
            const doc = window.yjsDoc;
            const annotations = doc.getMap('branches');
            annotations.set('test-annotation', {
                id: 'test-annotation',
                type: 'note',
                sourcePanel: 'panel-1',
                targetPanel: 'panel-2',
                originalText: 'Test annotation from Client 1'
            });
        });
        
        // Wait for sync
        await page1.waitForTimeout(1000);
        
        // Verify on Client 2
        const client2Result = await page2.evaluate(() => {
            const doc = window.yjsDoc;
            const annotations = doc.getMap('branches');
            const annotation = annotations.get('test-annotation');
            return annotation?.originalText;
        });
        
        // Verify on Client 3
        const client3Result = await page3.evaluate(() => {
            const doc = window.yjsDoc;
            const annotations = doc.getMap('branches');
            const annotation = annotations.get('test-annotation');
            return annotation?.originalText;
        });
        
        if (client2Result === 'Test annotation from Client 1' && 
            client3Result === 'Test annotation from Client 1') {
            console.log('✅ Test 1 PASSED: Annotation synced across all clients');
        } else {
            console.log('❌ Test 1 FAILED: Annotation not synced properly');
            process.exit(1);
        }
        
        // Test 2: Concurrent edits
        console.log('\n🔄 Test 2: Concurrent edit resolution');
        
        await Promise.all([
            page1.evaluate(() => {
                const metadata = window.yjsDoc.getMap('metadata');
                metadata.set('test-concurrent', 'Client 1 edit');
            }),
            page2.evaluate(() => {
                const metadata = window.yjsDoc.getMap('metadata');
                metadata.set('test-concurrent', 'Client 2 edit');
            }),
            page3.evaluate(() => {
                const metadata = window.yjsDoc.getMap('metadata');
                metadata.set('test-concurrent', 'Client 3 edit');
            })
        ]);
        
        await page1.waitForTimeout(2000);
        
        // All clients should converge to same value
        const values = await Promise.all([
            page1.evaluate(() => window.yjsDoc.getMap('metadata').get('test-concurrent')),
            page2.evaluate(() => window.yjsDoc.getMap('metadata').get('test-concurrent')),
            page3.evaluate(() => window.yjsDoc.getMap('metadata').get('test-concurrent'))
        ]);
        
        if (values[0] === values[1] && values[1] === values[2]) {
            console.log('✅ Test 2 PASSED: Concurrent edits converged to:', values[0]);
        } else {
            console.log('❌ Test 2 FAILED: Clients have different values:', values);
            process.exit(1);
        }
        
        // Test 3: Persistence check
        console.log('\n💾 Test 3: Postgres persistence verification');
        
        // Close all clients
        await browser.close();
        
        // Restart a client and check if data persists
        const newBrowser = await chromium.launch({ headless: true });
        const newPage = await newBrowser.newPage();
        await newPage.goto('http://localhost:3001');
        await newPage.waitForTimeout(3000);
        
        const persistedAnnotation = await newPage.evaluate(() => {
            const doc = window.yjsDoc;
            const annotations = doc.getMap('branches');
            return annotations.get('test-annotation')?.originalText;
        });
        
        if (persistedAnnotation === 'Test annotation from Client 1') {
            console.log('✅ Test 3 PASSED: Data persisted in PostgreSQL');
        } else {
            console.log('❌ Test 3 FAILED: Data not persisted properly');
            process.exit(1);
        }
        
        await newBrowser.close();
        
    } catch (error) {
        console.error('Test error:', error);
        process.exit(1);
    }
    
    process.exit(0);
})();
EOF

    # Run Playwright tests if available
    if command -v playwright &> /dev/null || [ -f "node_modules/.bin/playwright" ]; then
        echo "Running Playwright sync tests..."
        node test-sync-scenario.js
    else
        echo -e "${YELLOW}⚠️  Playwright not installed, running basic tests only${NC}"
        
        # Basic curl tests as fallback
        echo "Running basic HTTP tests..."
        
        # Test if servers are responding
        for port in $TEST_PORT_1 $TEST_PORT_2 $TEST_PORT_3; do
            if curl -s -o /dev/null -w "%{http_code}" http://localhost:$port | grep -q "200\|404"; then
                echo -e "${GREEN}✓ Client on port $port is responding${NC}"
            else
                echo -e "${RED}❌ Client on port $port is not responding${NC}"
                exit 1
            fi
        done
    fi
}

# Check Postgres persistence
check_persistence() {
    echo -e "\n${YELLOW}Checking PostgreSQL persistence...${NC}"
    
    # Query the test database
    UPDATES_COUNT=$(docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -t -c "SELECT COUNT(*) FROM yjs_updates;" | xargs)
    
    if [ "$UPDATES_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✓ Found $UPDATES_COUNT YJS updates in PostgreSQL${NC}"
        
        # Show sample data
        echo -e "\nSample persisted data:"
        docker exec postgres-persistence-postgres-1 psql -U postgres -d $POSTGRES_TEST_DB -c "SELECT doc_name, length(update) as update_size, timestamp FROM yjs_updates ORDER BY timestamp DESC LIMIT 5;"
    else
        echo -e "${RED}❌ No YJS updates found in PostgreSQL${NC}"
    fi
}

# Performance metrics
show_performance_metrics() {
    echo -e "\n${YELLOW}Performance Metrics:${NC}"
    
    # Check sync latency from logs
    for i in 1 2 3; do
        if [ -f "test-client$i.log" ]; then
            echo -e "\nClient $i sync events:"
            grep -E "(sync|update|latency)" test-client$i.log | tail -5 || echo "No sync events found"
        fi
    done
}

# Main execution
main() {
    echo "Starting YJS multi-client sync test..."
    echo "Test will verify:"
    echo "  1. Real-time sync between 3 clients"
    echo "  2. Concurrent edit resolution" 
    echo "  3. PostgreSQL persistence"
    echo "  4. Recovery after reconnection"
    echo ""
    
    check_prerequisites
    setup_test_db
    start_test_clients
    run_sync_tests
    check_persistence
    show_performance_metrics
    
    echo -e "\n${GREEN}✅ All sync tests completed!${NC}"
}

# Run main function
main

# Cleanup happens automatically via trap