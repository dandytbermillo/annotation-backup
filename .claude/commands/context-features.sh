#!/usr/bin/env bash

# Stable router for /features command
# This file should NEVER change - behavior changes happen in the scripts it calls

set -euo pipefail

# Navigate to project root
cd "$(dirname "$0")/../.."

# Process all arguments as a single string
ALL_ARGS="$*"

# Check for help flag first
if [[ "$ALL_ARGS" =~ --help ]] || [[ "$ALL_ARGS" =~ -h ]]; then
  cat << 'EOF'
📋 Context-Features Command Help
════════════════════════════════════════════════════════════

Purpose: Show status of all Context-OS features

Usage:
  /context-features                    # Show all features (table)
  /context-features --format <type>    # Choose output format
  /context-features --feature <slug>   # Show specific feature
  /context-features --help            # Show this help

Output Formats:
  table     - Compact table view (default)
  detailed  - Detailed view with all fields
  summary   - Summary with action items
  json      - Raw JSON output

Examples:
  /context-features
  /context-features --format summary
  /context-features --feature add_dark_mode
  /context-features --format detailed

Status Icons:
  📝 PLANNED     - Ready to implement
  🚧 IN PROGRESS - Currently being worked on
  ✅ COMPLETE    - Implementation finished
  ❌ BLOCKED     - Has blocking issues
  ❓ UNKNOWN     - Missing implementation report

Columns:
  📊 - Total file count in feature
  🔧 - Post-implementation fixes count
  ⚠️  - Validation issues count

For more info: npm run context:help
EOF
  exit 0
fi

# Always rebuild the features data (ensures fresh output)
node scripts/scan-features.js > var/features.json 2>/dev/null

# Extract clean arguments by removing "is running..." noise
# Look for actual flags like --format, --feature, --refresh
CLEAN_ARGS=""

if [[ "$ALL_ARGS" =~ --format[[:space:]]+([^[:space:]]+) ]]; then
  CLEAN_ARGS="$CLEAN_ARGS --format ${BASH_REMATCH[1]}"
fi

if [[ "$ALL_ARGS" =~ --feature[[:space:]]+([^[:space:]]+) ]]; then
  CLEAN_ARGS="$CLEAN_ARGS --feature ${BASH_REMATCH[1]}"
fi

if [[ "$ALL_ARGS" =~ --refresh ]]; then
  CLEAN_ARGS="$CLEAN_ARGS --refresh"
fi

# Pass cleaned arguments to show-features.js
if [[ -n "$CLEAN_ARGS" ]]; then
  node scripts/show-features.js $CLEAN_ARGS
else
  node scripts/show-features.js
fi

# Show refresh note if --refresh flag is present
if [[ "$ALL_ARGS" =~ --refresh ]]; then
  echo ""
  echo "✅ Features data refreshed"
fi