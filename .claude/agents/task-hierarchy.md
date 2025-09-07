# Task Tool Hierarchy Documentation

## Architecture Overview

```
Claude (Orchestrator)
  │
  ├──> Task Tool
  │     │
  │     ├──> Subagent: context-executor
  │     │     └──> Tools: Bash (execute-cli.js), Read, Write
  │     │
  │     ├──> Subagent: context-fixer
  │     │     └──> Tools: Bash (fix-cli.js, classifier-agent.js)
  │     │
  │     └──> Subagent: context-validator
  │           └──> Tools: Bash (validate-cli.js), Read
  │
  └──> Direct Tools (when Task not needed)
        ├──> Read, Write, Edit
        ├──> Bash (for simple commands)
        └──> Grep, Glob
```

## Philosophy

**Claude IS the orchestrator** - not any JavaScript/TypeScript file.
- Context-OS provides tools, not agents
- Files in `agents/` directory are tools with agent-like capabilities
- Task tool spawns subagents that read `.claude/agents/*.md` for guidance

## Task Tool Usage

### When to Use Task Tool

1. **Multi-step workflows** requiring coordination
2. **Feature implementation** from INITIAL.md
3. **Complex debugging** with multiple phases
4. **Validation across multiple features**

### When to Use Direct Tools

1. **Simple file operations** (Read/Write/Edit)
2. **Quick searches** (Grep/Glob)
3. **Single command execution** (Bash)
4. **Immediate responses** without workflow

## Subagent Mapping

| Context-OS Command | Task Subagent | Agent Guidance File |
|-------------------|---------------|--------------------|
| /context-execute | context-executor | .claude/agents/context-executor.md |
| /context-fix | context-fixer | .claude/agents/context-fixer.md |
| /context-validate | context-validator | .claude/agents/context-validator.md |
| Feature implementation | feature-implementer | .claude/agents/feature-implementer.md |
| Bug fixing | bug-fixer | .claude/agents/bug-fixer.md |

## JSON Communication Boundaries

All Context-OS tools communicate via JSON:

```bash
# Input
echo '{"feature":"test","plan":"draft.md"}' | node cli/execute-cli.js

# Output
{"ok":true,"feature":"test","path":"docs/proposal/test"}
```

## Example Task Tool Invocation

```typescript
// When Claude uses Task tool
Task {
  description: "Implement dark mode feature",
  subagent_type: "feature-implementer",
  prompt: `
    Read the INITIAL.md at docs/proposal/dark_mode/INITIAL.md.
    Follow the guidance in .claude/agents/feature-implementer.md.
    Use context-executor to create the structure.
    Implement the feature incrementally.
    Validate with context-validator.
  `
}
```

## Tool Selection Matrix

| Scenario | Use Task + Subagent | Use Direct Tool |
|----------|--------------------|-----------------|
| Create feature from plan | ✅ context-executor | ❌ |
| Fix a bug with classification | ✅ context-fixer | ❌ |
| Validate all features | ✅ context-validator | ❌ |
| Read a single file | ❌ | ✅ Read |
| Search for pattern | ❌ | ✅ Grep |
| Run npm test | ❌ | ✅ Bash |
| Implement complex feature | ✅ feature-implementer | ❌ |

## Integration Points

1. **Command Router** (`command-router.js`)
   - Routes /context-* commands
   - Returns proper exit codes
   - Handles both command forms

2. **Bridge** (`bridge/bridge-enhanced.js`)
   - Translates between Claude and Context-OS
   - Manages JSON boundaries
   - Handles status fields

3. **CLI Wrappers** (`cli/*.js`)
   - Provide JSON interfaces
   - Handle cwd-independent paths
   - Return structured results

## Success Metrics

- Task tool can spawn Context-OS operations ✅
- Subagents read .claude/agents/*.md guidance ✅
- JSON boundaries maintained throughout ✅
- Exit codes properly propagated ✅
- No false positives in validation ✅