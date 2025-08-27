#!/bin/bash

echo "🔍 Verifying PostgreSQL API Endpoints"
echo "===================================="

# Test the persist endpoint
echo ""
echo "Testing /api/persistence/persist endpoint..."

# Create a test update
curl -X POST http://localhost:3001/api/persistence/persist \
  -H "Content-Type: application/json" \
  -d '{
    "docName": "test-doc",
    "update": [1, 2, 3, 4, 5]
  }' \
  -w "\nHTTP Status: %{http_code}\n"

echo ""
echo "Testing /api/persistence/load endpoint..."

# Try to load the test doc
curl -X POST http://localhost:3001/api/persistence/load \
  -H "Content-Type: application/json" \
  -d '{
    "docName": "test-doc"
  }' \
  -w "\nHTTP Status: %{http_code}\n"

echo ""
echo "Checking database for test update..."
docker exec -i annotation_postgres psql -U postgres -d annotation_system -c "SELECT doc_name, octet_length(update) as size, timestamp FROM yjs_updates WHERE doc_name = 'test-doc' ORDER BY timestamp DESC LIMIT 1;"