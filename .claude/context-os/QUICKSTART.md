# Context-OS Quick Start Guide

Context-OS is a powerful context management system that runs entirely within `.claude/context-os`. It provides CLI tools, automation, and intelligent context loading for development.

## Installation

```bash
cd .claude/context-os
npm install
./setup.sh
```

## Core Commands

### 1. Search Knowledge Base
```bash
# Search for anything in your knowledge base
context search "postgres migration"
context search "yjs patterns"
context search "error handling"
```

### 2. Load Context for Claude
```bash
# Load context for specific task
context load postgres > context.md

# Generate task-specific context
node context-loader.js task "implement postgres persistence" > task-context.md

# Load minimal context
node context-loader.js minimal > minimal-context.md

# Load full context dump
node context-loader.js full > full-context.md
```

### 3. Auto-Watch Project Changes
```bash
# Start the watcher daemon
context watch --daemon

# Stop the watcher
context stop
```

### 4. Extract Current Work Context
```bash
# Extract from current git changes
context extract

# Extract from specific commit
context extract -c HEAD~1
```

### 5. Learn from Errors
```bash
# Record an error and solution
context learn "YDoc not syncing to Postgres" -s "Added await to sync operation"
```

### 6. Generate Context Summary
```bash
# General summary
context summarize

# Focused summary
context summarize -f postgres
context summarize -f yjs
```

## Automation Features

### Git Hooks (Auto-installed)
- **Pre-commit**: Analyzes staged changes, suggests commit messages
- **Post-commit**: Records patterns, decisions, updates knowledge base

### File Watcher
Watches project files and automatically:
- Extracts patterns from code
- Records architecture decisions (marked with `// DECISION:`)
- Updates current work context
- Tracks file modifications

### Auto-Learning
Run periodically to extract knowledge:
```bash
./workflows/auto-learn.sh
```

## Practical Examples

### Example 1: Starting Work on Postgres Feature
```bash
# 1. Load relevant context
context search postgres > postgres-context.md
node context-loader.js task "postgres persistence" > task-context.md

# 2. Start watching for changes
context watch --daemon

# 3. Work on your feature...

# 4. Before committing, extract context
context extract
```

### Example 2: Debugging an Issue
```bash
# 1. Search for similar issues
context search "connection error"

# 2. Load debugging context
node context-loader.js task "fix connection issues" > debug-context.md

# 3. After fixing, record the solution
context learn "Postgres connection timeout" -s "Increased pool timeout to 30s"
```

### Example 3: Preparing Context for Claude
```bash
# For a specific task
echo "Task: Implement Postgres persistence layer" > claude-prompt.md
echo "" >> claude-prompt.md
node context-loader.js task "postgres persistence" >> claude-prompt.md

# For general work
context summarize > claude-context.md
```

## Directory Structure

```
.claude/context-os/
├── bin/                    # Executable CLI tools
│   ├── context            # Main CLI
│   ├── context-index      # Search indexer
│   └── context-hook       # Git hook handler
├── knowledge/             # Knowledge base
│   ├── patterns/          # Code patterns
│   ├── errors/            # Errors and solutions
│   ├── decisions/         # Architecture decisions
│   └── learned.md         # Learned lessons
├── current/               # Current work context
│   ├── active.md          # Active work
│   └── extracted.md       # Extracted context
├── indexes/               # Search indexes
└── workflows/             # Automation scripts
```

## Tips

1. **Mark Decisions in Code**: Use `// DECISION:` comments to auto-capture architecture decisions
2. **Regular Learning**: Run `./workflows/auto-learn.sh` weekly to keep knowledge current
3. **Context Before Claude**: Always generate context before asking Claude questions
4. **Commit Patterns**: The system learns from your commit messages - be descriptive!

## Advanced Usage

### Custom Rules
Edit `rules/custom.json` to define project-specific patterns:
```json
{
  "patterns": {
    "database": ["postgres", "pg", "sql", "migration"],
    "collaboration": ["yjs", "crdt", "sync", "awareness"]
  },
  "autoTag": {
    "files": {
      "*/migrations/*": ["database", "schema"],
      "*/lib/sync/*": ["collaboration", "yjs"]
    }
  }
}
```

### Extending the System
Add new commands by creating scripts in `bin/` directory. The context CLI will automatically recognize them.

## Troubleshooting

- **Index not found**: Run `context-index build`
- **Watcher not starting**: Check if port is already in use with `context stop`
- **Git hooks not working**: Re-run `./setup.sh`

## Power Features

1. **Semantic Search**: Uses Fuse.js for fuzzy searching across all knowledge
2. **Auto-categorization**: Files are automatically categorized by location and content
3. **Pattern Extraction**: Automatically extracts usage patterns from code
4. **Commit Intelligence**: Learns from commit messages and changes
5. **Context Optimization**: Generates Claude-optimized context with proper formatting

Remember: Everything stays within `.claude/context-os` - no system-wide changes!