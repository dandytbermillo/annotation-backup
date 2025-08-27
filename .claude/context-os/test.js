#!/usr/bin/env node

/**
 * Test script for Context-OS
 * Verifies all components are working correctly
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONTEXT_OS_ROOT = __dirname;
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function run(command, options = {}) {
  try {
    return execSync(command, { 
      cwd: CONTEXT_OS_ROOT, 
      encoding: 'utf8',
      ...options 
    });
  } catch (e) {
    if (options.allowFailure) return e.stdout || e.message;
    throw e;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Define tests

test('CLI tools are executable', () => {
  const tools = ['context', 'context-index', 'context-hook'];
  tools.forEach(tool => {
    const toolPath = path.join(CONTEXT_OS_ROOT, 'bin', tool);
    assert(fs.existsSync(toolPath), `${tool} not found`);
    const stats = fs.statSync(toolPath);
    assert(stats.mode & 0o100, `${tool} not executable`);
  });
});

test('Context CLI shows help', () => {
  const output = run('./bin/context --help');
  assert(output.includes('Context-OS CLI'), 'Help text not found');
  assert(output.includes('Commands:'), 'Commands list not found');
});

test('Directory structure exists', () => {
  const dirs = [
    'knowledge/patterns',
    'knowledge/errors', 
    'knowledge/decisions',
    'current',
    'rules'
  ];
  
  dirs.forEach(dir => {
    const dirPath = path.join(CONTEXT_OS_ROOT, dir);
    assert(fs.existsSync(dirPath), `Directory ${dir} not found`);
  });
});

test('Can build search index', () => {
  const output = run('./bin/context-index build');
  assert(output.includes('Index built'), 'Index build failed');
  
  const indexFile = path.join(CONTEXT_OS_ROOT, 'indexes/knowledge.json');
  assert(fs.existsSync(indexFile), 'Index file not created');
  
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  assert(index.documents, 'Index missing documents');
  assert(index.created, 'Index missing created timestamp');
});

test('Can search knowledge base', () => {
  // First ensure index exists
  run('./bin/context-index build');
  
  const output = run('./bin/context search "test"', { allowFailure: true });
  // Should either find results or say "No results found"
  assert(
    output.includes('Search Results') || output.includes('No results found'),
    'Search output invalid'
  );
});

test('Can extract current context', () => {
  const output = run('./bin/context extract');
  assert(output.includes('Context extracted'), 'Extract failed');
  
  const extractedFile = path.join(CONTEXT_OS_ROOT, 'current/extracted.md');
  assert(fs.existsSync(extractedFile), 'Extracted file not created');
});

test('Can load context', () => {
  const output = run('./bin/context load');
  assert(output.includes('Context OS - Loaded Context'), 'Context load failed');
  assert(output.includes('Generated:'), 'Missing generation timestamp');
});

test('Context loader works', () => {
  const output = run('node context-loader.js minimal');
  assert(output.includes('Context OS - Generated Context'), 'Loader failed');
  assert(output.includes('Project Summary'), 'Missing project summary');
});

test('Can learn from errors', () => {
  const output = run('./bin/context learn "Test error" -s "Test solution"');
  assert(output.includes('Error recorded'), 'Learn command failed');
  
  // Check if error file was created
  const errorFiles = fs.readdirSync(path.join(CONTEXT_OS_ROOT, 'knowledge/errors'));
  const testError = errorFiles.find(f => f.includes('test-error'));
  assert(testError, 'Error file not created');
});

test('Git hooks are set up correctly', () => {
  const gitDir = path.join(CONTEXT_OS_ROOT, '../../.git');
  if (fs.existsSync(gitDir)) {
    const preCommit = path.join(gitDir, 'hooks/pre-commit');
    const postCommit = path.join(gitDir, 'hooks/post-commit');
    
    // Hooks might not exist if setup hasn't been run
    if (fs.existsSync(preCommit)) {
      const content = fs.readFileSync(preCommit, 'utf8');
      assert(content.includes('context-hook'), 'Pre-commit hook not configured');
    }
  }
});

test('Package.json is valid', () => {
  const packagePath = path.join(CONTEXT_OS_ROOT, 'package.json');
  assert(fs.existsSync(packagePath), 'package.json not found');
  
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert(pkg.name === 'context-os', 'Invalid package name');
  assert(pkg.dependencies, 'No dependencies defined');
});

// Run tests

console.log('🧪 Running Context-OS Tests...\n');

tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   ${e.message}`);
    failed++;
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed. Run ./setup.sh to fix issues.');
  process.exit(1);
} else {
  console.log('\n✨ All tests passed! Context-OS is ready to use.');
  console.log('\nNext steps:');
  console.log('1. Run: ./bin/context --help');
  console.log('2. Start watching: ./bin/context watch --daemon');
  console.log('3. Search knowledge: ./bin/context search "your query"');
}