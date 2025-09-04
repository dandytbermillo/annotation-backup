# Fix Post-Implementation Issue

Creates a fix document for post-implementation issues using Context-OS classifier.

## Issue: $ARGUMENTS

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
  --severity <level> - Set severity: critical, high, medium, low
  --env <env>        - Environment: prod, staging, dev

Examples:
  /context-fix --feature dark_mode --issue "Toggle not saving"
  /context-fix --feature auth --issue "Login timeout" --severity high
  /context-fix --feature export --issue "CSV corrupt" --apply

Severity Levels:
  critical - System down, data loss risk
  high     - Major feature broken
  medium   - Feature partially working
  low      - Minor issues, cosmetic

What it creates:
  docs/proposal/<slug>/post-implementation-fixes/
  └── <severity>/
      └── YYYY-MM-DD-<issue-slug>.md

Fix Document Contains:
  - Issue description
  - Severity classification
  - Root cause analysis placeholder
  - Solution approach
  - Testing requirements
  - Rollback plan

For more info: npm run context:help
EOF
  exit 0
fi
```

## Fix Process

1. **Parse Arguments**
   - Format: --feature SLUG --issue "Description" [--dry-run|--apply]
   - Extract feature, issue, and options

2. **Run Context-OS Fix Workflow**
   ```bash
   cd context-os
   
   # Parse arguments
   feature=$(echo "$ARGUMENTS" | grep -o '\-\-feature [^ ]*' | cut -d' ' -f2)
   issue=$(echo "$ARGUMENTS" | grep -o '\-\-issue "[^"]*"' | sed 's/--issue //' | tr -d '"')
   dry_run=$(echo "$ARGUMENTS" | grep -q '\-\-dry-run' && echo "true" || echo "false")
   
   # Create JSON input
   json="{\"feature\":\"${feature}\",\"issue\":\"${issue}\",\"dryRun\":${dry_run},\"autoConfirm\":true}"
   
   # Execute
   result=$(echo "$json" | node cli/fix-cli.js 2>/dev/null | tail -1)
   
   # Parse result
   if echo "$result" | grep -q '"ok":true'; then
     echo "✅ Fix document created!"
     echo "$result" | jq -r '.result.classification'
     echo "$result" | jq -r '.result.fixPath'
   else
     echo "❌ Fix creation failed"
     echo "$result" | jq -r '.error'
   fi
   ```

3. **Show Classification**
   - Severity (CRITICAL/HIGH/MEDIUM/LOW)
   - Type (BUG/PERFORMANCE/SECURITY/etc)
   - SLA and recommendations
   - Fix document path

## Examples

```bash
/context-fix --feature dark_mode --issue "Toggle not working in mobile"
/context-fix --feature auth --issue "Memory leak on login" --dry-run
/context-fix --feature search --issue "Slow query performance" --apply
```

## Error Handling

- Feature not found → List available features
- Missing status → Check if feature is COMPLETE
- Classification failure → Use default classification