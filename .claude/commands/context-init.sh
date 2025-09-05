#!/bin/bash
# context-init.sh - Interactive INITIAL.md creation command

# Get all arguments
ALL_ARGS="$@"
FEATURE=""
CLEAN_ARGS=""

# Extract feature slug (first non-flag argument)
for arg in $ALL_ARGS; do
    if [[ ! "$arg" =~ ^-- ]]; then
        if [ -z "$FEATURE" ]; then
            FEATURE="$arg"
        fi
    else
        CLEAN_ARGS="$CLEAN_ARGS $arg"
    fi
done

# Show help if no feature provided
if [ -z "$FEATURE" ] || [[ "$ALL_ARGS" =~ --help ]]; then
    echo "Context-OS Interactive INITIAL.md Creator"
    echo ""
    echo "Usage:"
    echo "  /context-init <feature_slug> [options]"
    echo ""
    echo "Options:"
    echo "  --resume        Continue from saved session"
    echo "  --dry-run       Preview without writing files"
    echo "  --apply         Skip confirmation prompt"
    echo "  --migrate       Upgrade existing INITIAL.md format"
    echo "  --batch-mode    CI mode (no prompts, use defaults)"
    echo "  --help          Show this help"
    echo ""
    echo "Examples:"
    echo "  /context-init dark_mode"
    echo "  /context-init auth_system --dry-run"
    echo "  /context-init search_feature --resume"
    exit 0
fi

# Change to project root
cd /Users/dandy/Downloads/annotation_project/annotation-backup

# Check if init-interactive.js exists
if [ ! -f "context-os/cli/init-interactive.js" ]; then
    echo "❌ Error: init-interactive.js not found at context-os/cli/init-interactive.js"
    echo "Please ensure the Interactive INITIAL.md system is properly installed."
    exit 1
fi

# Execute the interactive init command
echo "🚀 Starting Interactive INITIAL.md creation for: $FEATURE"
node context-os/cli/init-interactive.js "$FEATURE" $CLEAN_ARGS