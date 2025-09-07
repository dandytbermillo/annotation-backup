# Execute Context-OS Feature

Creates a new feature with compliant documentation structure using Context-OS.

## Feature Description: $ARGUMENTS

## Architecture Note: Claude as Orchestrator

**Important**: Claude (the main agent) acts as the orchestrator. When this command is invoked, Claude orchestrates the entire workflow by:
1. Reading these instructions
2. Deciding whether to spawn a subagent via Task tool
3. Choosing which Context-OS tools to call
4. Coordinating the overall execution

## Subagent Role When Task Tool is Used

When complex implementation is needed, use the Task tool with subagent_type: 'general-purpose'. 

The subagent should load and follow the guidelines from `.claude/agents/feature-implementer.md`.

### Decision-Making Framework

For each implementation task, the subagent must decide:

**Use Context-OS .js/.ts tools (via Bash) when:**
- Creating deterministic directory structures → `node context-os/agents/orchestrator.ts`
- Calculating precise severity → `node context-os/agents/classifier-agent.js`
- Validating against fixed rules → `node context-os/cli/validate-cli.js`
- Managing state transitions → `node context-os/status-enforcer.js`

**Use Claude's built-in tools when:**
- Understanding requirements (Read tool)
- Generating new code (MultiEdit tool)
- Creating documentation (Write tool)
- Searching patterns (Grep tool)

### Tool Reference

#### Context-OS Tools (call via Bash)
- `context-os/agents/orchestrator.ts` - Feature structure creation, validation
- `context-os/agents/classifier-agent.js` - Issue classification, severity calculation
- `context-os/agents/verifier.ts` - Test execution, artifact collection
- `context-os/create-feature.js` - Initial feature scaffolding
- `context-os/status-enforcer.js` - Status management (PLANNED → IN PROGRESS → COMPLETE)

#### Claude Built-in Tools (use directly)
- Read - Parse INITIAL.md and existing code
- MultiEdit - Generate implementation code
- Write - Create new files
- Bash - Execute commands and tools
- Grep - Search codebase
- Task - Spawn specialized subagents when needed

## Check for Help Flag

```bash
if [[ "$ARGUMENTS" == "--help" || "$ARGUMENTS" == "-h" ]]; then
  cat << 'EOF'
📋 Context-Execute Command Help
════════════════════════════════════════════════════════════

Purpose: Create a new feature with compliant documentation structure

Usage:
  /context-execute "Feature Name"                     # Basic usage
  /context-execute "Feature Name" --plan <path>       # With draft plan
  /context-execute "Feature Name" --slug <name>       # Custom slug
  /context-execute --help                            # Show this help

Options:
  --plan <path>   - Use existing draft plan file
  --slug <name>   - Pre-select feature slug (default: auto-generated)
  --confirm false - Skip confirmation prompts
  --interactive   - Create INITIAL.md interactively first

Examples:
  /context-execute "Add Dark Mode"
  /context-execute "User Auth" --slug user_authentication
  /context-execute "Export Feature" --plan drafts/export.md

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