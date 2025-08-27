#!/bin/bash
# Install Context-OS usage tracking hooks

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONTEXT_OS_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$CONTEXT_OS_ROOT")")"
GIT_HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "🔧 Installing Context-OS usage tracking hooks..."

# Ensure git hooks directory exists
if [ ! -d "$GIT_HOOKS_DIR" ]; then
  echo "❌ Not a git repository: $PROJECT_ROOT"
  exit 1
fi

# Install post-commit hook
if [ -f "$GIT_HOOKS_DIR/post-commit" ]; then
  # Backup existing hook
  cp "$GIT_HOOKS_DIR/post-commit" "$GIT_HOOKS_DIR/post-commit.backup"
  echo "📦 Backed up existing post-commit hook"
fi

# Copy our hook
cp "$SCRIPT_DIR/post-commit-usage.sh" "$GIT_HOOKS_DIR/post-commit"
chmod +x "$GIT_HOOKS_DIR/post-commit"

echo "✅ Installed post-commit hook for usage tracking"

# Create combined hook if backup exists
if [ -f "$GIT_HOOKS_DIR/post-commit.backup" ]; then
  cat > "$GIT_HOOKS_DIR/post-commit" << 'EOF'
#!/bin/bash
# Combined post-commit hook

# Run original hook
if [ -f ".git/hooks/post-commit.backup" ]; then
  .git/hooks/post-commit.backup
fi

# Run Context-OS usage tracking
EOF
  cat "$SCRIPT_DIR/post-commit-usage.sh" | grep -v '^#!/bin/bash' >> "$GIT_HOOKS_DIR/post-commit"
  chmod +x "$GIT_HOOKS_DIR/post-commit"
  echo "✅ Merged with existing post-commit hook"
fi

echo "🎉 Context-OS usage tracking hooks installed successfully!"
echo ""
echo "Usage tracking will now automatically run after each commit."
echo "View statistics with: .claude/context-os/bin/context stats"