# Claude Integration Examples

This document shows practical examples of using Context-OS with Claude.

## Example 1: Loading Context for a Specific Task

### Step 1: Generate task-specific context
```bash
# For implementing Postgres persistence
node .claude/context-os/context-loader.js task "implement postgres persistence" > context.md
```

### Step 2: Create your prompt with context
```markdown
I need help implementing Postgres persistence for this YJS-based annotation system.

Here's the relevant context:

[PASTE CONTENTS OF context.md HERE]

Specifically, I need to:
1. Create database migrations for storing YJS documents
2. Implement a persistence adapter that syncs YJS updates to Postgres
3. Ensure the solution works with both web and Electron platforms

Please provide implementation guidance following the patterns shown in the context.
```

## Example 2: Debugging with Context

### Step 1: Search for similar issues
```bash
.claude/context-os/bin/context search "connection error postgres" > similar-issues.md
```

### Step 2: Generate debugging context
```bash
node .claude/context-os/context-loader.js task "debug postgres connection" > debug-context.md
```

### Step 3: Create debugging prompt
```markdown
I'm experiencing Postgres connection timeouts in production.

Error: Connection terminated unexpectedly

Here's the debugging context and similar issues:

[PASTE debug-context.md]

[PASTE similar-issues.md]

The error occurs when multiple YJS documents try to sync simultaneously.
How should I fix this?
```

## Example 3: Architecture Decision

### Step 1: Load architecture context
```bash
.claude/context-os/bin/context load -t patterns -o patterns.md
.claude/context-os/bin/context load -t decisions -o decisions.md
```

### Step 2: Create architecture prompt
```markdown
I need to make an architecture decision about state management.

Current architecture context:

[PASTE patterns.md]

Previous decisions:

[PASTE decisions.md]

Should I:
A) Use Redux for global state management
B) Stick with React Context + YJS for all state
C) Hybrid approach with Zustand for UI state and YJS for document state

Please analyze based on our existing patterns.
```

## Example 4: Quick Context Summary

### For a quick question
```bash
# Generate minimal context
node .claude/context-os/context-loader.js minimal > quick-context.md
```

```markdown
Quick question about our YJS setup:

[PASTE quick-context.md]

How do I access the YJS document from a React component?
```

## Example 5: Full Context Dump

### When starting a complex feature
```bash
# Generate full context
node .claude/context-os/context-loader.js full > full-context.md

# Also extract current work
.claude/context-os/bin/context extract
```

```markdown
I'm starting work on a major feature: real-time collaborative cursors.

Here's the complete project context:

[PASTE full-context.md]

Current work in progress:
[PASTE .claude/context-os/current/extracted.md]

Please help me plan the implementation approach considering:
1. Our existing YJS architecture
2. Current awareness system
3. Performance requirements
4. Both web and Electron platforms
```

## Pro Tips

### 1. Context-First Prompting
Always load context BEFORE writing your question. This helps you:
- Understand what's already implemented
- Use consistent terminology
- Reference specific files/patterns

### 2. Incremental Context
Start with minimal context and add more if needed:
```bash
# Start minimal
node .claude/context-os/context-loader.js minimal > context.md

# If Claude needs more info, add specific context
.claude/context-os/bin/context search "specific topic" >> context.md
```

### 3. Learn from Claude's Solutions
After implementing Claude's suggestions:
```bash
# Record the solution
.claude/context-os/bin/context learn "Problem description" -s "Claude's solution"

# This helps future queries!
```

### 4. Automated Context in Git Commits
The git hooks automatically capture context, so your commits become searchable knowledge:
```bash
git commit -m "fix: Postgres connection timeout

// DECISION: Increased pool size to handle concurrent YJS doc syncs"
```

### 5. Pre-made Context Templates
Create templates for common tasks:
```bash
# Save common contexts
node .claude/context-os/context-loader.js task "postgres" > .claude/context-os/templates/postgres-context.md
node .claude/context-os/context-loader.js task "yjs" > .claude/context-os/templates/yjs-context.md
node .claude/context-os/context-loader.js task "testing" > .claude/context-os/templates/testing-context.md

# Reuse them
cat .claude/context-os/templates/postgres-context.md > prompt.md
echo "My specific question..." >> prompt.md
```

## Context Loading Strategies

### Strategy 1: Breadth-First (for exploration)
```bash
.claude/context-os/bin/context summarize > context.md
```

### Strategy 2: Depth-First (for specific features)
```bash
.claude/context-os/bin/context load "specific-file-pattern" > context.md
```

### Strategy 3: Historical (for understanding decisions)
```bash
.claude/context-os/bin/context load -t decisions > context.md
.claude/context-os/bin/context load -t errors >> context.md
```

### Strategy 4: Search-Driven (for similar problems)
```bash
.claude/context-os/bin/context search "your problem keywords" > context.md
```

Remember: The more relevant context you provide, the better Claude's responses will be!