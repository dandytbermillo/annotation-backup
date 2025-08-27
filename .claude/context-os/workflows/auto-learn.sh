#!/bin/bash

# Auto-learn from project activity
# Run this periodically to extract patterns and update knowledge

CONTEXT_OS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$CONTEXT_OS_DIR/../.." && pwd)"

echo "🧠 Auto-learning from project activity..."

# Extract patterns from recent commits
echo "📊 Analyzing recent commits..."
cd "$PROJECT_ROOT"

# Get commits from last 7 days
COMMITS=$(git log --since="7 days ago" --pretty=format:"%H|%s|%an|%ai" 2>/dev/null)

if [ -n "$COMMITS" ]; then
    # Process each commit
    while IFS='|' read -r hash message author date; do
        # Look for fix commits
        if echo "$message" | grep -qi "fix"; then
            echo "  Found fix: $message"
            # Extract the fix pattern
            "$CONTEXT_OS_DIR/bin/context" learn "$message" --solution "See commit $hash"
        fi
        
        # Look for feature additions
        if echo "$message" | grep -qiE "feat|add|implement"; then
            echo "  Found feature: $message"
            # Record as a pattern
            PATTERN_FILE="$CONTEXT_OS_DIR/knowledge/patterns/features-$(date +%Y%m).md"
            echo -e "\n- **$date**: $message (${hash:0:7})" >> "$PATTERN_FILE"
        fi
    done <<< "$COMMITS"
fi

# Analyze code for patterns
echo "🔍 Scanning for code patterns..."

# Find new React hooks
HOOKS=$(find "$PROJECT_ROOT" -name "*.tsx" -o -name "*.ts" | \
    xargs grep -h "^export.*function use[A-Z]" 2>/dev/null | \
    sed 's/export.*function \(use[A-Za-z]*\).*/\1/' | \
    sort -u)

if [ -n "$HOOKS" ]; then
    HOOKS_FILE="$CONTEXT_OS_DIR/knowledge/patterns/react-hooks.md"
    echo "# React Hooks in Project" > "$HOOKS_FILE"
    echo "" >> "$HOOKS_FILE"
    echo "$HOOKS" | while read hook; do
        echo "- \`$hook\`" >> "$HOOKS_FILE"
        # Find usage examples
        USAGE=$(grep -r "$hook" "$PROJECT_ROOT" --include="*.tsx" --include="*.ts" | head -1)
        if [ -n "$USAGE" ]; then
            echo "  - Example: \`${USAGE##*:}\`" >> "$HOOKS_FILE"
        fi
    done
fi

# Extract TODO/FIXME comments
echo "📝 Extracting TODOs and FIXMEs..."
TODO_FILE="$CONTEXT_OS_DIR/knowledge/todos.md"
echo "# TODOs and FIXMEs" > "$TODO_FILE"
echo "Generated: $(date)" >> "$TODO_FILE"
echo "" >> "$TODO_FILE"

grep -r "TODO\|FIXME" "$PROJECT_ROOT" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    --exclude-dir=node_modules --exclude-dir=.next \
    2>/dev/null | while read -r line; do
    FILE=$(echo "$line" | cut -d: -f1)
    COMMENT=$(echo "$line" | cut -d: -f2-)
    REL_FILE=$(realpath --relative-to="$PROJECT_ROOT" "$FILE")
    echo "- \`$REL_FILE\`: $COMMENT" >> "$TODO_FILE"
done

# Learn from test files
echo "🧪 Learning from tests..."
TEST_PATTERNS="$CONTEXT_OS_DIR/knowledge/patterns/testing.md"
echo "# Testing Patterns" > "$TEST_PATTERNS"
echo "" >> "$TEST_PATTERNS"

# Find describe blocks
find "$PROJECT_ROOT" -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | while read -r testfile; do
    DESCRIBES=$(grep -h "describe(" "$testfile" | sed "s/.*describe(['\"\`]\(.*\)['\"\`].*/\1/")
    if [ -n "$DESCRIBES" ]; then
        REL_FILE=$(realpath --relative-to="$PROJECT_ROOT" "$testfile")
        echo -e "\n## $REL_FILE" >> "$TEST_PATTERNS"
        echo "$DESCRIBES" | while read -r desc; do
            echo "- $desc" >> "$TEST_PATTERNS"
        done
    fi
done

# Update search index
echo "🔄 Rebuilding search index..."
"$CONTEXT_OS_DIR/bin/context-index" build

echo "✨ Auto-learning complete!"