# Claude Code Agents

This directory contains agent definitions for Claude Code's Task tool. These agents provide specialized capabilities for the Context-OS documentation workflow.

## Available Agents

### feature-implementer
- **Purpose**: Implement features from INITIAL.md specifications
- **Trigger**: `/context-execute` command or direct Task invocation
- **Key Tools**: Context-OS orchestrator, MultiEdit, validation scripts

### bug-fixer
- **Purpose**: Classify and fix post-implementation bugs
- **Trigger**: `/context-fix` command or when issues are identified
- **Key Tools**: classifier-agent.js, fix-cli.js, severity routing

### validator
- **Purpose**: Validate documentation compliance
- **Trigger**: `/context-validate` command or after changes
- **Key Tools**: validate-doc-structure.sh, validate-cli.js

## Architecture

```
User Input
    ↓
Claude (Orchestrator)
    ↓
Task Tool → Reads .claude/agents/*.md
    ↓
Subagent Executes with Role
    ↓
Calls Context-OS Tools or Built-in Tools
    ↓
Returns Results
```

## Agent Definition Format

Each agent definition includes:
1. **Role**: Clear responsibility statement
2. **Available Tools**: List of permitted tools
3. **Decision Framework**: When to use which tools
4. **Execution Process**: Step-by-step workflow
5. **Success Criteria**: Completion requirements

## Usage

Agents are invoked via the Task tool:

```javascript
// Direct invocation
Task({
  subagent_type: 'general-purpose',
  description: 'Implement feature',
  prompt: 'Use feature-implementer agent guidelines from .claude/agents/feature-implementer.md'
})
```

Or via slash commands that reference them:

```bash
/context-execute "Feature Name"  # Uses feature-implementer
/context-fix --feature x         # Uses bug-fixer
/context-validate feature_slug   # Uses validator
```

## Best Practices

1. **Agents are instructions**, not code - they guide Claude's behavior
2. **Keep agents focused** - one clear responsibility per agent
3. **Reference Context-OS tools** by their actual paths
4. **Include decision logic** for tool selection
5. **Define clear success criteria** for task completion

## Integration with Context-OS

These agents work with Context-OS tools located in:
- `context-os/agents/` - JavaScript/TypeScript implementations
- `context-os/cli/` - CLI wrappers for commands
- `scripts/` - Bash validation scripts

The agents provide the orchestration logic while Context-OS provides the execution tools.