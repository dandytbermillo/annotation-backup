# Slash Commands Collection

This directory contains all files involved in the slash command system for Context-OS.

## Directory Structure

```
all_files/
├── slash_commands/          # All .claude/commands/* files
│   ├── context-help.md      # /context-help command
│   ├── custom-compact.md    # /custom-compact command
│   ├── execute.md          # /execute command
│   ├── execute-prp.md      # /execute-prp command
│   ├── features.md         # /features command definition
│   ├── features.sh         # /features router script (improved)
│   ├── fix.md              # /fix command
│   ├── generate-prp.md     # /generate-prp command
│   ├── validate.md         # /validate command
│   ├── test-sync.sh        # Test synchronization script
│   ├── validate-persistence.sh  # Persistence validation
│   └── README.md           # Commands documentation
│
├── supporting_scripts/      # Scripts called by commands
│   ├── scan-features.js    # Scans features (v2.0 with improvements)
│   ├── show-features.js    # Displays features (v2.0 with --format)
│   ├── context-help.js     # Help system
│   └── validate-doc-structure.sh  # Validation logic
│
└── context-os-core/        # Core Context-OS files
    ├── create-feature.js   # Feature creation workflow
    ├── fix-workflow.js     # Fix workflow implementation
    ├── execute-cli.js      # CLI for /execute
    ├── fix-cli.js          # CLI for /fix
    └── validate-cli.js     # CLI for /validate
```

## Key Improvements (2025-09-04)

### Scanner Enhancements (scan-features.js)
- Multi-pattern report detection
- Schema versioning (v2.0.0)
- Canonical status values (🚧 IN PROGRESS, ✅ COMPLETE, etc.)
- Per-feature error handling
- NextActions field for actionable suggestions
- Validation issue tracking

### Display Enhancements (show-features.js)
- Consolidated --format flag (table, detailed, summary, json)
- Individual feature view (--feature <slug>)
- Validation column in table view
- "Needs Attention" section in summary
- Schema version display

### Router Improvements (features.sh)
- Handles noisy arguments from Claude Code
- Extracts clean flags (--format, --feature, --refresh)
- Always rebuilds data for fresh output

## Usage Examples

```bash
# View all features (table format)
/features

# View summary with next actions
/features --format summary

# View specific feature details
/features --feature add_dark_mode

# View detailed format
/features --format detailed

# Export as JSON
/features --format json
```

## Integration Points

The slash commands integrate with:
1. Context-OS Bridge (`context-os/bridge/`)
2. Command Router (`context-os/command-router.js`)
3. Documentation Process Guide (`docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md`)
4. Feature directories (`docs/proposal/*/`)

## Files Updated Today

- `scripts/scan-features.js` - Enhanced scanner v2.0
- `scripts/show-features.js` - Enhanced display v2.0  
- `.claude/commands/features.sh` - Improved argument parsing