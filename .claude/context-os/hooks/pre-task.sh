#!/bin/bash
# Pre-task hook - Run before starting a new task

echo "🚀 Starting new task..."

# Archive previous active task if exists
if [ -f ".claude/context-os/current/active.md" ]; then
    timestamp=$(date +%Y%m%d-%H%M%S)
    task_name=$(grep -m 1 "^# " .claude/context-os/current/active.md | sed 's/# Current Task: //' | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
    archive_name="${timestamp}-${task_name}.md"
    
    echo "📦 Archiving current task to: $archive_name"
    mv .claude/context-os/current/active.md ".claude/context-os/current/.archived/${archive_name}"
fi

# Ensure environment is ready
echo "✅ Checking environment..."

# Check if postgres is running
if docker compose ps postgres | grep -q "running"; then
    echo "✅ PostgreSQL is running"
else
    echo "⚠️  PostgreSQL is not running. Start with: docker compose up -d postgres"
fi

# Run validation gates
echo "🔍 Running validation gates..."
npm run lint --silent
npm run type-check --silent

# Update knowledge index
echo "📚 Updating knowledge index..."
# This would normally run a script to rebuild the index
# For now, just touch the file to update timestamp
touch .claude/context-os/knowledge/index.md

echo "✅ Ready to start new task!"