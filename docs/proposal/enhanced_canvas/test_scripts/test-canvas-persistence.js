#!/usr/bin/env node

/**
 * Test script to verify canvas state persistence
 * Runs in browser console to test localStorage functionality
 * 
 * Instructions:
 * 1. Open http://localhost:3000 in browser
 * 2. Open browser developer console (F12)
 * 3. Copy and paste this entire script into console
 * 4. Follow the prompts to test persistence
 */

// Test Canvas Persistence
(function testCanvasPersistence() {
  console.log('%c=== Canvas State Persistence Test ===', 'color: blue; font-size: 16px; font-weight: bold');
  
  // Check if we're on the right page
  if (!window.location.href.includes('localhost:3000')) {
    console.error('❌ Please run this test on http://localhost:3000');
    return;
  }
  
  // Step 1: Check localStorage availability
  console.log('\n📋 Step 1: Checking localStorage...');
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    console.log('✅ localStorage is available');
  } catch (e) {
    console.error('❌ localStorage is not available:', e);
    return;
  }
  
  // Step 2: Look for canvas state keys
  console.log('\n📋 Step 2: Looking for canvas state keys...');
  const canvasKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes('annotation-canvas-state')) {
      canvasKeys.push(key);
    }
  }
  
  if (canvasKeys.length > 0) {
    console.log(`✅ Found ${canvasKeys.length} canvas state keys:`);
    canvasKeys.forEach(key => {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        console.log(`  - ${key}:`, {
          noteId: data.noteId,
          savedAt: new Date(data.savedAt).toLocaleString(),
          version: data.version,
          itemCount: data.items ? data.items.length : 0,
          viewport: data.viewport
        });
      } catch (e) {
        console.log(`  - ${key}: (unable to parse)`);
      }
    });
  } else {
    console.log('⚠️ No canvas state keys found yet');
    console.log('   Try: 1) Select a note, 2) Move panels, 3) Wait 1 second, 4) Refresh page');
  }
  
  // Step 3: Check storage statistics
  console.log('\n📋 Step 3: Storage statistics...');
  let totalSize = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    if (key && value) {
      totalSize += key.length + value.length;
    }
  }
  
  const canvasSize = canvasKeys.reduce((sum, key) => {
    const value = localStorage.getItem(key);
    return sum + (value ? key.length + value.length : 0);
  }, 0);
  
  console.log(`📊 Storage usage:`);
  console.log(`  - Total localStorage: ${(totalSize / 1024).toFixed(2)} KB`);
  console.log(`  - Canvas states: ${(canvasSize / 1024).toFixed(2)} KB`);
  console.log(`  - Canvas percentage: ${totalSize ? ((canvasSize / totalSize) * 100).toFixed(1) : 0}%`);
  
  // Step 4: Test save/load functions
  console.log('\n📋 Step 4: Testing save/load cycle...');
  
  const testNoteId = 'test-note-' + Date.now();
  const testData = {
    noteId: testNoteId,
    savedAt: Date.now(),
    version: '1.1.0',
    viewport: {
      zoom: 1.5,
      translateX: 100,
      translateY: 200,
      showConnections: true
    },
    items: [
      {
        id: 'test-panel-1',
        itemType: 'panel',
        position: { x: 1000, y: 500 },
        panelId: 'main',
        panelType: 'main'
      }
    ]
  };
  
  const testKey = `annotation-canvas-state:${testNoteId}`;
  
  try {
    // Save
    localStorage.setItem(testKey, JSON.stringify(testData));
    console.log('✅ Test save successful');
    
    // Load
    const loaded = JSON.parse(localStorage.getItem(testKey));
    if (loaded && loaded.noteId === testNoteId) {
      console.log('✅ Test load successful');
      console.log('   Loaded data:', loaded);
    } else {
      console.error('❌ Test load failed');
    }
    
    // Cleanup
    localStorage.removeItem(testKey);
    console.log('✅ Test cleanup successful');
  } catch (e) {
    console.error('❌ Test failed:', e);
  }
  
  // Step 5: Instructions for manual testing
  console.log('\n📋 Step 5: Manual Test Instructions:');
  console.log('%c1. Select a note in the UI', 'color: green');
  console.log('%c2. Move some panels around (drag them)', 'color: green');
  console.log('%c3. Zoom in/out (Shift + scroll wheel)', 'color: green');
  console.log('%c4. Wait 1 second for auto-save', 'color: green');
  console.log('%c5. Refresh the page (F5)', 'color: green');
  console.log('%c6. Select the same note', 'color: green');
  console.log('%c7. Canvas should restore to saved position', 'color: green');
  
  console.log('\n%c=== Test Complete ===', 'color: blue; font-size: 16px; font-weight: bold');
  
  // Return test results
  return {
    localStorageAvailable: true,
    canvasStatesFound: canvasKeys.length,
    storageUsedKB: (totalSize / 1024).toFixed(2),
    canvasStorageKB: (canvasSize / 1024).toFixed(2)
  };
})();