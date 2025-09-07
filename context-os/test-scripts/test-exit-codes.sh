#!/bin/bash

# Test script to verify exit codes are working correctly
# After fixing the command-router.js exit logic

echo "Testing Exit Codes for Command Router"
echo "====================================="
echo ""

# Test 1: Help command (should succeed)
echo "Test 1: Help command"
node command-router.js /help > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  ✅ Help command exits with 0 (success)"
else
    echo "  ❌ Help command exits with non-zero (failure)"
fi

# Test 2: Status command (should succeed)
echo "Test 2: Status command"
node command-router.js /status > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  ✅ Status command exits with 0 (success)"
else
    echo "  ❌ Status command exits with non-zero (failure)"
fi

# Test 3: Invalid command (should fail)
echo "Test 3: Invalid command"
node command-router.js /invalid-command > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "  ✅ Invalid command exits with non-zero (failure)"
else
    echo "  ❌ Invalid command exits with 0 (success)"
fi

# Test 4: Context-help alias (should succeed)
echo "Test 4: Context-help alias"
node command-router.js /context-help > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  ✅ Context-help alias exits with 0 (success)"
else
    echo "  ❌ Context-help alias exits with non-zero (failure)"
fi

# Test 5: Context-status alias (should succeed)
echo "Test 5: Context-status alias"
node command-router.js /context-status > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  ✅ Context-status alias exits with 0 (success)"
else
    echo "  ❌ Context-status alias exits with non-zero (failure)"
fi

echo ""
echo "Exit code testing complete!"
echo ""
echo "Note: Fixed multiple issues:"
echo "1. Exit logic now handles both patterns:"
echo "   const success = result && (result.ok === true || result.status === 'ok');"
echo "2. Added missing import: const { execSync } = require('child_process');"
echo "3. Invalid commands now return { ok: false } instead of help's { ok: true }"
echo ""
echo "This ensures proper exit codes for all command types."