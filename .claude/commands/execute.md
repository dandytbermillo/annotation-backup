# Execute Context-OS Feature

Creates a new feature with compliant documentation structure using Context-OS.

## Feature Description: $ARGUMENTS

## Execution Process

1. **Parse Input**
   - Extract feature name and options from arguments
   - Format: "Feature Name" [--plan path] [--slug name]

2. **Run Context-OS Orchestrator**
   ```bash
   cd context-os
   
   # Parse arguments
   feature_name=$(echo "$ARGUMENTS" | grep -o '"[^"]*"' | head -1 | tr -d '"')
   plan_path=$(echo "$ARGUMENTS" | grep -o '\-\-plan [^ ]*' | cut -d' ' -f2)
   slug=$(echo "$ARGUMENTS" | grep -o '\-\-slug [^ ]*' | cut -d' ' -f2)
   
   # Create JSON input
   json="{\"feature\":\"${feature_name}\",\"autoConfirm\":true"
   [ ! -z "$plan_path" ] && json="${json%\}},\"plan\":\"${plan_path}\"}"
   [ ! -z "$slug" ] && json="${json%\}},\"slug\":\"${slug}\"}"
   json="${json}}"
   
   # Execute
   result=$(echo "$json" | node cli/execute-cli.js 2>/dev/null | tail -1)
   
   # Parse result
   if echo "$result" | grep -q '"ok":true'; then
     echo "✅ Feature created successfully!"
     echo "$result" | jq -r '.result.path'
   else
     echo "❌ Feature creation failed"
     echo "$result" | jq -r '.error'
   fi
   ```

3. **Show Results**
   - Display created files
   - Show validation status
   - Provide next steps

## Examples

```bash
/execute "Add dark mode toggle"
/execute "User authentication" --plan drafts/auth.md
/execute "Search feature" --slug search_v2
```

## Error Handling

- Missing plan → Create minimal plan template
- Invalid slug → Suggest alternatives
- Validation failure → Show specific issues