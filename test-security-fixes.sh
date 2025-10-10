#!/bin/bash

echo "=== Security Fix Verification Tests ==="
echo ""

echo "Test 1: Nested __proto__ injection should be BLOCKED"
curl -s -X POST http://localhost:3000/api/annotation-types \
  -H "Content-Type: application/json" \
  -d '{"id":"verify-nested-proto","label":"Verify Nested Proto","color":"#FF0000","gradient":"#FF0000","icon":"🔒","defaultWidth":400,"metadata":{"description":{"__proto__":{"polluted":true}}}}' \
  | jq .

echo ""
echo "Test 2: Nested constructor injection should be BLOCKED"
curl -s -X POST http://localhost:3000/api/annotation-types \
  -H "Content-Type: application/json" \
  -d '{"id":"verify-constructor","label":"Verify Constructor","color":"#FF0000","gradient":"#FF0000","icon":"⚠️","defaultWidth":400,"metadata":{"author":{"constructor":{"bad":true}}}}' \
  | jq .

echo ""
echo "Test 3: Safe nested metadata should be ALLOWED"
curl -s -X POST http://localhost:3000/api/annotation-types \
  -H "Content-Type: application/json" \
  -d '{"id":"verify-safe-nested","label":"Verify Safe Nested","color":"#00FF00","gradient":"#00FF00","icon":"✅","defaultWidth":400,"metadata":{"tags":["safe","nested"],"description":"This is a safe nested structure"}}' \
  | jq .

echo ""
echo "Test 4: GET endpoint should work (registry initialization)"
curl -s -X GET http://localhost:3000/api/annotation-types | jq 'map(select(.id | startswith("verify-"))) | .[].id'

echo ""
echo "=== Cleanup ==="
curl -s -X DELETE http://localhost:3000/api/annotation-types/verify-safe-nested | jq .
