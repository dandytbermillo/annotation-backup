#!/usr/bin/env bash

# Stable router for /features command
# This file should NEVER change - behavior changes happen in the scripts it calls

set -euo pipefail

# Navigate to project root
cd "$(dirname "$0")/../.."

# Always rebuild the features data (ensures fresh output)
node scripts/scan-features.js > var/features.json 2>/dev/null

# Process all arguments as a single string and extract meaningful parts
ALL_ARGS="$*"

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