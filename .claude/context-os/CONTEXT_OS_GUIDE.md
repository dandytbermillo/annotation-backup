# Context OS - The Most Powerful Context Engineering System

## Overview
Context OS is an adaptive context management system that transforms how Claude Code understands and works with your codebase. It combines the best ideas from powerful-context-engineering.md with Claude Code's native capabilities.

## Core Innovation: Progressive Complexity
- **Start Simple**: 3 files, immediate value
- **Scale Naturally**: Structure emerges as needed
- **Stay Powerful**: Full features when you need them

## How It Works

### 1. Automatic Context Loading
Claude Code automatically loads the right context based on:
- What you're working on
- Recent errors or issues
- File patterns
- Keywords in your request

Example: When you say "fix the YJS sync error", Claude automatically loads:
- Current task context
- YJS integration patterns
- Common YJS errors
- Recent debugging notes

### 2. Knowledge That Compounds
Every problem solved becomes future context:
```bash
# After fixing an issue
/context learn "YJS binary can't be parsed as JSON - use Y.Doc methods"

# Automatically categorized and indexed for future use
```

### 3. Smart Token Management
- Budget: 8000 tokens default
- Priority loading based on relevance
- Automatic trimming of less relevant content
- Current task gets 35% of budget

### 4. Integration with PRPs
When executing PRPs, Context OS:
- Loads relevant patterns
- Checks previous errors
- Includes architecture decisions
- References similar implementations

## Quick Usage Guide

### Starting a New Task
```bash
# Automatic - just describe what you're doing
"I need to fix the PostgreSQL sync issues"

# Context OS loads:
# - Current task (Phase 2B work)
# - PostgreSQL patterns
# - Recent sync errors
# - Architecture decisions about sync
```

### Learning from Work
```bash
# Quick capture
/context learn "PostgreSQL: Connection pooling prevents timeout issues"

# With category
/context learn "Always use prepared statements" --category=patterns
```

### Searching Knowledge
```bash
# Search everything
/context search "connection pool"

# Category-specific
/context search "error:timeout"
/context search "pattern:yjs"
```

### Task Management
```bash
# Start new task (auto-archives previous)
/context task new "Implement admin dashboard"

# Complete task
/context task complete

# Switch tasks
/context task switch "admin-dashboard"
```

## File Structure Explained

### `.claude/context-os/project.md`
Core project context - architecture, conventions, key components. Keep under 150 lines.

### `.claude/context-os/current/active.md`
What you're currently working on. Auto-archived when done.

### `.claude/context-os/knowledge/`
- `patterns/` - Reusable solutions
- `errors/` - Problems & fixes
- `decisions/` - Why we chose X over Y
- `learned.md` - Quick notes before categorization

### `.claude/context-os/rules/`
Smart loading rules:
- `default.json` - Standard patterns
- `custom.json` - Project-specific rules

## Advanced Features

### Custom Loading Rules
Add to `custom.json`:
```json
{
  "name": "my_feature",
  "when": {
    "keywords": ["myfeature", "special"],
    "filePattern": "**/myfeature/**"
  },
  "load": [
    "docs/myfeature-guide.md",
    "knowledge/patterns/myfeature.md"
  ],
  "priority": 85
}
```

### Hooks for Automation
- `pre-task.sh` - Archive previous work, check environment
- `post-task.sh` - Extract learnings, run tests

### Team Collaboration
- Git-friendly structure
- Knowledge sharing through commits
- Branch-specific contexts
- Conflict-free merging

## Why This Is Powerful

### 1. Zero Configuration Start
Just start working. System learns and adapts.

### 2. Contextual Intelligence
Claude always has the right context without you managing it.

### 3. Knowledge Accumulation
Every bug fixed, pattern discovered, decision made - all becomes searchable context.

### 4. Performance Optimized
- Cached context loading
- Smart token budgeting
- Priority-based inclusion

### 5. Real Integration
Not just files - actual Claude Code integration with commands and automation.

## Metrics That Matter
- **Context Load Time**: < 2 seconds
- **Relevant Context Hit Rate**: > 90%
- **Knowledge Reuse**: > 60%
- **Manual Context Management**: ~0%

## Getting Started
1. Structure is already created
2. Start working normally
3. Use `/context learn` when you discover something
4. Let the system grow with your project

## Tips for Maximum Power

### 1. Capture Learnings Immediately
```bash
# Right after fixing something
/context learn "The fix that worked"
```

### 2. Use Descriptive Task Names
```bash
# Good
"Implement PostgreSQL sync with retry logic"

# Less Good  
"Fix sync"
```

### 3. Review and Refactor Knowledge
- Monthly: Review `learned.md` and categorize
- Quarterly: Merge similar patterns
- Yearly: Archive outdated knowledge

### 4. Trust the System
- Don't manually manage context files
- Let auto-organization happen
- Use search instead of browsing

## Troubleshooting

### "Context seems irrelevant"
- Check `rules/custom.json` for conflicts
- Run `/context status` to see what's loaded
- Adjust priorities in rules

### "Too much context loaded"
- Lower `maxTotalTokens` in rules
- Archive old tasks
- Split large knowledge files

### "Can't find old knowledge"
- Use `/context search` with different terms
- Check if it's been archived
- Rebuild index with `/context rebuild`

## The Power Balance
This system is powerful because it:
- **Starts simple** - No setup required
- **Grows smart** - Learns from your work
- **Stays fast** - Optimized for performance
- **Works naturally** - No new workflows to learn

Start simple. Build knowledge. Work faster.