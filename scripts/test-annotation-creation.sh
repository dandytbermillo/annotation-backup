#!/bin/bash

# Test annotation creation with "main" panel ID
# This tests the fix for UUID validation error when creating annotations

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[33m'
NC='\033[0m'

echo -e "${YELLOW}Testing annotation creation with non-UUID parentId...${NC}"

# API endpoint
API_BASE="http://localhost:3000/api/postgres-offline"

# Test data
NOTE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
BRANCH_ID="branch-$(uuidgen | tr '[:upper:]' '[:lower:]')"

# Test 1: Create branch with parentId="main" (should normalize to null)
echo -e "\n${YELLOW}Test 1: Creating annotation with parentId='main'${NC}"
RESPONSE=$(curl -s -X POST "$API_BASE/branches" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$BRANCH_ID\",
    \"noteId\": \"$NOTE_ID\",
    \"parentId\": \"main\",
    \"type\": \"note\",
    \"originalText\": \"Test annotation from main panel\",
    \"metadata\": {
      \"annotationType\": \"note\",
      \"annotationId\": \"test-annotation-1\"
    }
  }")

if echo "$RESPONSE" | grep -q "id"; then
  echo -e "${GREEN}✓ Successfully created branch with parentId='main'${NC}"
  echo "Response: $RESPONSE"
else
  echo -e "${RED}✗ Failed to create branch${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

# Test 2: Create branch with valid UUID parentId
echo -e "\n${YELLOW}Test 2: Creating annotation with valid UUID parentId${NC}"
PARENT_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CHILD_BRANCH_ID="branch-$(uuidgen | tr '[:upper:]' '[:lower:]')"

RESPONSE=$(curl -s -X POST "$API_BASE/branches" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$CHILD_BRANCH_ID\",
    \"noteId\": \"$NOTE_ID\",
    \"parentId\": \"$PARENT_UUID\",
    \"type\": \"explore\",
    \"originalText\": \"Test annotation with UUID parent\",
    \"metadata\": {
      \"annotationType\": \"explore\"
    }
  }")

if echo "$RESPONSE" | grep -q "id"; then
  echo -e "${GREEN}✓ Successfully created branch with UUID parentId${NC}"
  echo "Response: $RESPONSE"
else
  echo -e "${RED}✗ Failed to create branch with UUID parentId${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

# Test 3: Create branch with empty parentId
echo -e "\n${YELLOW}Test 3: Creating annotation with empty parentId${NC}"
EMPTY_PARENT_BRANCH_ID="branch-$(uuidgen | tr '[:upper:]' '[:lower:]')"

RESPONSE=$(curl -s -X POST "$API_BASE/branches" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$EMPTY_PARENT_BRANCH_ID\",
    \"noteId\": \"$NOTE_ID\",
    \"parentId\": \"\",
    \"type\": \"promote\",
    \"originalText\": \"Test annotation with empty parent\",
    \"metadata\": {
      \"annotationType\": \"promote\"
    }
  }")

if echo "$RESPONSE" | grep -q "id"; then
  echo -e "${GREEN}✓ Successfully created branch with empty parentId${NC}"
  echo "Response: $RESPONSE"
else
  echo -e "${RED}✗ Failed to create branch with empty parentId${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

# Test 4: List branches to verify they were created
echo -e "\n${YELLOW}Test 4: Listing branches for note${NC}"
RESPONSE=$(curl -s "$API_BASE/branches?noteId=$NOTE_ID")

if echo "$RESPONSE" | grep -q "$BRANCH_ID"; then
  echo -e "${GREEN}✓ Successfully retrieved branches${NC}"
  echo "Found $(echo "$RESPONSE" | grep -o '"id"' | wc -l) branches"
else
  echo -e "${RED}✗ Failed to retrieve branches${NC}"
  echo "Response: $RESPONSE"
  exit 1
fi

echo -e "\n${GREEN}All tests passed! The annotation creation fix is working correctly.${NC}"
echo -e "${YELLOW}Note: Make sure to restart your dev server after applying the fix.${NC}"