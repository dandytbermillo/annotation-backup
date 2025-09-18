#!/bin/bash
# Test script to verify plain mode content loading

echo "Testing Plain Mode Content Loading..."

# Set plain mode environment
export NEXT_PUBLIC_COLLAB_MODE=plain

# Start the dev server in background
npm run dev &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 5

# Test content loading
echo "Testing content save and load..."

# Create a test note and save content
curl -X POST http://localhost:3000/api/postgres-offline/notes \
  -H "Content-Type: application/json" \
  -d '{"id":"550e8400-e29b-41d4-a716-446655440000","title":"Test Note"}' \
  -o /dev/null -s

# Save document content
curl -X POST http://localhost:3000/api/postgres-offline/documents \
  -H "Content-Type: application/json" \
  -d '{
    "noteId": "550e8400-e29b-41d4-a716-446655440000",
    "panelId": "main",
    "content": {
      "type": "doc",
      "content": [{
        "type": "paragraph",
        "content": [{
          "type": "text",
          "text": "This is test content that should be loaded when switching notes!"
        }]
      }]
    },
    "version": 1,
    "baseVersion": 0
  }' \
  -o /dev/null -s

# Test loading the document
echo "Loading saved content..."
RESPONSE=$(curl -s http://localhost:3000/api/postgres-offline/documents/550e8400-e29b-41d4-a716-446655440000/main)
echo "Response: $RESPONSE"

# Check if content was loaded
if [[ $RESPONSE == *"This is test content"* ]]; then
  echo "✅ Content loaded successfully from API!"
else
  echo "❌ Failed to load content from API"
fi

# Clean up
kill $SERVER_PID
echo "Test completed."