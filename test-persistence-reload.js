#!/usr/bin/env node

// Test script to verify persistence works across multiple reloads
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function runTest() {
  console.log('Testing persistence across multiple reloads...\n');
  
  // Step 1: Start the dev server
  console.log('1. Starting development server...');
  const server = exec('npm run dev');
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('\n2. Opening browser and testing...');
  console.log('   - Load the page');
  console.log('   - Edit text in a panel');
  console.log('   - Reload (first time) - should preserve edits');
  console.log('   - Edit text again');
  console.log('   - Reload (second time) - should preserve new edits');
  console.log('   - Edit text again');
  console.log('   - Reload (third time) - should preserve all edits');
  
  console.log('\nManual testing required. Check browser console for:');
  console.log('- "Setting up persistence for..." messages');
  console.log('- "Persisted update X for..." messages');
  console.log('- "Persistence handler already set up..." messages');
  console.log('- Any error messages about failed persistence');
  
  console.log('\nPress Ctrl+C to stop the server when done testing.');
}

runTest().catch(console.error);