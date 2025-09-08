# Execute Context-OS Feature

Creates a new feature with compliant documentation structure using Context-OS.

## Feature Description: $ARGUMENTS

## CRITICAL: Mandatory Requirements

**⚠️ BEFORE EXECUTION**: The orchestrator and any spawned agents MUST:
1. **Load and follow CLAUDE.md** - Specifically the "MANDATORY HONESTY AND ACCURACY REQUIREMENTS" section
2. **Apply all honesty requirements** from `/Users/dandy/Downloads/annotation_project/annotation-backup/CLAUDE.md`
3. **Never violate** the truth requirements, testing requirements, or accountability rules

**Reference**: See `CLAUDE.md` sections:
- § MANDATORY HONESTY AND ACCURACY REQUIREMENTS (lines 11-52)
- § Truth Requirements
- § When Testing
- § When Implementing
- § No Assumptions Policy
- § Accountability

## Architecture Note: Claude as Orchestrator

**Important**: Claude (the main agent) acts as the orchestrator. When this command is invoked, Claude orchestrates the entire workflow by:
1. Reading these instructions
2. **Loading CLAUDE.md honesty requirements**
3. Deciding whether to spawn a subagent via Task tool
4. Choosing which Context-OS tools to call
5. Coordinating the overall execution

## Subagent Role When Task Tool is Used

When complex implementation is needed, use the Task tool with subagent_type: 'general-purpose'. 

The subagent MUST:
1. **First load CLAUDE.md** for mandatory honesty requirements
2. **Then load** `.claude/agents/feature-implementer.md` for implementation guidelines
3. **Apply verification checkpoints** before any completion claims

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
  /context-execute "Feature Name" --from <path>       # With draft plan
  /context-execute "Feature Name" --slug <name>       # Custom slug
  /context-execute --help                            # Show this help

Options:
  --from <path>   - Use existing draft plan file (preserves original filename)
  --slug <name>   - Pre-select feature slug (default: auto-generated)
  --confirm false - Skip confirmation prompts
  --interactive   - Create INITIAL.md interactively first

Examples:
  /context-execute "Add Dark Mode"
  /context-execute "User Auth" --slug user_authentication
  /context-execute "Export Feature" --from drafts/export.md
  /context-execute "Hello World" --from context-os/drafts/initial.md

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

1. **Parse and Display Input**
   ```bash
   # Description: Initialize Context-OS feature creation with provided arguments
   # This creates a compliant feature structure in docs/proposal/
   
   # Parse arguments first
   feature_name=$(echo "$ARGUMENTS" | grep -o '"[^"]*"' | head -1 | tr -d '"')
   from_path=$(echo "$ARGUMENTS" | grep -o '\-\-from [^ ]*' | cut -d' ' -f2)
   slug=$(echo "$ARGUMENTS" | grep -o '\-\-slug [^ ]*' | cut -d' ' -f2)
   
   # Generate slug from feature name if not provided
   if [ -z "$slug" ]; then
     slug=$(echo "$feature_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | tr '-' '_')
   fi
   
   # Extract filename from source path
   if [ ! -z "$from_path" ]; then
     source_filename=$(basename "$from_path")
   else
     source_filename="initial.md"
   fi
   
   # Display formatted execution summary
   echo "I'll execute the Context-OS feature creation based on your arguments. Let me break down what"
   echo "  you're asking for:"
   echo ""
   echo "  - Feature name (Folder)  : \"$slug\""
   echo "  - Source file: $from_path"
   echo ""
   echo "Available structure:"
   echo "  docs/proposal/${slug}/"
   echo "  ├── ${source_filename}          # Your feature requirements"
   echo "  ├── patches/                # Code patches"
   echo "  ├── post-implementation-fixes/ # Post-implementation fixes"
   echo "  ├── reports/                # Implementation reports"
   echo "  ├── test_pages/             # Test pages"
   echo "  └── test_scripts/           # Test scripts"
   echo ""
   ```

2. **Run Context-OS Orchestrator**
   ```bash
   # Don't cd into context-os, stay in project root
   
   # Validate draft file if provided
   if [ ! -z "$from_path" ]; then
     if [ -f "$from_path" ]; then
       echo "📄 Reading draft from: $from_path"
       draft_content=$(cat "$from_path")
       original_filename=$(basename "$from_path")
     else
       echo "❌ Draft file not found: $from_path"
       exit 1
     fi
   fi
   
   # Create JSON input with all parameters
   json="{\"feature\":\"${feature_name}\",\"autoConfirm\":true"
   if [ ! -z "$from_path" ]; then
     json="${json},\"draftPath\":\"${from_path}\",\"originalFilename\":\"${original_filename}\""
   fi
   if [ ! -z "$slug" ]; then
     json="${json},\"slug\":\"${slug}\""
   fi
   json="${json}}"
   
   # Execute with wrapper that handles JSON input (from context-os directory)
   echo ""
   echo "🚀 Initializing Context-OS feature creation..."
   echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
   echo "📦 Feature: ${feature_name}"
   echo "📁 Target: docs/proposal/${slug}/"
   if [ ! -z "$from_path" ]; then
     echo "📄 Source: ${from_path}"
   fi
   echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
   echo ""
   echo "⚙️  Creating Context-OS feature structure..."
   
   # Suppress the raw command output by redirecting it properly
   result=$(echo "$json" | node context-os/execute-wrapper.js 2>&1)
   
   # Don't show the raw Context-OS output, format it consistently
   # The Context-OS creates files in context-os/docs/proposal/ but we want docs/proposal/
   
   # Check if creation was successful
   if echo "$result" | grep -q "Feature created successfully" || echo "$result" | grep -q "Feature structure successfully created"; then
     # Move from context-os/docs/proposal to docs/proposal if needed
     if [ -d "context-os/docs/proposal/${slug}" ] && [ ! -d "docs/proposal/${slug}" ]; then
       mkdir -p docs/proposal/
       mv "context-os/docs/proposal/${slug}" "docs/proposal/${slug}"
     fi
     
     # Verify actual creation
     if [ -d "docs/proposal/${slug}" ]; then
       echo ""
       echo "✅ Feature structure created successfully!"
       echo ""
       echo "  The Context-OS feature \"${feature_name}\" has been created at:"
       echo "  docs/proposal/${slug}/"
       echo "  ├── ${source_filename}          # Your feature requirements"
       echo "  ├── patches/                # Code patches"
       echo "  │   └── README.md"
       echo "  ├── post-implementation-fixes/ # Post-implementation fixes"
       echo "  │   └── README.md"
       echo "  ├── reports/                # Implementation reports"
       echo "  ├── test_pages/             # Test pages"
       echo "  └── test_scripts/           # Test scripts"
       echo ""
       echo "  The feature is now ready for implementation."
     else
       echo "⚠️ Warning: Feature creation reported success but directory not found"
       echo "Please check manually at docs/proposal/${slug}"
     fi
   else
     echo "❌ Feature creation failed. Error details:"
     echo "$result" | head -5
   fi
   ```

3. **Show Results**
   - Display ONLY verified created files (per CLAUDE.md honesty requirements)
   - Show actual validation status with evidence
   - Provide next steps based on what actually happened

## Examples

```bash
/context-execute "Add dark mode toggle"
/context-execute "User authentication" --from drafts/auth.md
/context-execute "Search feature" --slug search_v2
/context-execute "Hello World Python" --from context-os/drafts/initial.md
```

## Error Handling

- Missing plan → Create minimal plan template
- Invalid slug → Suggest alternatives
- Validation failure → Show specific issues