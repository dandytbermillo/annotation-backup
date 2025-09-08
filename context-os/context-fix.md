# Fix Post-Implementation Issue

Creates a fix document for post-implementation issues using Context-OS classifier.

## Issue: $ARGUMENTS

## Architecture Note: Claude as Orchestrator

When this command is invoked, Claude may choose to:
1. Handle the fix directly using Context-OS tools
2. Spawn a Bug Fix Subagent via Task tool with subagent_type: 'general-purpose'

## Subagent Role When Task Tool is Used

When spawning a subagent for complex bug fixes, the subagent should load and follow the guidelines from `.claude/agents/bug-fixer.md`.

## Check for Help Flag

```bash
if [[ "$ARGUMENTS" == "--help" || "$ARGUMENTS" == "-h" ]]; then
  cat << 'EOF'
📋 Context-Fix Command Help
════════════════════════════════════════════════════════════

Purpose: Create fix documents for post-implementation issues

Usage:
  /context-fix --feature <slug> --issue "Description"          # Basic
  /context-fix --feature <slug> --issue "Desc" --dry-run      # Preview
  /context-fix --feature <slug> --issue "Desc" --apply        # Apply
  /context-fix --help                                         # Show help

Required Arguments:
  --feature <slug>   - Feature slug (e.g., add_dark_mode)
  --issue "desc"     - Issue description in quotes

Optional Arguments:
  --dry-run          - Preview without creating files (default)
  --apply            - Actually create fix documents
  --severity <level> - Override computed severity (PLANNED - not yet implemented)
  --env <env>        - Environment: prod, staging, dev
  --perf <0-100>     - Performance degradation percentage
  --users <0-100>    - Users affected percentage

Examples:
  /context-fix --feature dark_mode --issue "Toggle not saving"
  /context-fix --feature auth --issue "Login timeout" --severity high
  /context-fix --feature export --issue "CSV corrupt" --apply

Visual Issue Support:
  - Attach screenshots before sending (the UI binds them automatically), or provide resolvable paths/URLs via JSON/`--files`.
  - If tokens like `@1 @2` are present but no images are attached, the call is blocked with guidance to attach or use `--files`/JSON.

Severity Levels (4-tier):
  🔴 CRITICAL - Data loss, security, prod down, >50% perf
  🟠 HIGH     - Memory leak >25%/day, 25-50% perf, >10% users
  🟡 MEDIUM   - 10-25% perf degradation, UX disrupted
  🟢 LOW      - <10% perf impact, cosmetic issues

Environment Multipliers (Policy Guidance - not yet auto-applied):
  - Production: Apply severity as-is
  - Staging: Reduce by 1 level  
  - Development: Reduce by 2 levels
  - EXCEPTION: Security always CRITICAL
  Note: Currently for manual consideration only; classifier doesn't auto-adjust

What it creates:
  docs/proposal/<slug>/post-implementation-fixes/
  └── <severity>/
      └── YYYY-MM-DD-<issue-slug>.md

Fix Document Contains:
  - Issue description and severity
  - Root cause analysis
  - Proposed solution
  - Testing plan
  - Rollback strategy
  - Implementation status tracking

For more info: npm run context:help
EOF
  exit 0
fi
```

## Execution Process

1. **Parse Arguments**
   Extract feature, issue, and optional parameters

2. **Classify Severity**
   - If security mentioned → Always CRITICAL
   - If metrics provided → Use classifier-agent.js
   - Otherwise → Analyze and estimate

3. **Run Classifier**
   ```bash
   cd context-os
   
   # Parse arguments
   feature=$(echo "$ARGUMENTS" | grep -o '\-\-feature [^ ]*' | cut -d' ' -f2)
   issue=$(echo "$ARGUMENTS" | grep -o '\-\-issue "[^"]*"' | sed 's/--issue "//' | sed 's/"$//')
   severity=$(echo "$ARGUMENTS" | grep -o '\-\-severity [^ ]*' | cut -d' ' -f2)
   env=$(echo "$ARGUMENTS" | grep -o '\-\-env [^ ]*' | cut -d' ' -f2)
   perf=$(echo "$ARGUMENTS" | grep -o '\-\-perf [^ ]*' | cut -d' ' -f2)
   users=$(echo "$ARGUMENTS" | grep -o '\-\-users [^ ]*' | cut -d' ' -f2)
   
   # Create JSON input
   json="{\"feature\":\"${feature}\",\"issue\":\"${issue}\""
   [ ! -z "$severity" ] && json="${json},\"severity\":\"${severity}\""
   [ ! -z "$env" ] && json="${json},\"environment\":\"${env}\""
   if [ ! -z "$perf" ] || [ ! -z "$users" ]; then
     json="${json},\"metrics\":{"
     [ ! -z "$perf" ] && json="${json}\"performanceDegradation\":${perf}"
     [ ! -z "$perf" ] && [ ! -z "$users" ] && json="${json},"
     [ ! -z "$users" ] && json="${json}\"usersAffected\":${users}"
     json="${json}}"
   fi
   json="${json}}"
   
   # Execute fix creation
   result=$(echo "$json" | node cli/fix-cli.js 2>/dev/null | tail -1)
   
   # Show results
   if echo "$result" | grep -q '"ok":true'; then
     echo "✅ Fix document created!"
     echo "$result" | jq -r '.result.classification'
   else
     echo "❌ Fix creation failed"
     echo "$result" | jq -r '.error'
   fi
   ```

## Decision Framework

### Use Context-OS Tools When:
- Calculating exact severity scores
- Routing to correct directory structure
- Generating standardized fix documents
- Updating README indexes

### Use Claude Built-in Tools When:
- Analyzing root causes
- Writing solution proposals
- Creating test plans
- Understanding error patterns

## Success Criteria
- Issue properly classified with correct severity
- Fix document created in appropriate directory
- README index updated
- Clear remediation plan documented
