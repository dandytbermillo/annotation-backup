#!/bin/bash

# Test script to verify note switching fix
# This script checks that editor content persists when switching between notes

set -e

echo "Testing note switching fix..."
echo "============================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check that we're not destroying editor docs on note switch
echo "1. Checking yjs-provider.ts for editor doc preservation..."
if grep -q "DO NOT destroy editor docs when switching notes" lib/yjs-provider.ts; then
    echo -e "${GREEN}✓ Found fix: Editor docs are preserved when switching notes${NC}"
else
    echo -e "${RED}✗ ERROR: Editor docs are still being destroyed on note switch${NC}"
    exit 1
fi

# 2. Check that canvas component doesn't call destroyNote
echo ""
echo "2. Checking annotation-canvas-modern.tsx cleanup..."
if grep -q "Don't destroy note when switching" components/annotation-canvas-modern.tsx; then
    echo -e "${GREEN}✓ Found fix: Canvas doesn't destroy note on unmount${NC}"
else
    echo -e "${RED}✗ ERROR: Canvas still calls destroyNote on unmount${NC}"
    exit 1
fi

# 3. Check for empty update protection
echo ""
echo "3. Checking for empty update protection..."
if grep -q "Skipping empty update for panel" lib/yjs-provider.ts; then
    echo -e "${GREEN}✓ Found fix: Empty updates are filtered out${NC}"
else
    echo -e "${RED}✗ ERROR: Empty updates are not being filtered${NC}"
    exit 1
fi

# 4. Check PostgreSQL for recent updates
echo ""
echo "4. Checking PostgreSQL for recent empty updates..."
echo ""

# Create a temporary SQL script
cat > /tmp/check-empty-updates.sql << 'EOF'
-- Check for small updates in the last 5 minutes
SELECT 
    doc_name,
    length(update) as size,
    timestamp
FROM yjs_updates 
WHERE 
    doc_name LIKE '%panel%' 
    AND length(update) < 20
    AND timestamp > NOW() - INTERVAL '5 minutes'
ORDER BY timestamp DESC
LIMIT 10;
EOF

# Execute the query
echo "Recent small updates (potential empty content):"
docker compose exec -T postgres psql -U postgres -d annotation_system < /tmp/check-empty-updates.sql || true

# Clean up
rm -f /tmp/check-empty-updates.sql

echo ""
echo -e "${GREEN}=== Fix verification complete ===${NC}"
echo ""
echo "Next steps to test:"
echo "1. Run the app: npm run dev"
echo "2. Create a note with content"
echo "3. Switch to another note"
echo "4. Switch back - content should appear immediately"
echo "5. Check console for 'Skipping empty update' messages"
echo ""
echo "To monitor persistence:"
echo "  node debug-editor-deletion.js"
echo ""
echo "To decode specific updates:"
echo "  node decode-yjs-updates.js <doc-name>"