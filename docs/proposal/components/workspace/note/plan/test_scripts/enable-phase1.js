/**
 * Phase 1 Testing Helper - Enable/Disable Live State Flag
 *
 * Run this in your browser console to enable Phase 1 ownership plumbing.
 * After enabling, refresh the page to activate the feature.
 */

// === ENABLE PHASE 1 ===
function enablePhase1() {
  localStorage.setItem('NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE', 'enabled');
  console.log('✅ Phase 1 (Live State) ENABLED');
  console.log('🔄 Refresh the page to activate');
  console.log('');
  console.log('Expected behavior:');
  console.log('- Runtime creation logs in console');
  console.log('- Stale write rejection warnings (if applicable)');
  console.log('- Runtime-first writes for ownership data');
  return 'Enabled - Please refresh the page';
}

// === DISABLE PHASE 1 ===
function disablePhase1() {
  localStorage.setItem('NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE', 'disabled');
  console.log('❌ Phase 1 (Live State) DISABLED');
  console.log('🔄 Refresh the page to deactivate');
  console.log('');
  console.log('Expected behavior:');
  console.log('- No runtime creation logs');
  console.log('- Ref-based storage (legacy behavior)');
  return 'Disabled - Please refresh the page';
}

// === CHECK STATUS ===
function checkPhase1Status() {
  const flag = localStorage.getItem('NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE');
  const enabled = ['enabled', 'true', '1', 'on'].includes((flag || '').toLowerCase());

  console.log('Phase 1 Status:', enabled ? '✅ ENABLED' : '❌ DISABLED');
  console.log('LocalStorage value:', flag);
  console.log('');

  if (enabled) {
    console.log('Runtime-first writes are active');
    console.log('Check console for:');
    console.log('  - [WorkspaceRuntime] Created new runtime...');
    console.log('  - [WorkspaceRuntime] Rejected stale write...');
  } else {
    console.log('Using legacy ref-based storage');
  }

  return { enabled, flag };
}

// === RUNTIME DEBUG VIEWER ===
function showRuntimeDebugInfo() {
  if (typeof window.__DEBUG_RUNTIME__ === 'undefined') {
    console.warn('⚠️ Runtime debug tools not available');
    console.log('To enable, add this to runtime-manager.ts:');
    console.log(`
if (process.env.NODE_ENV === 'development') {
  window.__DEBUG_RUNTIME__ = {
    getRuntimes: () => Array.from(runtimes.entries()).map(([id, rt]) => ({
      id,
      openNotesCount: rt.openNotes.length,
      membershipSize: rt.membership.size,
      status: rt.status,
      openNotesUpdatedAt: rt.openNotesUpdatedAt,
      membershipUpdatedAt: rt.membershipUpdatedAt,
    })),
    getRuntime: (id) => runtimes.get(id),
  };
}
    `);
    return;
  }

  const runtimes = window.__DEBUG_RUNTIME__.getRuntimes();
  console.log('=== Active Runtimes ===');
  console.table(runtimes);
  return runtimes;
}

// === QUICK SETUP ===
console.log('=== Phase 1 Testing Helper Loaded ===');
console.log('');
console.log('Available commands:');
console.log('  enablePhase1()      - Enable live state ownership plumbing');
console.log('  disablePhase1()     - Disable and use legacy behavior');
console.log('  checkPhase1Status() - Check current flag status');
console.log('  showRuntimeDebugInfo() - View active runtimes (if debug enabled)');
console.log('');
console.log('Current status:');
checkPhase1Status();

// Export to window for easy access
window.phase1Testing = {
  enable: enablePhase1,
  disable: disablePhase1,
  status: checkPhase1Status,
  debug: showRuntimeDebugInfo,
};

console.log('');
console.log('Quick access: window.phase1Testing.*');
