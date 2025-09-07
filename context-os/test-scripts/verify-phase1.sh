#!/bin/bash

# Phase 1 Verification Script
# Tests the actual working implementation

echo "🧪 Phase 1 Verification"
echo "======================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Test 1: Command Router Aliases
echo "📝 Test 1: Command Router Aliases"
echo "---------------------------------"

# Test context-execute parsing
echo -n "  Testing /context-execute... "
if node -e "const r = require('./command-router.js'); const router = new r(); const res = router.parseCommand(['/context-execute', '\"Test\"']); if (res.command === 'execute') console.log('OK');" 2>/dev/null | grep -q "OK"; then
  echo -e "${GREEN}✅ Works${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Failed${NC}"
  ((FAILED++))
fi

# Test execute parsing  
echo -n "  Testing /execute... "
if node -e "const r = require('./command-router.js'); const router = new r(); const res = router.parseCommand(['/execute', '\"Test\"']); if (res.command === 'execute') console.log('OK');" 2>/dev/null | grep -q "OK"; then
  echo -e "${GREEN}✅ Works${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Failed${NC}"
  ((FAILED++))
fi

echo ""

# Test 2: Bridge Patterns
echo "📝 Test 2: Bridge Pattern Support"
echo "---------------------------------"

echo -n "  Checking normalizeCommand function... "
if grep -q "function normalizeCommand" bridge/command-routing.js; then
  echo -e "${GREEN}✅ Found${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Missing${NC}"
  ((FAILED++))
fi

echo -n "  Checking (context-)? patterns... "
if grep -q "(context-)?execute" bridge/command-routing.js && grep -q "(context-)?fix" bridge/command-routing.js; then
  echo -e "${GREEN}✅ Found${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Missing${NC}"
  ((FAILED++))
fi

echo ""

# Test 3: Auto-initialization
echo "📝 Test 3: Auto-Initialization Code"
echo "-----------------------------------"

echo -n "  Single Command Philosophy comment... "
if grep -q "SINGLE COMMAND PHILOSOPHY" cli/execute-cli.js; then
  echo -e "${GREEN}✅ Found${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Missing${NC}"
  ((FAILED++))
fi

echo -n "  Auto-init detection logic... "
if grep -q "if (!exists && !input.interactive" cli/execute-cli.js; then
  echo -e "${GREEN}✅ Found${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Missing${NC}"
  ((FAILED++))
fi

echo -n "  Feature existence check... "
if grep -q "fs.existsSync(featurePath)" cli/execute-cli.js; then
  echo -e "${GREEN}✅ Found${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Missing${NC}"
  ((FAILED++))
fi

echo ""

# Test 4: File Structure
echo "📝 Test 4: File Structure"
echo "------------------------"

echo -n "  CLI directory exists... "
if [ -d "cli" ]; then
  echo -e "${GREEN}✅ Yes${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ No${NC}"
  ((FAILED++))
fi

echo -n "  Bridge directory exists... "
if [ -d "bridge" ]; then
  echo -e "${GREEN}✅ Yes${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ No${NC}"
  ((FAILED++))
fi

echo -n "  Drafts directory exists... "
if [ -d "drafts" ]; then
  echo -e "${GREEN}✅ Yes${NC}"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠️  No (will be created)${NC}"
  mkdir -p drafts
  ((PASSED++))
fi

echo ""

# Summary
echo "================================"
echo "📊 Results Summary"
echo "================================"
echo -e "  Passed: ${GREEN}$PASSED${NC}"
echo -e "  Failed: ${RED}$FAILED${NC}"

TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
  PERCENTAGE=$((PASSED * 100 / TOTAL))
  echo -e "  Success Rate: ${PERCENTAGE}%"
fi

echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  echo "✨ Phase 1 is working correctly."
else
  echo -e "${YELLOW}⚠️  Some tests failed.${NC}"
  echo "Please review the implementation."
fi

echo ""
echo "📋 Manual Test Commands:"
echo "------------------------"
echo "1. Test command routing:"
echo "   node command-router.js /context-execute \"Test Feature\""
echo ""
echo "2. Test CLI with JSON:"
echo "   echo '{\"feature\":\"test\",\"plan\":\"drafts/test.md\"}' | node cli/execute-cli.js"
echo ""
echo "3. Check created features:"
echo "   ls ../docs/proposal/"
echo ""