#!/bin/bash
# Context-OS Post-Commit Hook - Track file usage patterns

# Only run if Context-OS is installed
if [ ! -d ".claude/context-os" ]; then
  exit 0
fi

# Check if last context exists
if [ ! -f ".claude/context-os/cache/last-context.json" ]; then
  exit 0
fi

# Get modified files from the commit
MODIFIED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD)

if [ -z "$MODIFIED_FILES" ]; then
  exit 0
fi

# Track usage
echo "📊 Context-OS: Tracking usage patterns..."
node .claude/context-os/bin/context track -f $MODIFIED_FILES 2>/dev/null

exit 0