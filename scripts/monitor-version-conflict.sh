#!/bin/bash
# Monitor for workspace_version_mismatch events in real-time

echo "🔍 Monitoring for workspace version conflicts..."
echo "Press Ctrl+C to stop"
echo ""

# Get the most recent workspace version mismatch timestamp to use as baseline
BASELINE=$(docker exec annotation_postgres psql -U postgres -d annotation_dev -t -c \
  "SELECT COALESCE(MAX(created_at), NOW() - INTERVAL '1 second') FROM debug_logs WHERE action = 'workspace_version_mismatch';" \
  | xargs)

echo "Baseline time: $BASELINE"
echo "Watching for new events..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Poll every 2 seconds for new events
while true; do
  NEW_EVENTS=$(docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
    "SELECT
      TO_CHAR(created_at, 'HH24:MI:SS') as time,
      component,
      action,
      metadata->>'noteId' as note_id,
      metadata->>'storedVersion' as queued_ver,
      metadata->>'currentVersion' as current_ver
     FROM debug_logs
     WHERE action = 'workspace_version_mismatch'
       AND created_at > '$BASELINE'
     ORDER BY created_at DESC;" 2>/dev/null)

  if [ -n "$NEW_EVENTS" ] && [ "$(echo "$NEW_EVENTS" | wc -l)" -gt 2 ]; then
    clear
    echo "✅ VERSION CONFLICT DETECTED!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$NEW_EVENTS"
    echo ""
    echo "🎉 Test successful! The version conflict was detected and logged."
    exit 0
  fi

  sleep 2
done
