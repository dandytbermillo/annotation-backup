# How /context-execute Works with Interactive INITIAL.md

## Overview

The `/context-execute` command has two modes:
1. **Interactive Mode** - Creates INITIAL.md using the interactive system
2. **Standard Mode** - Creates feature structure directly (legacy)

## The --interactive Flag Flow

When you use `/context-execute <feature> --interactive`, here's what happens:

```
User Input                         System Process
──────────                        ──────────────
/context-execute                   → context-execute.sh
"My Feature"                       → Parse arguments
--interactive                      → Detect --interactive flag
                                  ↓
                                  context-os/cli/execute-cli.js
                                  ↓
                                  Checks for --interactive flag
                                  ↓
                                  DELEGATES TO →
                                  ↓
                                  context-os/cli/init-interactive.js
                                  ↓
                                  Creates INITIAL.md
                                  ↓
                                  Returns to execute-cli
                                  ↓
                                  Returns success JSON
```

## Usage Examples

### 1. Interactive Creation (Recommended)

```bash
# Using /context-execute with interactive flag
/context-execute "Dark Mode Feature" --interactive

# This is equivalent to:
/context-init dark_mode_feature
```

### 2. Batch Mode for CI/CD

```bash
# No prompts, uses defaults
/context-execute "API Gateway" --interactive --batch-mode --apply

# Creates INITIAL.md with:
# - Default severity: medium
# - Standard goals and criteria
# - Auto-generated content
```

### 3. With Custom Slug

```bash
/context-execute "User Authentication" --interactive --slug auth_v2

# Creates: docs/proposal/auth_v2/INITIAL.md
```

### 4. Dry Run Mode

```bash
/context-execute "Payment System" --interactive --dry-run

# Shows preview without creating files
```

## How the Delegation Works

### Step 1: Execute CLI Detects --interactive

```javascript
// context-os/cli/execute-cli.js
async function execute(input) {
  // Check for --interactive flag
  if (input.interactive || input.initOnly) {
    console.log('Delegating to Interactive INITIAL.md creation...');
    
    // Build arguments for init-interactive
    const initArgs = ['node', 'init-interactive.js', featureSlug];
    if (input.apply) initArgs.push('--apply');
    if (input.batchMode) initArgs.push('--batch-mode');
    
    // Spawn init-interactive process
    const init = spawn(initArgs[0], initArgs.slice(1));
  }
}
```

### Step 2: Init-Interactive Takes Over

```javascript
// context-os/cli/init-interactive.js
async function main() {
  // In batch mode, use defaults
  if (flags.batchMode) {
    spec = {
      title: `Feature: ${featureSlug}`,
      problem: 'Default problem statement...',
      goals: ['Goal 1', 'Goal 2', 'Goal 3'],
      // ... other defaults
    };
  } else {
    // Interactive prompts with Claude or manual fallback
    const claudeResponse = await invokeClaudeInit(featureSlug);
  }
  
  // Create INITIAL.md
  const md = await renderInitial(spec);
  await fs.writeFile(initialPath, md);
}
```

### Step 3: Return Control

```javascript
// Returns JSON result
{
  "ok": true,
  "command": "execute",
  "result": {
    "feature": "test_execute_demo",
    "created": ["docs/proposal/test_execute_demo/INITIAL.md"],
    "validation": {"passed": true, "errors": 0},
    "interactive": true
  }
}
```

## Command Line Interface

### Direct CLI Usage

```bash
# JSON input mode (for automation)
echo '{"feature":"My Feature","interactive":true,"batchMode":true}' | \
  node context-os/cli/execute-cli.js

# Response:
# {"ok":true,"result":{"created":["docs/proposal/my_feature/INITIAL.md"]}}
```

### Slash Command Usage

```bash
# Standard interactive creation
/context-execute "Feature Name" --interactive

# With all options
/context-execute "Feature Name" \
  --interactive \
  --batch-mode \
  --apply \
  --slug custom_slug
```

## Flags Reference

| Flag | Purpose | Example |
|------|---------|---------|
| `--interactive` | Use init-interactive system | `/context-execute "X" --interactive` |
| `--batch-mode` | No prompts, use defaults | `--interactive --batch-mode` |
| `--apply` | Skip confirmation | `--interactive --apply` |
| `--dry-run` | Preview only | `--interactive --dry-run` |
| `--slug` | Custom feature slug | `--slug my_custom_slug` |
| `--resume` | Continue interrupted | `--interactive --resume` |
| `--migrate` | Upgrade existing | `--interactive --migrate` |

## Decision Flow

```mermaid
graph TD
    A[/context-execute] --> B{Has --interactive?}
    B -->|Yes| C[Delegate to init-interactive.js]
    B -->|No| D[Use legacy orchestrator]
    
    C --> E{Batch mode?}
    E -->|Yes| F[Use defaults]
    E -->|No| G{Claude available?}
    
    G -->|Yes| H[Claude guided creation]
    G -->|No| I[Manual wizard fallback]
    
    F --> J[Create INITIAL.md]
    H --> J
    I --> J
    
    J --> K[Validate sections]
    K --> L[Log telemetry]
    L --> M[Return success JSON]
```

## Benefits of Using --interactive

1. **Guaranteed Compliance**: All required sections included
2. **Schema Validation**: Zod validation ensures correctness
3. **Telemetry Tracking**: Automatic metrics collection
4. **Session Recovery**: Can resume interrupted sessions
5. **Fallback Support**: Works even without Claude API
6. **CI/CD Ready**: Batch mode for automation

## Testing the Flow

### Test 1: Basic Interactive
```bash
/context-execute "Test Feature" --interactive --apply
# Creates: docs/proposal/test_feature/INITIAL.md
```

### Test 2: Verify Delegation
```bash
# Watch the output for "Delegating to Interactive INITIAL.md creation..."
/context-execute "Debug Test" --interactive --dry-run
```

### Test 3: Check Telemetry
```bash
# After creation, check telemetry
tail -n 1 logs/init-telemetry.jsonl | jq .
# Should show: {"sessionId":"...","feature":"debug_test","outcome":"success"}
```

### Test 4: Validate Result
```bash
# Validate the created file
node scripts/validate-initial-sections.js --feature test_feature --json
# Should show: {"ok":true,"status":"pass"}
```

## Common Scenarios

### Scenario 1: New Feature Development
```bash
# Developer wants to start a new feature
/context-execute "Shopping Cart Refactor" --interactive

# System:
# 1. Delegates to init-interactive
# 2. Creates INITIAL.md with all sections
# 3. Validates automatically
# 4. Returns path to created file
```

### Scenario 2: CI Pipeline
```bash
# Automated feature creation in CI
/context-execute "$FEATURE_NAME" \
  --interactive \
  --batch-mode \
  --apply \
  --slug "$FEATURE_SLUG"

# No human interaction needed
# Uses sensible defaults
# Logs telemetry for tracking
```

### Scenario 3: Migration of Old Features
```bash
# Upgrade existing feature to new format
/context-execute "Legacy Feature" \
  --interactive \
  --migrate \
  --batch-mode

# Updates existing INITIAL.md to v1.0.0 schema
```

## Troubleshooting

### Issue: Command not delegating
**Solution**: Ensure --interactive flag is included
```bash
# Wrong
/context-execute "Feature"

# Right
/context-execute "Feature" --interactive
```

### Issue: Prompts appearing in CI
**Solution**: Add --batch-mode flag
```bash
/context-execute "Feature" --interactive --batch-mode --apply
```

### Issue: Wrong slug generated
**Solution**: Specify custom slug
```bash
/context-execute "My Complex Feature!" --interactive --slug my_feature
```

## Summary

The `/context-execute --interactive` command provides a seamless way to create compliant INITIAL.md files by delegating to the interactive creation system. This ensures:

- ✅ All required sections present
- ✅ Proper validation
- ✅ Telemetry tracking
- ✅ Consistent format
- ✅ CI/CD compatibility

**One command, two entry points, same reliable result!**