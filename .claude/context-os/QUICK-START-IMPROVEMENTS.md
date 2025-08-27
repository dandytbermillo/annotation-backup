# Quick Start Guide: Context-OS Smart Features

## 🚀 Get Started in 2 Minutes

### 1. First-Time Setup (Optional)
```bash
# Install git hooks for automatic usage tracking
.claude/context-os/hooks/install-usage-hooks.sh

# Build initial file index
.claude/context-os/bin/context reindex
```

### 2. Use Smart Context Loading
```bash
# Load context with all smart features enabled
.claude/context-os/bin/context load postgres

# Or specify options
.claude/context-os/bin/context load yjs --max-tokens 10000 --compress
```

### 3. Track Your Usage
```bash
# After making changes, track which files were useful
git add .
git commit -m "Implement feature"
# Usage tracking runs automatically if hooks installed

# Or manually track
.claude/context-os/bin/context track
```

### 4. View Your Improvements
```bash
# See how Context-OS is learning
.claude/context-os/bin/context stats --detailed
```

## 🎯 Common Use Cases

### Working on a Feature
```bash
# Load smart context for your feature
.claude/context-os/bin/context load "auth feature"

# Work on your code...

# Commit and let Context-OS learn
git commit -m "Add authentication"
```

### Debugging an Issue
```bash
# Load context focused on errors
.claude/context-os/bin/context load "error handling" --type errors

# Context-OS will prioritize error-related files and patterns
```

### Large Codebase Navigation
```bash
# Rebuild index for latest changes
.claude/context-os/bin/context reindex

# Load context with aggressive compression
.claude/context-os/bin/context load "api endpoints" --max-tokens 15000
```

## 📊 Understanding the Output

When you run `context stats`, you'll see:
- **File Index**: How many files are indexed and their total size
- **Usage Patterns**: Which files are most/least useful
- **Compression**: How much token savings you're getting

## 🔧 Troubleshooting

### "Index out of date"
```bash
.claude/context-os/bin/context reindex
```

### "No usage patterns yet"
Make some commits and track usage:
```bash
.claude/context-os/bin/context track
```

### "Context too large"
Use compression and lower token limit:
```bash
.claude/context-os/bin/context load pattern --compress --max-tokens 5000
```

## 💡 Pro Tips

1. **Let it Learn**: The more you use it, the better it gets at selecting relevant files
2. **Use Patterns**: Specific patterns like "postgres" work better than generic ones
3. **Check Stats**: Run `context stats` weekly to see improvements
4. **Compress Large Files**: Always use `--compress` for large codebases

## 🎉 That's It!

You're now using Context-OS with 40-60% better token efficiency and smarter file selection. The system will continue learning and improving as you work.