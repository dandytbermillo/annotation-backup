#!/bin/bash

# Create test data for drag-drop manual testing

echo "Creating test data structure..."

# Create source folder
FOLDER_A=$(curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"type": "folder", "name": "Drag Test Source", "parentId": null}' | jq -r '.item.id')
echo "✓ Created Source Folder: $FOLDER_A"

# Create target folder
FOLDER_B=$(curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"type": "folder", "name": "Drag Test Target", "parentId": null}' | jq -r '.item.id')
echo "✓ Created Target Folder: $FOLDER_B"

# Create test notes in source folder
NOTE_1=$(curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"note\", \"name\": \"Test Note 1\", \"parentId\": \"$FOLDER_A\"}" | jq -r '.item.id')
echo "✓ Created Test Note 1: $NOTE_1"

NOTE_2=$(curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"note\", \"name\": \"Test Note 2\", \"parentId\": \"$FOLDER_A\"}" | jq -r '.item.id')
echo "✓ Created Test Note 2: $NOTE_2"

NOTE_3=$(curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"note\", \"name\": \"Test Note 3\", \"parentId\": \"$FOLDER_A\"}" | jq -r '.item.id')
echo "✓ Created Test Note 3: $NOTE_3"

# Create subfolder in target
SUBFOLDER=$(curl -s -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"folder\", \"name\": \"Nested Folder\", \"parentId\": \"$FOLDER_B\"}" | jq -r '.item.id')
echo "✓ Created Subfolder: $SUBFOLDER"

echo ""
echo "========================================="
echo "Test Data Created Successfully!"
echo "========================================="
echo "Source Folder ID: $FOLDER_A"
echo "Target Folder ID: $FOLDER_B"
echo "Test Notes: $NOTE_1, $NOTE_2, $NOTE_3"
echo "Subfolder ID: $SUBFOLDER"
echo ""
echo "Test Structure:"
echo "📁 Drag Test Source (contains 3 notes)"
echo "  📄 Test Note 1"
echo "  📄 Test Note 2"
echo "  📄 Test Note 3"
echo ""
echo "📁 Drag Test Target (empty, has 1 subfolder)"
echo "  📁 Nested Folder (empty)"
echo ""
echo "Ready for manual testing!"
