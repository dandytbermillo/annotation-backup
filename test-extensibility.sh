#!/bin/bash

echo "=== END-TO-END EXTENSIBILITY TEST ==="
echo ""

echo "Current state: List all annotation types"
curl -s http://localhost:3000/api/annotation-types | jq 'map({id, label, isSystem}) | sort_by(.isSystem, .id)'
echo ""

echo "---"
echo "TEST 1: Create a custom annotation type 'deadline'"
curl -s -X POST http://localhost:3000/api/annotation-types \
  -H "Content-Type: application/json" \
  -d '{"id":"deadline","label":"Deadline","color":"#9b59b6","gradient":"linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)","icon":"⏰","defaultWidth":420,"metadata":{"tags":["time-sensitive","priority"],"description":"Mark items with deadlines","category":"productivity"}}' \
  | jq '{id, label, isSystem, metadata}'
echo ""

echo "---"
echo "TEST 2: Verify 'deadline' appears in GET /api/annotation-types"
curl -s http://localhost:3000/api/annotation-types | jq 'map(select(.id == "deadline")) | .[0] | {id, label, isSystem, metadata}'
echo ""

echo "---"
echo "TEST 3: Update the 'deadline' annotation type"
curl -s -X PUT http://localhost:3000/api/annotation-types/deadline \
  -H "Content-Type: application/json" \
  -d '{"id":"deadline","label":"DEADLINE (HIGH PRIORITY)","color":"#9b59b6","gradient":"linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)","icon":"🚨","defaultWidth":500,"metadata":{"tags":["urgent","time-critical"]}}' \
  | jq '{id, label, icon, defaultWidth, metadata}'
echo ""

echo "---"
echo "TEST 4: Verify update worked"
curl -s http://localhost:3000/api/annotation-types | jq 'map(select(.id == "deadline")) | .[0] | {id, label, icon, defaultWidth}'
echo ""

echo "---"
echo "TEST 5: Try to modify system type 'note' (should fail)"
curl -s -X PUT http://localhost:3000/api/annotation-types/note \
  -H "Content-Type: application/json" \
  -d '{"id":"note","label":"HACKED","color":"#000000","gradient":"#000000","icon":"💀","defaultWidth":100,"metadata":{}}' \
  | jq .
echo ""

echo "---"
echo "TEST 6: Try to delete system type 'explore' (should fail)"
curl -s -X DELETE http://localhost:3000/api/annotation-types/explore | jq .
echo ""

echo "---"
echo "TEST 7: Delete the custom 'deadline' type (should succeed)"
curl -s -X DELETE http://localhost:3000/api/annotation-types/deadline | jq '{success, deletedId: .deleted.id, deletedLabel: .deleted.label}'
echo ""

echo "---"
echo "TEST 8: Verify 'deadline' is gone"
curl -s http://localhost:3000/api/annotation-types | jq 'map(select(.id == "deadline")) | length'
echo ""

echo "---"
echo "Final state: List all annotation types"
curl -s http://localhost:3000/api/annotation-types | jq 'map({id, label, isSystem}) | sort_by(.isSystem, .id)'
echo ""

echo "=== EXTENSIBILITY TEST COMPLETE ==="
