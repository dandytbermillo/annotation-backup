#!/usr/bin/env bash
# Advisory: installs a git post-commit hook to log commits and update summary.
# Run manually from repo root. This writes outside .context-memory by design.

set -euo pipefail

HOOK_DIR=".git/hooks"
HOOK_FILE="$HOOK_DIR/post-commit"

mkdir -p "$HOOK_DIR"
cat > "$HOOK_FILE" <<'EOF'
#!/usr/bin/env bash
node .context-memory/scripts/post-commit.js || true
node .context-memory/scripts/summarize.js || true
EOF

chmod +x "$HOOK_FILE"
echo "Installed post-commit hook at $HOOK_FILE"

