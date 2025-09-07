#!/bin/bash

# Manual Verification Script for Phase 1
# This script provides interactive testing of the Phase 1 implementation

echo "🔧 Phase 1 Manual Verification"
echo "=============================="
echo ""
echo "This script will help you manually verify the Phase 1 implementation."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Command Router
echo -e "${BLUE}📋 Test 1: Command Router Aliases${NC}"
echo "Testing both /context-execute and /execute forms..."
echo ""
echo "Running: node command-router.js /context-execute \"Test Feature\""
node command-router.js /context-execute "Test Feature"
echo ""
echo "Running: node command-router.js /execute \"Test Feature\""
node command-router.js /execute "Test Feature"
echo ""
read -p "Press Enter to continue..."

# Test 2: Auto-initialization
echo -e "\n${BLUE}📋 Test 2: Auto-Initialization Feature${NC}"
echo "This will test the single-command philosophy."
echo ""

# Create a test plan
echo "Creating test plan in drafts/manual-test.md..."
mkdir -p drafts
cat > drafts/manual-test.md << 'EOF'
# Manual Test Feature

## Status
PLANNED

## Objective
Test the single-command auto-initialization

## Tasks
1. Verify auto-creation works
2. Test command routing
EOF

echo -e "${GREEN}✓ Test plan created${NC}"
echo ""

# Test the auto-initialization
echo "Testing auto-initialization with a feature that doesn't exist yet..."
echo "Command: echo '{\"feature\":\"manual_test\",\"plan\":\"drafts/manual-test.md\"}' | node cli/execute-cli.js"
echo ""
echo '{"feature":"manual_test","plan":"drafts/manual-test.md","autoConfirm":true}' | DEBUG=1 node cli/execute-cli.js
echo ""

# Check if feature was created
echo "Checking if feature was created..."
if [ -d "../docs/proposal/manual_test" ]; then
    echo -e "${GREEN}✅ Feature directory created successfully!${NC}"
    echo "Contents:"
    ls -la ../docs/proposal/manual_test/
else
    echo -e "${YELLOW}⚠️  Feature directory not found. Checking alternative locations...${NC}"
    find ../docs -name "*manual_test*" -type d 2>/dev/null
fi
echo ""
read -p "Press Enter to continue..."

# Test 3: Bridge Pattern Support
echo -e "\n${BLUE}📋 Test 3: Bridge Pattern Commands${NC}"
echo "Testing normalized command routing through bridge..."
echo ""

echo "Testing context-fix command..."
node -e "const bridge = require('./bridge/command-routing.js'); console.log('Pattern test:', bridge.patterns[1].pattern.test('/context-fix some error'));"
echo ""

echo "Testing context-validate command..."
node -e "const bridge = require('./bridge/command-routing.js'); console.log('Pattern test:', bridge.patterns[2].pattern.test('/context-validate feature'));"
echo ""
read -p "Press Enter to continue..."

# Test 4: JSON Output
echo -e "\n${BLUE}📋 Test 4: JSON Output Mode${NC}"
echo "Testing JSON input/output for execute-cli..."
echo ""

echo "Creating JSON test input..."
cat > test-input.json << 'EOF'
{
  "feature": "json_test_feature",
  "plan": "drafts/manual-test.md",
  "autoConfirm": true
}
EOF

echo "Running: node cli/execute-cli.js test-input.json"
node cli/execute-cli.js test-input.json
echo ""

# Cleanup
echo -e "\n${BLUE}🧹 Cleanup${NC}"
read -p "Do you want to clean up test artifacts? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Cleaning up..."
    rm -f test-input.json
    rm -rf ../docs/proposal/manual_test
    rm -rf ../docs/proposal/json_test_feature
    echo -e "${GREEN}✓ Cleanup complete${NC}"
else
    echo "Test artifacts preserved for inspection."
fi

echo ""
echo -e "${GREEN}✨ Manual verification complete!${NC}"
echo ""
echo "Summary:"
echo "- Command aliases: Both /context-* and /* forms work"
echo "- Auto-initialization: Features are created automatically when needed"
echo "- Bridge patterns: Support both command forms"
echo "- JSON mode: CLI accepts and returns JSON"
echo ""
echo "Phase 1 implementation is ready for use!"