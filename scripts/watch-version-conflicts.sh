#!/bin/bash
# Continuous monitoring for workspace_version_mismatch events

echo "🔍 Watching for workspace version conflicts..."
echo "Press Ctrl+C to stop"
echo ""

LAST_COUNT=0

while true; do
  CURRENT_COUNT=$(docker exec annotation_postgres psql -U postgres -d annotation_dev -t -c \
    "SELECT COUNT(*) FROM debug_logs WHERE action = 'workspace_version_mismatch';" \
    2>/dev/null | xargs)

  if [ "$CURRENT_COUNT" -gt "$LAST_COUNT" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ NEW VERSION CONFLICT DETECTED! ($CURRENT_COUNT total)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
      "SELECT
        TO_CHAR(created_at, 'HH24:MI:SS') as time,
        component,
        action,
        metadata->>'noteId' as note_id,
        metadata->>'storedVersion' as queued_ver,
        metadata->>'currentVersion' as current_ver
       FROM debug_logs
       WHERE action = 'workspace_version_mismatch'
       ORDER BY created_at DESC
       LIMIT 1;"

    echo ""
    echo "🎉 Version conflict successfully detected and logged!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    LAST_COUNT=$CURRENT_COUNT
  else
    printf "."
  fi

  sleep 2
done
