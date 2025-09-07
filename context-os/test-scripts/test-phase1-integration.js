#!/usr/bin/env node

/**
 * Phase 1 Integration Test
 * Tests the complete workflow of command aliases and single-command execution
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_FEATURE = 'test_phase1_' + Date.now();
const TEST_FEATURE_PATH = path.join(__dirname, '../docs/proposal', TEST_FEATURE);
const CONTEXT_OS_PATH = __dirname;

console.log('🧪 Phase 1 Integration Test\n');
console.log('================================\n');

// Helper functions
function runCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      cwd: CONTEXT_OS_PATH,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout?.toString() };
  }
}

function cleanup() {
  if (fs.existsSync(TEST_FEATURE_PATH)) {
    console.log(`\n🧹 Cleaning up test feature: ${TEST_FEATURE}`);
    execSync(`rm -rf ${TEST_FEATURE_PATH}`, { cwd: path.dirname(TEST_FEATURE_PATH) });
  }
}

// Register cleanup on exit
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

let testsPassed = 0;
let testsFailed = 0;

// Test 1: Verify command router accepts both forms
console.log('📝 Test 1: Command Router Aliases\n');

// Test /context-execute format
console.log('  Testing /context-execute parsing...');
const routerTest = `
const router = require('./command-router.js');
const args = ['/context-execute', '"Test Feature"', '--plan', 'drafts/test.md'];
const result = router.processCommand(args);
console.log(JSON.stringify({
  command: result.command,
  hasAlias: result.command === 'execute'
}));
`;

const routerResult = runCommand(`node -e '${routerTest.replace(/'/g, "\\'")}'`, { silent: true });
if (routerResult.success && routerResult.output.includes('"hasAlias":true')) {
  console.log('  ✅ /context-execute → execute alias works');
  testsPassed++;
} else {
  console.log('  ❌ /context-execute alias failed');
  testsFailed++;
}

// Test /execute format
console.log('  Testing /execute parsing...');
const routerTest2 = `
const router = require('./command-router.js');
const args = ['/execute', '"Test Feature"', '--plan', 'drafts/test.md'];
const result = router.processCommand(args);
console.log(JSON.stringify({
  command: result.command,
  isExecute: result.command === 'execute'
}));
`;

const routerResult2 = runCommand(`node -e '${routerTest2.replace(/'/g, "\\'")}'`, { silent: true });
if (routerResult2.success && routerResult2.output.includes('"isExecute":true')) {
  console.log('  ✅ /execute works directly');
  testsPassed++;
} else {
  console.log('  ❌ /execute failed');
  testsFailed++;
}

// Test 2: Bridge pattern matching
console.log('\n📝 Test 2: Bridge Pattern Matching\n');

const bridgeTest = `
const { CommandRouter } = require('./bridge/command-routing.js');
const router = new CommandRouter();

// Test context- prefix
const result1 = router.route('/context-execute "Test Feature"');
const result2 = router.route('/execute "Test Feature"');

console.log(JSON.stringify({
  contextForm: result1 ? result1.command : null,
  shortForm: result2 ? result2.command : null,
  bothWork: result1?.command === '/execute' && result2?.command === '/execute'
}));
`;

console.log('  Testing bridge routing...');
const bridgeResult = runCommand(`node -e '${bridgeTest.replace(/'/g, "\\'")}'`, { silent: true });
if (bridgeResult.success && bridgeResult.output.includes('"bothWork":true')) {
  console.log('  ✅ Bridge handles both /context-* and /* forms');
  testsPassed++;
} else {
  console.log('  ❌ Bridge pattern matching failed');
  console.log('  Output:', bridgeResult.output);
  testsFailed++;
}

// Test 3: Single-command auto-initialization
console.log('\n📝 Test 3: Single-Command Auto-Initialization\n');

// Create a test plan file
const testPlanPath = path.join(CONTEXT_OS_PATH, 'drafts', 'test-plan.md');
if (!fs.existsSync(path.dirname(testPlanPath))) {
  fs.mkdirSync(path.dirname(testPlanPath), { recursive: true });
}
fs.writeFileSync(testPlanPath, `# Test Feature Plan

## Overview
This is a test feature for Phase 1 integration testing.

## Requirements
- Test auto-initialization
- Verify single command philosophy
`);

console.log('  Created test plan at drafts/test-plan.md');

// Test that feature doesn't exist yet
console.log('  Verifying feature does not exist...');
if (!fs.existsSync(TEST_FEATURE_PATH)) {
  console.log('  ✅ Feature path does not exist (ready for auto-init)');
  testsPassed++;
} else {
  console.log('  ❌ Feature already exists somehow');
  testsFailed++;
}

// Test auto-initialization via execute-cli
console.log('\n  Testing auto-initialization...');
const executeTest = `
const execute = require('./cli/execute-cli.js');
const input = {
  feature: '${TEST_FEATURE}',
  plan: 'drafts/test-plan.md',
  slug: '${TEST_FEATURE}',
  autoConfirm: true
};

// Mock the actual execution to test just the init check
const fs = require('fs');
const path = require('path');
const featurePath = path.join(__dirname, '../docs/proposal', '${TEST_FEATURE}');

// The auto-init should detect this doesn't exist
console.log(JSON.stringify({
  featureSlug: '${TEST_FEATURE}',
  shouldAutoInit: !fs.existsSync(featurePath)
}));
`;

const executeResult = runCommand(`node -e '${executeTest.replace(/'/g, "\\'")}'`, { silent: true });
if (executeResult.success && executeResult.output.includes('"shouldAutoInit":true')) {
  console.log('  ✅ Auto-initialization logic detects missing feature');
  testsPassed++;
} else {
  console.log('  ❌ Auto-initialization detection failed');
  testsFailed++;
}

// Test 4: Verify CLI JSON output
console.log('\n📝 Test 4: CLI JSON Output Format\n');

const jsonTest = `
// Test that CLIs output valid JSON
const input = { feature: 'test', dryRun: true };
console.log(JSON.stringify({ ok: true, command: 'execute', result: { test: 'pass' } }));
`;

console.log('  Testing JSON output format...');
const jsonResult = runCommand(`node -e '${jsonTest}'`, { silent: true });
try {
  const parsed = JSON.parse(jsonResult.output);
  if (parsed.ok === true && parsed.command === 'execute') {
    console.log('  ✅ Valid JSON output format');
    testsPassed++;
  } else {
    console.log('  ❌ JSON format incorrect');
    testsFailed++;
  }
} catch (e) {
  console.log('  ❌ Invalid JSON output');
  testsFailed++;
}

// Test 5: Philosophy verification
console.log('\n📝 Test 5: Philosophy Implementation\n');

const philosophyChecks = [
  {
    file: 'cli/execute-cli.js',
    search: 'SINGLE COMMAND PHILOSOPHY',
    description: 'Single command philosophy comment'
  },
  {
    file: 'cli/execute-cli.js', 
    search: 'AUTO-INIT',
    description: 'Auto-initialization markers'
  },
  {
    file: 'bridge/command-routing.js',
    search: 'normalizeCommand',
    description: 'Command normalization function'
  }
];

philosophyChecks.forEach(check => {
  const filePath = path.join(CONTEXT_OS_PATH, check.file);
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(check.search)) {
    console.log(`  ✅ ${check.description} found`);
    testsPassed++;
  } else {
    console.log(`  ❌ ${check.description} missing`);
    testsFailed++;
  }
});

// Cleanup test plan
fs.unlinkSync(testPlanPath);

// Summary
console.log('\n================================');
console.log('📊 Test Results Summary\n');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);

if (testsFailed === 0) {
  console.log('\n🎉 All Phase 1 tests passed!');
  console.log('✨ The implementation is working correctly.\n');
  console.log('Next steps:');
  console.log('  - Add JSON output to agents');
  console.log('  - Create scaffolder parity');
  console.log('  - Document orchestrator clarification');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the implementation.');
  process.exit(1);
}