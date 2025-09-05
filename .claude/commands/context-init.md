# /context-init

Creates an INITIAL.md file for a feature through interactive collection with Claude.

## Usage

```bash
/context-init <feature_slug> [options]
```

## Options

- `--resume` - Continue from a saved session
- `--dry-run` - Preview without writing files  
- `--apply` - Skip confirmation prompts
- `--migrate` - Upgrade existing INITIAL.md to current format
- `--batch-mode` - CI/automation mode (no prompts, use defaults)
- `--help` - Show help information

## Examples

```bash
# Create new INITIAL.md interactively
/context-init dark_mode

# Preview without writing
/context-init auth_system --dry-run

# Resume interrupted session
/context-init search_feature --resume

# Batch mode for CI
/context-init new_feature --batch-mode --apply

# Migrate existing INITIAL.md
/context-init old_feature --migrate
```

## Process

1. Starts interactive session with Claude
2. Collects all required fields (title, problem, goals, etc.)
3. Validates input against schema requirements
4. Shows preview of generated INITIAL.md
5. Writes to `docs/proposal/<feature>/INITIAL.md`
6. Runs validation to ensure compliance
7. Emits telemetry for monitoring

## Session Management

- Sessions are saved to `.tmp/initial/<feature>.json`
- Use `--resume` to continue interrupted sessions
- Session data includes partial progress and metadata

## Validation

The command enforces:
- Title: 5-80 characters
- Problem: 3-6 sentences
- Goals: 3-7 bullet points (max 100 chars each)
- Acceptance Criteria: 3-7 bullet points (max 120 chars each)
- Stakeholders: 2-6 entries

## Next Steps

After creating INITIAL.md:
1. Review the generated file
2. Run `/context-execute <feature>` to create implementation plan
3. Run `/context-validate <feature>` to ensure compliance

## Implementation

This command executes:
```bash
node context-os/cli/init-interactive.js <feature_slug> [options]
```

The implementation uses:
- Zod schema validation (v1.0.0)
- Handlebars templating
- Claude integration for interactive collection
- JSONL telemetry logging