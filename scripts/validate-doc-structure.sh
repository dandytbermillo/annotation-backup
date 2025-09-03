#!/bin/bash

# Documentation Structure Validator v2
# Validates that feature documentation follows the Documentation Process Guide v1.4.5

set -Euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0

# Parse arguments
STRICT_MODE=false
if [[ "${1:-}" == "--strict" ]]; then
    STRICT_MODE=true
    echo "Running in strict mode (warnings become errors)"
fi

# Function to check directory structure
check_feature_structure() {
    local feature_dir="$1"
    local feature_name
    feature_name=$(basename "$feature_dir")
    
    echo "Checking: $feature_name"
    
    # Required directories
    local required_dirs=(
        "reports"
        "implementation-details"
        "post-implementation-fixes"
    )
    
    # Check for required directories
    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$feature_dir/$dir" ]; then
            echo -e "${YELLOW}  ⚠ Missing directory: $dir${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    done
    
    # Only mandatory: README in post-implementation-fixes (Rule 1)
    if [ -d "$feature_dir/post-implementation-fixes" ] && [ ! -f "$feature_dir/post-implementation-fixes/README.md" ]; then
        echo -e "${RED}  ✗ Missing mandatory README.md in post-implementation-fixes/ (Rule 1)${NC}"
        ERRORS=$((ERRORS + 1))
    elif [ -f "$feature_dir/post-implementation-fixes/README.md" ]; then
        echo -e "${GREEN}  ✓ post-implementation-fixes/ has README.md${NC}"
    fi
    
    # Check for Implementation Plan
    if [ ! -f "$feature_dir/Implementation-Plan.md" ] && [ ! -f "$feature_dir/INITIAL.md" ]; then
        echo -e "${YELLOW}  ⚠ Missing Implementation-Plan.md or INITIAL.md${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    # Check for main implementation report in reports/
    local main_report=""
    if [ -d "$feature_dir/reports" ]; then
        # Find implementation reports (using -print0 for robustness)
        local report_count=0
        local first_report=""
        local extra_reports=()
        while IFS= read -r -d '' report; do
            if [ $report_count -eq 0 ]; then
                first_report="$report"
            else
                extra_reports+=("$(basename "$report")")
            fi
            report_count=$((report_count + 1))
        done < <(find "$feature_dir/reports" -maxdepth 1 \( -name "*Implementation-Report.md" -o -name "*implementation-report.md" \) -type f -print0)
        
        if [ $report_count -eq 0 ]; then
            echo -e "${RED}  ✗ No implementation report found in reports/${NC}"
            ERRORS=$((ERRORS + 1))
        elif [ $report_count -gt 1 ]; then
            echo -e "${YELLOW}  ⚠ Multiple implementation reports found in reports/${NC}"
            echo -e "${YELLOW}     Using: $(basename "$first_report")${NC}"
            for extra in "${extra_reports[@]}"; do
                echo -e "${YELLOW}     Extra: $extra${NC}"
            done
            WARNINGS=$((WARNINGS + 1))
            main_report="$first_report"  # Use first one for further checks
        else
            echo -e "${GREEN}  ✓ Implementation report found${NC}"
            main_report="$first_report"
        fi
        
        # If we have a main report, check TOC requirements
        if [ -n "$main_report" ] && [ -f "$main_report" ]; then
            # Phase boundary check (Rule 2)
            if ! grep -qE '^[[:space:]]*---[[:space:]]*$' "$main_report"; then
                echo -e "${RED}  ✗ Missing phase boundary '---' in main report (Rule 2)${NC}"
                ERRORS=$((ERRORS + 1))
            fi
            
            # Link to fixes index check (Rule 2)
            if ! grep -Eiq 'post-implementation[[:space:]]*fixes|post-implementation-fixes/README\.md' "$main_report"; then
                echo -e "${RED}  ✗ Missing link to post-implementation-fixes/README.md in main report (Rule 2)${NC}"
                ERRORS=$((ERRORS + 1))
            fi
            
            # Inline artifacts check (Rule 4)
            if grep -q '^```' "$main_report"; then
                echo -e "${YELLOW}  ⚠ Fenced code blocks found in main report (Rule 4 discourages inline artifacts)${NC}"
                WARNINGS=$((WARNINGS + 1))
            fi
            
            # Status validation (Rule 7)
            if ! grep -Eq '^\*\*Status\*\*:[[:space:]]*(🚧 IN PROGRESS|✅ COMPLETE|❌ BLOCKED)' "$main_report"; then
                echo -e "${YELLOW}  ⚠ Status not standardized in main report (expected: 🚧 IN PROGRESS, ✅ COMPLETE, or ❌ BLOCKED) (Rule 7)${NC}"
                WARNINGS=$((WARNINGS + 1))
            fi
        fi
    fi
    
    # Check for post-implementation-fixes structure
    if [ -d "$feature_dir/post-implementation-fixes" ]; then
        # Check for severity subdirectories
        local severities=("critical" "high" "medium" "low")
        for severity in "${severities[@]}"; do
            if [ ! -d "$feature_dir/post-implementation-fixes/$severity" ]; then
                echo -e "${YELLOW}  ⚠ Missing severity folder: post-implementation-fixes/$severity/${NC}"
                WARNINGS=$((WARNINGS + 1))
            fi
        done
        
        # Optional: Check severity consistency in fix files
        while IFS= read -r -d '' fixfile; do
            local parent
            parent=$(basename "$(dirname "$fixfile")")
            if [[ "$parent" =~ ^(critical|high|medium|low)$ ]]; then
                if ! grep -Eiq "^\*\*Severity\*\*:[[:space:]]*.*\b${parent}\b" "$fixfile"; then
                    local filename
                    filename=$(basename "$fixfile")
                    echo -e "${YELLOW}  ⚠ Severity mismatch in $filename (folder=$parent)${NC}"
                    WARNINGS=$((WARNINGS + 1))
                fi
            fi
        done < <(find "$feature_dir/post-implementation-fixes" -type f -name '*.md' -print0 2>/dev/null || true)
    fi
    
    # Check for patches directory (Rule 8 if adopted)
    if [ -d "$feature_dir/patches" ]; then
        if [ ! -f "$feature_dir/patches/README.md" ]; then
            echo -e "${YELLOW}  ⚠ patches/ directory exists but missing README.md index (Rule 8)${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
        
        # Check patch naming convention
        while IFS= read -r -d '' patchfile; do
            local patchname
            patchname=$(basename "$patchfile")
            if ! [[ "$patchname" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-.+\.patch$ ]]; then
                echo -e "${YELLOW}  ⚠ Patch naming convention violated: $patchname (expected YYYY-MM-DD-*.patch)${NC}"
                WARNINGS=$((WARNINGS + 1))
            fi
        done < <(find "$feature_dir/patches" -type f -name '*.patch' -print0 2>/dev/null || true)
    fi
    
    # Check for deprecated patterns
    if [ -d "$feature_dir/reports" ]; then
        local deprecated_found=false
        while IFS= read -r -d '' deprecated_dir; do
            deprecated_found=true
            echo -e "${RED}  ✗ Deprecated pattern found: $(basename "$(dirname "$deprecated_dir")")/fixes/ (use post-implementation-fixes/)${NC}"
            ERRORS=$((ERRORS + 1))
        done < <(find "$feature_dir/reports" -type d -name "fixes" -print0 2>/dev/null)
    fi
    
    # Check for legacy fixing_doc directory
    if [ -d "$feature_dir/fixing_doc" ]; then
        echo -e "${YELLOW}  ⚠ Legacy directory found: fixing_doc/ (should migrate to standard structure)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    echo ""
}

# Main validation
echo "================================"
echo "Documentation Structure Validator v2"
echo "================================"
echo ""

# Find all feature directories under docs/proposal/
if [ ! -d "docs/proposal" ]; then
    echo "Error: docs/proposal directory not found"
    exit 1
fi

# Use while loop with -print0 for robust handling of all filenames
feature_count=0
while IFS= read -r -d '' feature_dir; do
    # Skip documentation_process_guide as it's meta-documentation (Rule 6)
    if [[ "$feature_dir" == *"documentation_process_guide"* ]]; then
        continue
    fi
    check_feature_structure "$feature_dir"
    feature_count=$((feature_count + 1))
done < <(find docs/proposal -mindepth 1 -maxdepth 1 -type d ! -name ".*" -print0 2>/dev/null)

if [ $feature_count -eq 0 ]; then
    echo "No feature directories found in docs/proposal/"
    exit 0
fi

# Apply strict mode if enabled
if [ "$STRICT_MODE" = true ] && [ $WARNINGS -gt 0 ]; then
    ERRORS=$((ERRORS + WARNINGS))
    WARNINGS=0
fi

# Summary
echo "================================"
echo "Validation Summary"
echo "================================"
if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}Errors: $ERRORS${NC}"
fi
if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
fi

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ All feature directories follow the Documentation Process Guide v1.4.5!${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Structure is valid but has $WARNINGS warnings${NC}"
    echo ""
    echo "To treat warnings as errors (for CI), run with --strict flag:"
    echo "  ./scripts/validate-doc-structure.sh --strict"
    exit 0
else
    echo -e "${RED}❌ Structure validation failed with $ERRORS errors${NC}"
    echo ""
    echo "Fix errors to comply with Documentation Process Guide v1.4.5"
    echo "See: docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md"
    exit 1
fi