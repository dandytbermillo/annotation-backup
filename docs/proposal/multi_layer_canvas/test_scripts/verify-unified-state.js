/**
 * Verification script for unified state management
 * Run this in browser console after enabling the feature
 */

// Step 1: Enable feature flag
function enableMultiLayer() {
  localStorage.setItem('offlineFeatureFlags', JSON.stringify({ 'ui.multiLayerCanvas': true }));
  console.log('✅ Feature flag enabled. Reloading...');
  location.reload();
}

// Step 2: Check if components are using same state
function verifyUnifiedState() {
  // Find React components in DevTools
  console.log('Open React DevTools and select LayerProvider component');
  console.log('Then run: $r.props.value.transforms');
  console.log('');
  console.log('Next, select PopupOverlay component');  
  console.log('Then run: $r.layerContext.transforms');
  console.log('');
  console.log('These should be the SAME object reference');
}

// Step 3: Test transform updates
function testTransformSync() {
  console.log('Testing transform synchronization:');
  console.log('1. Hold Alt and drag - popups layer should move');
  console.log('2. Hold Space and drag - active layer should move');
  console.log('3. Watch PopupOverlay transform in React DevTools');
  console.log('   It should update in real-time as you drag');
}

// Step 4: Verify auto-switch is not duplicated
function verifyNoDoubleSwitch() {
  console.log('Testing auto-switch:');
  console.log('1. Close all popups');
  console.log('2. Hover over a folder eye icon to create popup');
  console.log('3. Should see ONLY ONE toast notification');
  console.log('4. Check console - no duplicate state updates');
}

// Step 5: Full integration test
function fullTest() {
  console.log('=== FULL INTEGRATION TEST ===');
  console.log('');
  console.log('1. Enable feature:');
  console.log('   enableMultiLayer()');
  console.log('');
  console.log('2. After reload, open Notes Explorer');
  console.log('');
  console.log('3. Create popups by hovering folder eye icons');
  console.log('');
  console.log('4. Test keyboard shortcuts:');
  console.log('   - Tab: Toggle layers');
  console.log('   - Escape: Focus notes');
  console.log('   - Cmd/Ctrl+1: Notes layer');
  console.log('   - Cmd/Ctrl+2: Popups layer');
  console.log('');
  console.log('5. Test panning:');
  console.log('   - Alt+Drag: Pan popup layer only');
  console.log('   - Space+Drag: Pan active layer');
  console.log('');
  console.log('6. Verify in React DevTools:');
  console.log('   - LayerProvider and PopupOverlay share transforms');
  console.log('   - Transform updates propagate immediately');
  console.log('');
  console.log('Expected: All operations affect the same unified state');
}

// Helper to check current state
function checkCurrentState() {
  const flags = JSON.parse(localStorage.getItem('offlineFeatureFlags') || '{}');
  console.log('Current feature flags:', flags);
  console.log('Multi-layer enabled:', flags['ui.multiLayerCanvas'] === true);
  
  if (flags['ui.multiLayerCanvas']) {
    console.log('✅ Feature is enabled');
    console.log('Run verifyUnifiedState() to check component integration');
  } else {
    console.log('❌ Feature is disabled');
    console.log('Run enableMultiLayer() to enable');
  }
}

// Export functions for console use
window.multiLayerTest = {
  enable: enableMultiLayer,
  verify: verifyUnifiedState,
  testSync: testTransformSync,
  testSwitch: verifyNoDoubleSwitch,
  fullTest: fullTest,
  check: checkCurrentState
};

console.log('=== Multi-Layer Canvas Test Suite Loaded ===');
console.log('Available commands:');
console.log('  multiLayerTest.enable()     - Enable feature flag');
console.log('  multiLayerTest.check()      - Check current state');
console.log('  multiLayerTest.verify()     - Verify unified state');
console.log('  multiLayerTest.testSync()   - Test transform sync');
console.log('  multiLayerTest.testSwitch() - Test auto-switch');
console.log('  multiLayerTest.fullTest()   - See full test steps');
console.log('');
console.log('Start with: multiLayerTest.check()');