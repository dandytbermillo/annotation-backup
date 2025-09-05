# Execute Context-OS Feature

Creates a new feature with compliant documentation structure using Context-OS.

## Feature Description: $ARGUMENTS

## Check for Help Flag

```bash
if [[ "$ARGUMENTS" == "--help" || "$ARGUMENTS" == "-h" ]]; then
  cat << 'EOF'
📋 Context-Execute Command Help
════════════════════════════════════════════════════════════

Purpose: Create a new feature with compliant documentation structure

Usage:
  /context-execute "Feature Name" --create-initial    # Create INITIAL.md (NEW)
  /context-execute feature_slug --create-prp          # Create PRP from INITIAL.md (NEW)
  /context-execute "Feature Name" --interactive       # Create INITIAL.md (legacy, still works)
  /context-execute --help                            # Show this help

Options (NEW - Clearer):
  --create-initial - Create INITIAL.md for new feature (replaces --interactive)
  --create-prp     - Generate PRP from existing INITIAL.md
  --create-impl    - Generate implementation plan (coming soon)
  
Options (Legacy - Still Supported):
  --interactive    - Create INITIAL.md interactively (use --create-initial instead)
  --plan <path>    - Use existing draft plan file
  --slug <name>    - Pre-select feature slug (default: auto-generated)
  --confirm false  - Skip confirmation prompts

Examples (NEW - Clearer Workflow):
  Step 1: /context-execute "Add Dark Mode" --create-initial
  Step 2: /context-execute add_dark_mode --create-prp
  
  Step 1: /context-execute "User Auth" --create-initial --slug auth_system
  Step 2: /context-execute auth_system --create-prp

Examples (Legacy):
  /context-execute "Add Dark Mode" --interactive
  /context-execute "User Auth" --interactive --slug user_authentication
  /context-execute "Export Feature" --interactive --plan drafts/export.md

What it creates:
  docs/proposal/<slug>/
  ├── implementation.md          # Main feature document
  ├── reports/                   # Implementation reports
  ├── patches/                   # Code patches
  │   └── README.md             # Patch index
  ├── post-implementation-fixes/ # Post-implementation fixes
  │   └── README.md             # Fixes index
  ├── test_pages/               # Test pages
  └── test_scripts/             # Test scripts

Process:
  1. Creates feature directory structure
  2. Generates implementation.md from template
  3. Incorporates draft plan if provided
  4. Sets initial status to PLANNED
  5. Creates required README files

For more info: npm run context:help
EOF
  exit 0
fi
```

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
/context-execute "Add dark mode toggle"
/context-execute "User authentication" --plan drafts/auth.md
/context-execute "Search feature" --slug search_v2
```

## Error Handling

- Missing plan → Create minimal plan template
- Invalid slug → Suggest alternatives
- Validation failure → Show specific issues