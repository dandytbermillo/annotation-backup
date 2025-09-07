# Validate Documentation Structure

Validates a feature's documentation structure against the Documentation Process Guide.

## Feature: $ARGUMENTS

## Architecture Note: Claude as Orchestrator

When this command is invoked, Claude may choose to:
1. Run validation directly using Context-OS tools
2. Spawn a Validator Subagent via Task tool for comprehensive checks

## Subagent Role When Task Tool is Used

When spawning a subagent for validation, the subagent should load and follow the guidelines from `.claude/agents/validator.md`.

## Check for Help Flag

```bash
if [[ "$ARGUMENTS" == "--help" || "$ARGUMENTS" == "-h" ]]; then
  cat << 'EOF'
📋 Context-Validate Command Help
════════════════════════════════════════════════════════════

Purpose: Validate feature documentation against Process Guide v1.4.5

Usage:
  /context-validate                    # Validate all features
  /context-validate <feature_slug>     # Validate specific feature
  /context-validate <feature> --strict # Strict validation mode
  /context-validate --help            # Show this help

Examples:
  /context-validate
  /context-validate add_dark_mode
  /context-validate unified_offline_foundation --strict

What it checks:
  ✓ Required directories (reports/, post-implementation-fixes/)
  ✓ Implementation report exists
  ✓ Status values (PLANNED, IN PROGRESS, COMPLETE, BLOCKED)
  ✓ Phase boundaries and structure
  ✓ Patch file naming conventions

Exit codes:
  0 - Validation passed
  1 - Validation failed with errors

For more info: npm run context:help
EOF
  exit 0
fi
```

## Validation Process

1. **Check Arguments**
   - If no feature specified, validate entire docs/proposal/ directory
   - If feature name provided, validate that specific feature

2. **Run Validation Script**
   ```bash
   # For specific feature
   ./scripts/validate-doc-structure.sh ../docs/proposal/$ARGUMENTS
   
   # For all features (if no arguments)
   ./scripts/validate-doc-structure.sh
   ```

3. **Check Compliance**
   - Verify all required directories exist
   - Check for required files (implementation.md, reports/, etc.)
   - Validate status values (PLANNED, IN PROGRESS, COMPLETE, BLOCKED)
   - Ensure patches directory has README.md if exists

4. **Report Results**
   - Show validation errors with specific rule violations
   - Provide fix suggestions for common issues
   - Return success/failure status

## Error Handling

If validation fails:
- List specific missing directories/files
- Suggest using `/fix` command to auto-remediate
- Reference the Documentation Process Guide rules

## Example Usage

```
/validate dark_mode
/validate  # validates all features
```