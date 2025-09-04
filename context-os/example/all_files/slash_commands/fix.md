# Fix Post-Implementation Issue

Creates a fix document for post-implementation issues using Context-OS classifier.

## Issue: $ARGUMENTS

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
/fix --feature dark_mode --issue "Toggle not working in mobile"
/fix --feature auth --issue "Memory leak on login" --dry-run
/fix --feature search --issue "Slow query performance" --apply
```

## Error Handling

- Feature not found → List available features
- Missing status → Check if feature is COMPLETE
- Classification failure → Use default classification