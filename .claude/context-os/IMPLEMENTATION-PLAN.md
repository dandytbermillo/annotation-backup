# Context-OS Implementation Plan: Simple But Powerful

## Executive Summary

Transform Context-OS from a 15,000+ line enterprise system into a <500 line Unix-philosophy tool that actually gets used. This plan delivers 90% of the value with 1% of the complexity.

## Current State → Target State

### Current (Over-Engineered)
- 15,000+ lines of TypeScript
- 20+ npm dependencies
- Complex architecture with managers, providers, validators
- Requires documentation to understand
- Takes hours to set up

### Target (Simple But Powerful)
- <500 lines of vanilla JavaScript
- Zero npm dependencies
- Single-purpose tool that does one thing well
- Self-documenting through simplicity
- Works in 30 seconds

## Implementation Timeline: 3 Days Total

### Day 1: Demolition & Foundation (4 hours)

#### Morning (2 hours): Clean Slate
```bash
# 1. Backup current implementation
cp -r .claude/context-os .claude/context-os-backup-$(date +%Y%m%d)

# 2. Remove over-engineered code
rm -rf .claude/context-os/core/
rm -rf .claude/context-os/team/
rm -rf .claude/context-os/ci-cd/
rm -rf .claude/context-os/workflows/
rm -f .claude/context-os/package.json
rm -f .claude/context-os/package-lock.json

# 3. Keep only essentials
# Keep: README.md, project.md, current/, knowledge/
```

#### Afternoon (2 hours): Core Implementation
Create `.claude/context-os/context.js`:
```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration (hardcoded for simplicity)
const CONFIG = {
  maxTokens: 100000,
  contextFile: '.claude/context.md',
  includePatterns: ['*.md', '*.js', '*.ts', '*.json'],
  excludePatterns: ['node_modules', '.git', 'dist', 'build'],
  priorityFiles: ['README.md', 'project.md', 'current/*.md']
};

// Load context files
function loadContext() {
  const files = findFiles('.');
  const context = [];
  let totalSize = 0;
  
  // Priority files first
  for (const pattern of CONFIG.priorityFiles) {
    const matches = files.filter(f => minimatch(f, pattern));
    for (const file of matches) {
      const content = fs.readFileSync(file, 'utf8');
      context.push(`\n## ${file}\n\n${content}`);
      totalSize += content.length;
    }
  }
  
  // Other files
  for (const file of files) {
    if (totalSize > CONFIG.maxTokens) break;
    if (context.some(c => c.includes(file))) continue;
    
    const content = fs.readFileSync(file, 'utf8');
    if (totalSize + content.length > CONFIG.maxTokens) continue;
    
    context.push(`\n## ${file}\n\n${content}`);
    totalSize += content.length;
  }
  
  return context.join('\n');
}

// Find relevant files
function findFiles(dir) {
  // Use git ls-files if in git repo, otherwise walk directory
  try {
    const files = execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .filter(f => f && CONFIG.includePatterns.some(p => f.endsWith(p.slice(1))));
    return files;
  } catch {
    return walkDir(dir);
  }
}

// Simple directory walker
function walkDir(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (CONFIG.excludePatterns.some(p => fullPath.includes(p))) continue;
    
    if (entry.isDirectory()) {
      walkDir(fullPath, files);
    } else if (CONFIG.includePatterns.some(p => entry.name.endsWith(p.slice(1)))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Minimal pattern matching
function minimatch(file, pattern) {
  if (pattern.includes('*')) {
    const regex = pattern.replace(/\*/g, '.*');
    return new RegExp(regex).test(file);
  }
  return file.includes(pattern);
}

// Commands
const commands = {
  load: () => {
    const context = loadContext();
    console.log(context);
  },
  
  save: () => {
    const context = loadContext();
    fs.writeFileSync(CONFIG.contextFile, context);
    console.log(`Context saved to ${CONFIG.contextFile}`);
  },
  
  check: () => {
    const context = loadContext();
    const tokens = Math.round(context.length / 4); // Rough estimate
    console.log(`Files: ${context.split('\n## ').length - 1}`);
    console.log(`Size: ${(context.length / 1024).toFixed(1)}KB`);
    console.log(`Tokens: ~${tokens.toLocaleString()}`);
    if (tokens > CONFIG.maxTokens) {
      console.log(`Warning: Over token limit by ${tokens - CONFIG.maxTokens}`);
    }
  },
  
  files: () => {
    const files = findFiles('.');
    files.forEach(f => console.log(f));
  }
};

// Main
const cmd = process.argv[2] || 'load';
if (commands[cmd]) {
  commands[cmd]();
} else {
  console.log('Usage: context [load|save|check|files]');
  process.exit(1);
}
```

### Day 2: Intelligence & Integration (4 hours)

#### Morning (2 hours): Smart Context Selection
Create `.claude/context-os/hooks/prepare-commit-msg`:
```bash
#!/bin/sh
# Auto-update context on commit

# Update context file
node .claude/context-os/context.js save

# Add to commit if changed
if git diff --name-only | grep -q ".claude/context.md"; then
  git add .claude/context.md
fi
```

Create `.claude/context-os/smart-context.js`:
```javascript
#!/usr/bin/env node

// Smart context selection based on current work
const fs = require('fs');
const { execSync } = require('child_process');

function getSmartContext() {
  const context = {
    current: getCurrentWork(),
    recent: getRecentFiles(),
    related: getRelatedFiles(),
    errors: getRecentErrors()
  };
  
  return formatContext(context);
}

function getCurrentWork() {
  // Check git status for modified files
  try {
    const modified = execSync('git status --porcelain', { encoding: 'utf8' })
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.slice(3));
    
    return modified.map(file => {
      try {
        return {
          path: file,
          content: fs.readFileSync(file, 'utf8'),
          status: 'modified'
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function getRecentFiles() {
  // Get recently modified files
  try {
    const recent = execSync('find . -type f -mtime -1 -name "*.md" -o -name "*.js"', 
      { encoding: 'utf8' })
      .split('\n')
      .filter(f => f && !f.includes('node_modules'))
      .slice(0, 10);
    
    return recent.map(file => ({
      path: file,
      content: fs.readFileSync(file, 'utf8').slice(0, 1000) + '...'
    }));
  } catch {
    return [];
  }
}

function getRelatedFiles() {
  // Get files often changed together
  const current = getCurrentWork();
  if (current.length === 0) return [];
  
  const related = new Set();
  
  for (const file of current) {
    try {
      // Find files changed in same commits
      const commits = execSync(`git log --pretty=format:%H -- ${file.path} | head -5`, 
        { encoding: 'utf8' }).split('\n');
      
      for (const commit of commits) {
        const files = execSync(`git show --name-only --format= ${commit}`, 
          { encoding: 'utf8' }).split('\n').filter(f => f);
        files.forEach(f => related.add(f));
      }
    } catch {}
  }
  
  return Array.from(related).slice(0, 5).map(file => ({
    path: file,
    reason: 'frequently changed together'
  }));
}

function getRecentErrors() {
  // Check for error patterns in recent commits
  try {
    const errors = execSync('git log --grep="fix\\|error\\|bug" --oneline -10', 
      { encoding: 'utf8' }).split('\n').filter(line => line);
    
    return errors.map(line => {
      const [hash, ...message] = line.split(' ');
      return {
        commit: hash,
        message: message.join(' '),
        files: execSync(`git show --name-only --format= ${hash}`, 
          { encoding: 'utf8' }).split('\n').filter(f => f)
      };
    });
  } catch {
    return [];
  }
}

function formatContext(context) {
  let output = '# Smart Context\n\n';
  
  if (context.current.length > 0) {
    output += '## Current Work\n\n';
    context.current.forEach(file => {
      output += `### ${file.path} (${file.status})\n\`\`\`\n${file.content.slice(0, 500)}...\n\`\`\`\n\n`;
    });
  }
  
  if (context.recent.length > 0) {
    output += '## Recent Files\n\n';
    context.recent.forEach(file => {
      output += `- ${file.path}\n`;
    });
  }
  
  if (context.related.length > 0) {
    output += '\n## Related Files\n\n';
    context.related.forEach(file => {
      output += `- ${file.path} (${file.reason})\n`;
    });
  }
  
  if (context.errors.length > 0) {
    output += '\n## Recent Fixes\n\n';
    context.errors.forEach(error => {
      output += `- ${error.commit}: ${error.message}\n`;
      error.files.forEach(f => output += `  - ${f}\n`);
    });
  }
  
  return output;
}

// Main
console.log(getSmartContext());
```

#### Afternoon (2 hours): Claude Integration
Create `.claude/context-os/claude-helper.sh`:
```bash
#!/bin/bash
# Claude helper commands

# Function to load context
claude_context() {
  node .claude/context-os/context.js load
}

# Function to check before sending
claude_check() {
  node .claude/context-os/context.js check
}

# Function to get smart context
claude_smart() {
  node .claude/context-os/smart-context.js
}

# Function to update context file
claude_update() {
  node .claude/context-os/context.js save
  echo "Context updated in .claude/context.md"
}

# Aliases for common tasks
alias cc="claude_context"
alias ccheck="claude_check"
alias csmart="claude_smart"
alias cupdate="claude_update"

# Git hook installer
claude_install_hooks() {
  echo "Installing git hooks..."
  
  # Pre-commit: Check for secrets
  cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
# Check for secrets before commit

# Simple secret patterns
if git diff --cached --name-only | xargs grep -E "(aws_secret|api_key|password|private_key)" 2>/dev/null; then
  echo "⚠️  Possible secrets detected! Please review before committing."
  exit 1
fi

# Update context
node .claude/context-os/context.js save
EOF

  # Post-commit: Log context size
  cat > .git/hooks/post-commit << 'EOF'
#!/bin/sh
# Log context info after commit

echo "Context info:"
node .claude/context-os/context.js check
EOF

  chmod +x .git/hooks/pre-commit
  chmod +x .git/hooks/post-commit
  
  echo "✓ Git hooks installed"
}
```

### Day 3: Polish & Deployment (4 hours)

#### Morning (2 hours): Documentation & Testing
Create `.claude/context-os/README.md`:
```markdown
# Context-OS: Simple But Powerful

Context-OS provides intelligent context to Claude with zero configuration.

## Quick Start (30 seconds)

```bash
# Install
chmod +x .claude/context-os/context.js

# Use
.claude/context-os/context.js load     # Show context
.claude/context-os/context.js save     # Save to .claude/context.md
.claude/context-os/context.js check    # Check size/tokens
.claude/context-os/context.js files    # List included files
```

## Smart Context

```bash
# Get context based on current work
.claude/context-os/smart-context.js
```

## Shell Integration

```bash
# Add to ~/.bashrc or ~/.zshrc
source .claude/context-os/claude-helper.sh

# Then use:
cc        # Load context
ccheck    # Check tokens
csmart    # Smart context
cupdate   # Update context file
```

## Git Integration

```bash
# Install hooks for auto-update
source .claude/context-os/claude-helper.sh
claude_install_hooks
```

## How It Works

1. **Simple**: Just aggregates your project files into context
2. **Smart**: Prioritizes based on recent changes and current work
3. **Automatic**: Updates via git hooks
4. **Transparent**: Everything in plain text files

## Configuration

Edit CONFIG in context.js:
- `maxTokens`: Token limit (default: 100k)
- `includePatterns`: File patterns to include
- `excludePatterns`: Patterns to exclude
- `priorityFiles`: Files to include first

## Philosophy

- Do one thing well: Provide context to Claude
- Zero dependencies: Pure Node.js
- No configuration: Works out of the box
- Unix composable: Pipes and text output
- Git native: Uses git for intelligence

## Troubleshooting

**Too many tokens?**
- Adjust maxTokens in context.js
- Add more excludePatterns
- Use smart context for focused work

**Missing files?**
- Check includePatterns
- Verify files are tracked in git
- Remove from excludePatterns

**Performance slow?**
- Use git (it's faster than directory walking)
- Exclude large directories
- Reduce maxTokens

## Examples

```bash
# Load context for code review
cc | pbcopy  # Copy to clipboard

# Check before sending to Claude
ccheck

# Get focused context for current bug
csmart | head -100

# Auto-update on commits
cupdate && git add .claude/context.md && git commit -m "Update context"
```
```

#### Afternoon (2 hours): Testing & Optimization

Create `.claude/context-os/test.sh`:
```bash
#!/bin/bash
# Simple test suite

echo "Testing Context-OS..."

# Test 1: Basic functionality
echo -n "Test 1: Load command... "
if node .claude/context-os/context.js load > /dev/null; then
  echo "✓"
else
  echo "✗"
fi

# Test 2: Save command
echo -n "Test 2: Save command... "
if node .claude/context-os/context.js save; then
  echo "✓"
else
  echo "✗"
fi

# Test 3: Check command
echo -n "Test 3: Check command... "
if node .claude/context-os/context.js check | grep -q "Files:"; then
  echo "✓"
else
  echo "✗"
fi

# Test 4: Files command
echo -n "Test 4: Files command... "
if node .claude/context-os/context.js files > /dev/null; then
  echo "✓"
else
  echo "✗"
fi

# Test 5: Smart context
echo -n "Test 5: Smart context... "
if node .claude/context-os/smart-context.js > /dev/null; then
  echo "✓"
else
  echo "✗"
fi

# Test 6: File size check
echo -n "Test 6: Output size reasonable... "
SIZE=$(node .claude/context-os/context.js load | wc -c)
if [ $SIZE -lt 500000 ]; then
  echo "✓ (${SIZE} bytes)"
else
  echo "✗ (${SIZE} bytes - too large!)"
fi

echo "Testing complete!"
```

## Migration Guide

### For Existing Context-OS Users

1. **Backup current system**:
   ```bash
   cp -r .claude/context-os .claude/context-os-old
   ```

2. **Install simple version**:
   ```bash
   # Copy new files from this implementation plan
   ```

3. **Migrate data**:
   ```bash
   # Keep your project.md and knowledge files
   cp .claude/context-os-old/project.md .claude/context-os/
   cp -r .claude/context-os-old/knowledge .claude/context-os/
   ```

4. **Test**:
   ```bash
   .claude/context-os/test.sh
   ```

### For New Users

1. **Create directory**:
   ```bash
   mkdir -p .claude/context-os
   ```

2. **Copy implementation files**:
   - context.js
   - smart-context.js
   - claude-helper.sh
   - README.md

3. **Make executable**:
   ```bash
   chmod +x .claude/context-os/*.js
   chmod +x .claude/context-os/*.sh
   ```

4. **Run**:
   ```bash
   .claude/context-os/context.js check
   ```

## Success Metrics

### Immediate (Day 1)
- [ ] Core context.js working
- [ ] Under 100 lines of code
- [ ] Zero npm dependencies
- [ ] Loads context in <1 second

### Short-term (Week 1)
- [ ] Git hooks installed
- [ ] Smart context working
- [ ] Used daily without friction
- [ ] No bug reports

### Long-term (Month 1)
- [ ] Reduced from 15k to <500 lines
- [ ] 90% of old features in 10% of code
- [ ] Zero maintenance required
- [ ] Other projects adopting it

## Maintenance Plan

### What needs maintenance?
Almost nothing. That's the point.

### When to update?
- If Node.js fs/path APIs change (unlikely)
- If git command output format changes (very unlikely)
- If you want to add new file patterns

### How to extend?
- Add patterns to CONFIG
- Add new commands to commands object
- Keep it under 500 lines total

## Risk Mitigation

### Risk: Users want complex features back
**Mitigation**: Show them how to compose with Unix tools instead of building it in

### Risk: Large repos hit token limits
**Mitigation**: Smart context + better exclude patterns

### Risk: No npm means no updates
**Mitigation**: Feature, not bug. Stability over features.

## Final Notes

This implementation embodies Unix philosophy:
- Make each program do one thing well
- Expect the output to become input to another program
- Design and build software to be tried early
- Use tools in preference to unskilled help

Context-OS is now a tool, not a framework. It does one thing - provides context to Claude - and does it well. Everything else is composition with existing tools.

**Remember**: The best code is no code. The best feature is no feature. The best complexity is simplicity.

## Implementation Checklist

### Day 1
- [ ] Backup existing system
- [ ] Remove over-engineered code
- [ ] Implement context.js (<100 lines)
- [ ] Test basic functionality

### Day 2  
- [ ] Create smart-context.js
- [ ] Create claude-helper.sh
- [ ] Install git hooks
- [ ] Test integration

### Day 3
- [ ] Write README.md
- [ ] Create test suite
- [ ] Run performance tests
- [ ] Deploy to team

**Total effort: 12 hours over 3 days**

**Result: A tool that actually gets used.**