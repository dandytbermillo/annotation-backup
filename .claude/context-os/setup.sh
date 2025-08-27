#!/bin/bash

# Context-OS Setup Script
echo "🚀 Setting up Context-OS..."

CONTEXT_OS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$CONTEXT_OS_DIR/../.." && pwd)"

# Install dependencies
echo "📦 Installing dependencies..."
cd "$CONTEXT_OS_DIR"
npm install --silent

# Create required directories
echo "📁 Creating directory structure..."
mkdir -p knowledge/{patterns,errors,decisions}
mkdir -p current
mkdir -p rules
mkdir -p indexes
mkdir -p bin

# Make all bin scripts executable
chmod +x bin/*

# Setup git hooks
echo "🔗 Installing git hooks..."
if [ -d "$PROJECT_ROOT/.git" ]; then
    # Pre-commit hook
    cat > "$PROJECT_ROOT/.git/hooks/pre-commit" << 'EOF'
#!/bin/bash
# Context-OS pre-commit hook
CONTEXT_OS_DIR="$(git rev-parse --show-toplevel)/.claude/context-os"
if [ -x "$CONTEXT_OS_DIR/bin/context-hook" ]; then
    "$CONTEXT_OS_DIR/bin/context-hook" pre-commit
fi
EOF
    chmod +x "$PROJECT_ROOT/.git/hooks/pre-commit"

    # Post-commit hook
    cat > "$PROJECT_ROOT/.git/hooks/post-commit" << 'EOF'
#!/bin/bash
# Context-OS post-commit hook
CONTEXT_OS_DIR="$(git rev-parse --show-toplevel)/.claude/context-os"
if [ -x "$CONTEXT_OS_DIR/bin/context-hook" ]; then
    "$CONTEXT_OS_DIR/bin/context-hook" post-commit
fi
EOF
    chmod +x "$PROJECT_ROOT/.git/hooks/post-commit"
    
    echo "✓ Git hooks installed"
else
    echo "⚠️  Not a git repository, skipping hooks"
fi

# Create initial index
echo "🔍 Building initial knowledge index..."
"$CONTEXT_OS_DIR/bin/context-index" build

# Add context command to PATH hint
echo ""
echo "✨ Context-OS setup complete!"
echo ""
echo "To use the context command globally, add this to your shell profile:"
echo "  export PATH=\"$CONTEXT_OS_DIR/bin:\$PATH\""
echo ""
echo "Or use directly:"
echo "  $CONTEXT_OS_DIR/bin/context --help"
echo ""
echo "Start watching for changes:"
echo "  context watch --daemon"
echo ""