#!/bin/bash

# fix-feature-structure.sh
# Automatically creates missing directories for features to meet validation requirements

echo "🔧 Feature Structure Auto-Fixer"
echo "================================"

FEATURES_DIR="docs/proposal"
FIXED_COUNT=0
SKIPPED_COUNT=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to create required directories for a feature
fix_feature() {
    local feature=$1
    local feature_path="$FEATURES_DIR/$feature"
    
    if [ ! -d "$feature_path" ]; then
        echo -e "${RED}❌ Feature not found: $feature${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Checking $feature...${NC}"
    
    local created=false
    
    # Create post-implementation-fixes directory if missing
    if [ ! -d "$feature_path/post-implementation-fixes" ]; then
        mkdir -p "$feature_path/post-implementation-fixes"
        echo "  ✓ Created post-implementation-fixes/"
        created=true
    fi
    
    # Create reports directory if missing
    if [ ! -d "$feature_path/reports" ]; then
        mkdir -p "$feature_path/reports"
        echo "  ✓ Created reports/"
        created=true
    fi
    
    # Create placeholder README if directories were created
    if [ "$created" = true ]; then
        # Add placeholder in post-implementation-fixes
        if [ ! -f "$feature_path/post-implementation-fixes/README.md" ]; then
            cat > "$feature_path/post-implementation-fixes/README.md" << EOF
# Post-Implementation Fixes

This directory contains fixes applied after the initial implementation.

## Fix Log

_No fixes recorded yet._

## Guidelines
- Document each fix with a dated markdown file
- Include problem description, solution, and validation
- Reference related issues or PRs
EOF
            echo "  ✓ Created post-implementation-fixes/README.md"
        fi
        
        # Add placeholder in reports
        if [ ! -f "$feature_path/reports/README.md" ]; then
            cat > "$feature_path/reports/README.md" << EOF
# Feature Reports

This directory contains implementation and validation reports.

## Report Types
- Implementation reports
- Validation reports
- Test results
- Performance analysis

## Report Log

_No reports recorded yet._
EOF
            echo "  ✓ Created reports/README.md"
        fi
        
        ((FIXED_COUNT++))
        echo -e "${GREEN}  ✅ Fixed structure for $feature${NC}"
    else
        ((SKIPPED_COUNT++))
        echo "  ⏭️  Structure already correct"
    fi
    
    echo ""
}

# Check if specific feature provided
if [ "$1" = "--feature" ] && [ -n "$2" ]; then
    fix_feature "$2"
elif [ "$1" = "--all" ]; then
    # Process all features
    echo "Processing all features..."
    echo ""
    
    for feature_dir in "$FEATURES_DIR"/*; do
        if [ -d "$feature_dir" ]; then
            feature=$(basename "$feature_dir")
            fix_feature "$feature"
        fi
    done
    
    echo "================================"
    echo -e "${GREEN}Summary:${NC}"
    echo "  Fixed: $FIXED_COUNT features"
    echo "  Already correct: $SKIPPED_COUNT features"
    echo ""
    echo "Run validation to verify:"
    echo "  node scripts/scan-features.js"
else
    echo "Usage:"
    echo "  $0 --all                    Fix all features"
    echo "  $0 --feature <feature_name> Fix specific feature"
    echo ""
    echo "Examples:"
    echo "  $0 --all"
    echo "  $0 --feature batch_mode_test"
    echo ""
    echo "This script will:"
    echo "  - Create missing post-implementation-fixes directories"
    echo "  - Create missing reports directories"
    echo "  - Add placeholder README files"
fi