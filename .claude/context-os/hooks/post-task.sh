#!/bin/bash
# Post-task hook - Run after completing a task

echo "🎉 Completing task..."

# Extract learnings from git commits
echo "📝 Extracting learnings from recent commits..."
recent_commits=$(git log --oneline -10 --grep="fix\|add\|implement" 2>/dev/null || echo "")

if [ ! -z "$recent_commits" ]; then
    echo "Found recent relevant commits:"
    echo "$recent_commits"
fi

# Check for new patterns
echo "🔍 Checking for new patterns..."

# Look for repeated code structures that might be patterns
find_patterns() {
    # Simple heuristic: files modified multiple times might contain patterns
    git log --name-only --pretty=format: -20 | sort | uniq -c | sort -rn | head -5
}

modified_files=$(find_patterns)
if [ ! -z "$modified_files" ]; then
    echo "Frequently modified files (potential patterns):"
    echo "$modified_files"
fi

# Run tests to ensure nothing broke
echo "🧪 Running tests..."
npm run test --silent || echo "⚠️  Some tests failed - check before committing"

# Update metrics
echo "📊 Updating metrics..."
task_duration="unknown"
if [ -f ".claude/context-os/current/active.md" ]; then
    # In a real implementation, we'd calculate actual duration
    echo "Task completed. Duration: $task_duration"
fi

# Suggest next steps
echo "
💡 Suggested next steps:
1. Review and commit your changes
2. Update knowledge base with any new learnings
3. Archive the current task file
4. Run: git add -A && git commit -m 'your message'
"

# Reminder about knowledge capture
echo "
📚 Don't forget to capture learnings:
- Any new patterns? Add to .claude/context-os/knowledge/patterns/
- Hit any errors? Document in .claude/context-os/knowledge/errors/
- Made decisions? Record in .claude/context-os/knowledge/decisions/
"