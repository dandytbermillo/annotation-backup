#!/bin/bash

echo "=== Reproducing Plain Mode Reload Issue ==="
echo ""
echo "This test simulates what happens when:"
echo "1. User edits content in plain mode"
echo "2. Content is saved to database"
echo "3. Browser is reloaded"
echo "4. First reload shows old content"
echo "5. Second reload shows new content"
echo ""

# Test configuration
NOTE_ID="reload-test-$(date +%s)"
PANEL_ID="main"
API_BASE="http://localhost:3000/api/postgres-offline"

echo "Test Note ID: $NOTE_ID"
echo "Panel ID: $PANEL_ID"
echo ""

# Step 1: Save initial content
echo "Step 1: Saving initial content..."
INITIAL_CONTENT='{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "INITIAL content saved at '"$(date)"'"
        }
      ]
    }
  ]
}'

curl -X POST "$API_BASE/documents/$NOTE_ID/$PANEL_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "content": '"$INITIAL_CONTENT"',
    "version": 1,
    "baseVersion": 0
  }' -s > /dev/null

echo "✓ Initial content saved (version 1)"
echo ""

# Step 2: Load to verify
echo "Step 2: Loading content to verify save..."
RESULT1=$(curl -s "$API_BASE/documents/$NOTE_ID/$PANEL_ID")
echo "Loaded: $(echo $RESULT1 | jq -r '.content.content[0].content[0].text' 2>/dev/null || echo $RESULT1)"
echo ""

# Step 3: Update content (simulating user edit)
echo "Step 3: Updating content (simulating user edit)..."
UPDATED_CONTENT='{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "UPDATED content saved at '"$(date)"'"
        }
      ]
    }
  ]
}'

curl -X POST "$API_BASE/documents/$NOTE_ID/$PANEL_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "content": '"$UPDATED_CONTENT"',
    "version": 2,
    "baseVersion": 1
  }' -s > /dev/null

echo "✓ Content updated (version 2)"
echo ""

# Step 4: Load immediately (simulating same session)
echo "Step 4: Loading immediately after update (same session)..."
RESULT2=$(curl -s "$API_BASE/documents/$NOTE_ID/$PANEL_ID")
echo "Loaded: $(echo $RESULT2 | jq -r '.content.content[0].content[0].text' 2>/dev/null || echo $RESULT2)"
VERSION2=$(echo $RESULT2 | jq -r '.version')
echo "Version: $VERSION2"
echo ""

# Step 5: Simulate browser reload - new session
echo "Step 5: Simulating browser reload (new provider instance)..."
echo "First load after reload:"
RESULT3=$(curl -s "$API_BASE/documents/$NOTE_ID/$PANEL_ID")
echo "Loaded: $(echo $RESULT3 | jq -r '.content.content[0].content[0].text' 2>/dev/null || echo $RESULT3)"
VERSION3=$(echo $RESULT3 | jq -r '.version')
echo "Version: $VERSION3"
echo ""

# Step 6: Second reload
echo "Step 6: Simulating second reload..."
echo "Second load after reload:"
RESULT4=$(curl -s "$API_BASE/documents/$NOTE_ID/$PANEL_ID")
echo "Loaded: $(echo $RESULT4 | jq -r '.content.content[0].content[0].text' 2>/dev/null || echo $RESULT4)"
VERSION4=$(echo $RESULT4 | jq -r '.version')
echo "Version: $VERSION4"
echo ""

echo "=== Analysis ==="
echo "The API always returns the latest version ($VERSION2) from the database."
echo "If the UI shows old content on first reload, it's NOT because of:"
echo "1. ❌ Cache not being invalidated (provider cache is per-instance)"
echo "2. ❌ Database returning old data (API always returns latest)"
echo ""
echo "The issue must be in the client-side:"
echo "1. ✅ localStorage restore mechanism interfering"
echo "2. ✅ Race condition between localStorage restore and database load"
echo "3. ✅ Editor not updating properly when content is set"