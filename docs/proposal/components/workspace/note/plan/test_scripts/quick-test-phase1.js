/**
 * Quick Phase 1 Test Script
 *
 * Copy this entire script and paste into browser console after opening http://localhost:3001
 */

console.clear();
console.log('═══════════════════════════════════════');
console.log('Phase 1 Ownership Plumbing - Quick Test');
console.log('═══════════════════════════════════════\n');

// Check flag status
const envFlag = 'NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE';
const flagValue = localStorage.getItem(envFlag);

console.log('1. Feature Flag Check:');
console.log('   Flag:', envFlag);
console.log('   Value:', flagValue || '(not set in localStorage)');
console.log('   Expected: "enabled" or null (will use .env.local)');
console.log('');

if (flagValue && !['enabled', 'true', '1', 'on'].includes(flagValue.toLowerCase())) {
  console.warn('   ⚠️ Flag is set but NOT enabled');
  console.log('   Run this to enable: localStorage.setItem("' + envFlag + '", "enabled")');
} else {
  console.log('   ✅ Flag is enabled (or will use .env.local default)');
}

console.log('');
console.log('═══════════════════════════════════════');
console.log('2. What to Look For:');
console.log('═══════════════════════════════════════\n');

console.log('When Phase 1 is active, you should see:');
console.log('');
console.log('✅ Runtime Creation:');
console.log('   [WorkspaceRuntime] Created new runtime for workspace: <id>');
console.log('   { totalRuntimes: N, runtimeIds: [...] }');
console.log('');
console.log('✅ Stale Write Rejection (if it occurs):');
console.log('   [WorkspaceRuntime] Rejected stale openNotes write...');
console.log('   { attemptedTimestamp, currentTimestamp, staleness, ... }');
console.log('');

console.log('═══════════════════════════════════════');
console.log('3. Testing Steps:');
console.log('═══════════════════════════════════════\n');

console.log('Step 1: Watch this console for runtime logs');
console.log('Step 2: Create a new workspace or switch to existing one');
console.log('Step 3: Add notes to the workspace');
console.log('Step 4: Create another workspace');
console.log('Step 5: Rapidly switch between workspaces');
console.log('');
console.log('Expected: Notes persist, no data loss');
console.log('');

console.log('═══════════════════════════════════════');
console.log('4. Quick Actions:');
console.log('═══════════════════════════════════════\n');

// Add helper functions to window
window.phase1Test = {
  enableFlag: function() {
    localStorage.setItem('NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE', 'enabled');
    console.log('✅ Flag enabled. Refresh page to activate.');
  },
  disableFlag: function() {
    localStorage.setItem('NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE', 'disabled');
    console.log('❌ Flag disabled. Refresh page to deactivate.');
  },
  checkStatus: function() {
    const val = localStorage.getItem('NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE');
    const enabled = ['enabled', 'true', '1', 'on'].includes((val || '').toLowerCase());
    console.log('Status:', enabled ? '✅ ENABLED' : '❌ DISABLED');
    console.log('Value:', val || '(using .env.local)');
    return { enabled, value: val };
  },
  clearConsole: function() {
    console.clear();
    console.log('Console cleared. Watching for runtime logs...');
  }
};

console.log('Available commands:');
console.log('  window.phase1Test.enableFlag()    - Enable live state');
console.log('  window.phase1Test.disableFlag()   - Disable live state');
console.log('  window.phase1Test.checkStatus()   - Check current status');
console.log('  window.phase1Test.clearConsole()  - Clear console and watch');
console.log('');

console.log('═══════════════════════════════════════');
console.log('Ready! Watching for runtime logs...');
console.log('═══════════════════════════════════════\n');

// Monitor console.warn and console.log for runtime messages
const originalWarn = console.warn;
const originalLog = console.log;

console.warn = function(...args) {
  // Check if this is a WorkspaceRuntime warning
  const message = args.join(' ');
  if (message.includes('[WorkspaceRuntime]') || message.includes('Rejected stale')) {
    console.log('\n🔴 PHASE 1 STALE WRITE DETECTED:');
  }
  originalWarn.apply(console, args);
};

console.log = function(...args) {
  // Check if this is a WorkspaceRuntime log
  const message = args.join(' ');
  if (message.includes('[WorkspaceRuntime]') && message.includes('Created new runtime')) {
    console.log('\n🟢 PHASE 1 RUNTIME CREATED:');
  }
  originalLog.apply(console, args);
};

console.log('Console monitoring active. Create/switch workspaces to test...\n');
