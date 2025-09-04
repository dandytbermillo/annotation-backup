# Context-OS Slash Commands Integration

**Version**: 1.0.0  
**Status**: ✅ IMPLEMENTED  
**Purpose**: Enable Claude Code's built-in agent to orchestrate Context-OS via slash commands

## 🎯 Overview

Context-OS now supports slash commands that can be used directly in Claude Code. When you type `/execute` or `/fix`, Claude's built-in agent routes the command to our custom JavaScript/TypeScript agents, providing a seamless workflow for documentation-compliant feature development.

## 🚀 Quick Start

```bash
# Create a new feature
/execute "Add user authentication" --plan drafts/auth.md

# Fix a validation issue
/fix --feature user_auth --issue "Missing phase boundary" 

# Validate structure
/validate user_auth --strict

# Check feature status
/status user_auth
```

## 📝 Available Commands

### `/execute` - Create and Scaffold Features

Creates a new feature with compliant documentation structure.

**Syntax:**
```
/execute "Feature name" [options]
```

**Options:**
- `--plan <path>` - Path to draft plan (in context-os/drafts/)
- `--slug <slug>` - Pre-select a specific slug
- `--confirm false` - Skip confirmation (for automation)

**Example:**
```bash
# Basic usage
/execute "Add dark mode toggle"

# With existing draft
/execute "Add dark mode" --plan context-os/drafts/dark-mode.md

# With specific slug
/execute "Dark Mode" --slug dark_mode_v2
```

**What happens:**
1. Shows 3 slug suggestions (or uses provided slug)
2. Validates the plan for required fields
3. Creates directory structure at `docs/proposal/<slug>/`
4. Runs validation to ensure compliance
5. Returns created files and validation status

### `/fix` - Create Post-Implementation Fixes

Creates a fix document for issues in completed features.

**Syntax:**
```
/fix --feature <slug> --issue "Description" [options]
```

**Options:**
- `--severity` - CRITICAL|HIGH|MEDIUM|LOW
- `--perf <0-100>` - Performance degradation percentage
- `--users <0-100>` - Users affected percentage  
- `--env <env>` - Environment (prod/staging/dev)
- `--dry-run` - Preview without creating files

**Example:**
```bash
# Basic fix
/fix --feature dark_mode --issue "Toggle not persisting"

# With severity and metrics
/fix --feature dark_mode --issue "Memory leak" --severity HIGH --perf 30 --users 15

# Dry run to preview
/fix --feature dark_mode --issue "CSS conflict" --dry-run
```

**What happens:**
1. Classifies issue severity automatically
2. Determines issue type (bug/performance/security/UX)
3. Routes to correct severity directory
4. Creates pre-filled fix document
5. Updates post-implementation-fixes/README.md
6. Provides workflow recommendations

### `/validate` - Check Documentation Compliance

Validates feature structure against Documentation Process Guide.

**Syntax:**
```
/validate [feature] [options]
```

**Options:**
- `--strict` - Treat warnings as errors
- `--all` - Validate all features

**Example:**
```bash
# Validate specific feature
/validate dark_mode

# Strict validation for CI
/validate dark_mode --strict

# Validate everything
/validate --all
```

**What happens:**
1. Runs validate-doc-structure.sh
2. Checks all 8 documentation rules
3. Reports errors and warnings
4. Returns structured results

### `/status` - Check Feature Status

Shows current status of features.

**Syntax:**
```
/status [feature]
```

**Example:**
```bash
# Check specific feature
/status dark_mode

# List all COMPLETE features
/status
```

## 🔄 Command Flow Architecture

```
User Types Command
      ↓
Claude Built-in Agent (Router)
      ↓
command-router.js (Parser)
      ↓
NPM Scripts (package.json)
      ↓
CLI Wrappers (cli/*.js)
      ↓
Core Agents (*.js/*.ts)
      ↓
JSON Response
      ↓
Claude Renders Result
```

## 📦 File Structure

```
context-os/
├── command-router.js       # Main command parser/router
├── cli/
│   ├── execute-cli.js     # /execute handler
│   ├── fix-cli.js         # /fix handler
│   └── validate-cli.js    # /validate handler
├── agents/
│   ├── classifier-agent.js # Issue classification
│   └── ...
├── create-feature.js       # Core feature creation
├── fix-workflow.js         # Fix management
└── status-enforcer.js      # Status checking
```

## 🔧 NPM Scripts

Added to package.json:
```json
{
  "scripts": {
    "context:execute": "node context-os/cli/execute-cli.js",
    "context:fix": "node context-os/cli/fix-cli.js",
    "context:validate": "node context-os/cli/validate-cli.js",
    "context:classify": "node context-os/agents/classifier-agent.js",
    "context:status": "node context-os/status-enforcer.js",
    "doc:validate": "bash scripts/validate-doc-structure.sh",
    "doc:validate:strict": "bash scripts/validate-doc-structure.sh --strict"
  }
}
```

## 📊 JSON Input/Output Contract

### Execute Input
```json
{
  "feature": "Feature name",
  "plan": "path/to/plan.md",
  "slug": "optional_slug",
  "autoConfirm": true
}
```

### Execute Output
```json
{
  "ok": true,
  "command": "execute",
  "result": {
    "feature": "Feature name",
    "slug": "feature_slug",
    "path": "../docs/proposal/feature_slug",
    "created": ["list", "of", "files"],
    "validation": {
      "passed": true,
      "errors": 0,
      "warnings": 0
    }
  }
}
```

### Fix Input
```json
{
  "feature": "feature_slug",
  "issue": "Issue description",
  "severity": "HIGH",
  "metrics": {
    "performanceDegradation": 30,
    "usersAffected": 15
  },
  "environment": "prod",
  "dryRun": false
}
```

### Fix Output
```json
{
  "ok": true,
  "command": "fix",
  "result": {
    "feature": "feature_slug",
    "classification": {
      "severity": "HIGH",
      "type": "PERFORMANCE",
      "icon": "🟠",
      "sla": "Within 24 hours",
      "workflow": "performance-fix",
      "recommendations": ["..."]
    },
    "fixPath": "path/to/fix.md",
    "created": true
  }
}
```

## 🎨 Output Rendering

Claude's agent will render results as cards:

### Success Card
```
✅ Feature workspace created successfully!

📁 Location: docs/proposal/dark_mode/
📄 Created: 15 files
📋 Validation: PASSED

Next steps:
1. cd docs/proposal/dark_mode
2. Review implementation.md
3. Update status to IN PROGRESS
```

### Fix Card
```
✅ Fix created successfully!

📊 Classification:
  Severity: 🟠 HIGH
  Type: PERFORMANCE
  SLA: Within 24 hours
  
💡 Recommendations:
  - Profile and measure impact
  - Add performance tests
  
📄 Fix document: .../high/2025-09-04-memory-leak.md
```

## 🔒 Safety Features

1. **Dry Run Mode**: Preview changes without creating files
2. **Auto Confirmation**: Can be disabled for interactive mode
3. **JSON Only**: Clean separation between stdout (JSON) and stderr (logs)
4. **Exit Codes**: 0 for success, non-zero for failure
5. **Validation**: Automatic structure validation after creation

## 🚦 CI/CD Integration

```bash
# In CI pipeline
npm run context:execute -- '{"feature":"New Feature","autoConfirm":true}'
npm run doc:validate:strict
```

## 🐛 Troubleshooting

### "Command not found"
- Ensure you're in the project root
- Check that npm scripts are added to package.json

### "Feature not found"
- Feature slug must exist in docs/proposal/
- Use exact slug from directory name

### "JSON parse error"
- CLI wrappers output JSON only to stdout
- Debug logs go to stderr
- Use `--silent` flag with npm run

### "Validation failed"
- Run `/validate <feature>` to see specific issues
- Use `/fix` to auto-remediate common problems

## 🎯 Best Practices

1. **Always validate after changes**: `/validate <feature>`
2. **Use drafts folder**: Keep plans in `context-os/drafts/`
3. **Classify fixes properly**: Provide metrics for accurate classification
4. **Review before applying**: Use `--dry-run` first
5. **Keep status current**: Update to IN PROGRESS when starting

## 📈 Workflow Examples

### Complete Feature Workflow
```bash
# 1. Create draft
echo "# My Feature" > context-os/drafts/my-feature.md

# 2. Scaffold feature
/execute "My Feature" --plan context-os/drafts/my-feature.md

# 3. Start implementation
# (Update status to IN PROGRESS in implementation.md)

# 4. Validate structure
/validate my_feature

# 5. Fix any issues
/fix --feature my_feature --issue "Validation errors"

# 6. Mark complete when done
# (Update status to COMPLETE)
```

### Fix Workflow
```bash
# 1. Issue reported
/fix --feature my_feature --issue "Button not working" --env prod

# 2. Classification shows HIGH severity

# 3. Edit fix document with solution

# 4. Validate compliance
/validate my_feature --strict

# 5. Deploy fix
```

## 🔮 Future Enhancements

### Core Commands
- [ ] `/plan` - Interactive plan creation wizard
- [ ] `/migrate` - Migrate existing features to compliant structure
- [ ] `/archive` - Archive completed features
- [ ] `/report` - Generate status reports
- [ ] `/rollback` - Revert feature to previous state

### ⚠️ Advanced Enhancements

| Area | Recommendation | Impact |
|------|---------------|--------|
| 🔁 **Feedback Learning** | Add persistent pattern memory or cache: remember what Claude gets right/wrong | Improves accuracy over time, reduces repeat errors |
| 📉 **Budget Reporting UI** | Visual indicator in CLI or dashboard: how many tokens used/saved | Better cost visibility and optimization |
| 🤝 **Agent Collaboration Preview** | Provide "dry-run summary" of hybrid workflows before confirmation | Reduces surprises, increases user confidence |
| 🧠 **Semantic Pre-checks** | Run a mini classifier before invoking Claude to validate relevance | Saves tokens by avoiding unnecessary Claude calls |
| 📦 **Plugin-like Claude Tasks** | Allow user to inject their own Claude sub-agent configs/tools per repo or project | Enables project-specific workflows and tools |

### Implementation Priority

1. **🧠 Semantic Pre-checks** (High ROI, Low Complexity)
   - Quick win for token savings
   - Can use simple regex/keyword matching initially
   
2. **📉 Budget Reporting UI** (High Value, Medium Complexity)
   - Critical for production usage
   - Could start with simple text report
   
3. **🤝 Agent Collaboration Preview** (Medium Value, Medium Complexity)
   - Builds user trust
   - Natural extension of existing dry-run mode
   
4. **🔁 Feedback Learning** (High Value, High Complexity)
   - Long-term improvement
   - Needs persistent storage design
   
5. **📦 Plugin-like Claude Tasks** (Medium Value, High Complexity)
   - Most flexible but requires significant architecture
   - Could start with config files

## 📄 License

Part of the annotation-backup project.