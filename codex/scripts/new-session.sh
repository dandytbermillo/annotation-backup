#!/usr/bin/env bash
set -euo pipefail

# new-session.sh — scaffold previous-session records
# Usage: ./codex/scripts/new-session.sh [YYYY-MM-DD] [optional-title]

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SESS_DIR="$ROOT_DIR/codex/previous-sessions"

DATE="${1:-$(date -u +%F)}"
TITLE_SUFFIX="${2:-}" # optional human title suffix

EXEC_FILE="$SESS_DIR/${DATE}-exec-summary.md"
SESS_FILE="$SESS_DIR/${DATE}-session-summary.md"
CHANGELOG_FILE="$SESS_DIR/CHANGELOG.md"

mkdir -p "$SESS_DIR"

if [[ ! -f "$EXEC_FILE" ]]; then
  cat > "$EXEC_FILE" <<EOF
# Executive Summary — ${DATE}${TITLE_SUFFIX:+ — ${TITLE_SUFFIX}}

- Scope: <brief scope of today’s work>
- Key Artifacts:
  - <paths created/updated>
- Noted Gaps (not applied):
  - <list any pending items>
- Next Steps:
  - <ordered, actionable bullets>
EOF
  echo "[new-session] Created $EXEC_FILE"
else
  echo "[new-session] Skipped (exists): $EXEC_FILE"
fi

if [[ ! -f "$SESS_FILE" ]]; then
  cat > "$SESS_FILE" <<'EOF'
# Session Summary — DATE

## Context
- Constraints/approvals: <summarize>
- Goals: <summarize>

## Actions & Findings
- <key scans/diagnostics>
- <proposed changes>

## Approvals & Constraints Observed
- <what was approved vs. deferred>

## Outstanding Recommendations
- <list with file paths>

## Next Suggested Steps
- <ordered, actionable list>
EOF
  # Replace DATE placeholder with actual date
  sed -i '' "s/^# Session Summary — DATE/# Session Summary — ${DATE}${TITLE_SUFFIX:+ — ${TITLE_SUFFIX}}/" "$SESS_FILE" 2>/dev/null || \
  sed -i "s/^# Session Summary — DATE/# Session Summary — ${DATE}${TITLE_SUFFIX:+ — ${TITLE_SUFFIX}}/" "$SESS_FILE" 2>/dev/null || true
  echo "[new-session] Created $SESS_FILE"
else
  echo "[new-session] Skipped (exists): $SESS_FILE"
fi

# Ensure CHANGELOG exists
if [[ ! -f "$CHANGELOG_FILE" ]]; then
  cat > "$CHANGELOG_FILE" <<'EOF'
# Sessions Changelog
EOF
  echo "[new-session] Created $CHANGELOG_FILE"
fi

# Append entry header if not present for today
if ! grep -q "^## ${DATE}$" "$CHANGELOG_FILE"; then
  {
    echo ""
    echo "## ${DATE}"
    echo "- Created ${DATE}-exec-summary.md and ${DATE}-session-summary.md"
    echo "- <add 2–4 bullets of key outcomes>"
  } >> "$CHANGELOG_FILE"
  echo "[new-session] Appended ${DATE} to CHANGELOG.md"
else
  echo "[new-session] CHANGELOG already contains ${DATE} section"
fi

echo "[new-session] Done. Edit the scaffolded files to fill details."

# Refresh the RESUME pointer if helper exists
if [[ -x "$ROOT_DIR/codex/scripts/refresh-resume.sh" ]]; then
  (cd "$ROOT_DIR" && ./codex/scripts/refresh-resume.sh || true)
else
  echo "[new-session] Tip: run ./codex/scripts/refresh-resume.sh to update RESUME.md"
fi
