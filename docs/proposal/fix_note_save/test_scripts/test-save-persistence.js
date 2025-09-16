#!/usr/bin/env node

/**
 * Test Script: Verify Note Content Persistence
 * 
 * This script tests that note content saves immediately without requiring multiple reloads.
 * Run this in the browser console to test the fix.
 */

(async function testNoteSavePersistence() {
  console.log('%c=== Testing Note Save Persistence ===', 'color: blue; font-size: 16px; font-weight: bold');
  
  // Step 1: Check current environment
  console.log('\n📋 Step 1: Checking environment...');
  
  // Check for PlainOfflineProvider
  const hasProvider = typeof window.plainOfflineProvider !== 'undefined' || 
                     document.querySelector('[data-provider="plain"]');
  console.log(hasProvider ? '✅ Plain provider detected' : '⚠️ Plain provider not detected');
  
  // Step 2: Test document save
  console.log('\n📋 Step 2: Testing document save...');
  
  const testContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Test content saved at: ' + new Date().toISOString()
          }
        ]
      }
    ]
  };
  
  // Simulate a save via API
  const testNoteId = 'test-note-' + Date.now();
  const testPanelId = 'main';
  
  try {
    const response = await fetch(`/api/postgres-offline/documents/${testNoteId}/${testPanelId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: testContent,
        version: 1
      })
    });
    
    if (response.ok) {
      console.log('✅ Document saved successfully');
      
      // Try to load it back immediately
      const loadResponse = await fetch(`/api/postgres-offline/documents/${testNoteId}/${testPanelId}`);
      if (loadResponse.ok) {
        const loaded = await loadResponse.json();
        console.log('✅ Document loaded successfully:', loaded);
        
        // Verify content matches
        if (JSON.stringify(loaded.content) === JSON.stringify(testContent)) {
          console.log('✅ Content matches! Save/load working correctly');
        } else {
          console.error('❌ Content mismatch!');
          console.log('Expected:', testContent);
          console.log('Got:', loaded.content);
        }
      } else {
        console.error('❌ Failed to load document:', loadResponse.status);
      }
    } else {
      console.error('❌ Failed to save document:', response.status);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  // Step 3: Check for batching
  console.log('\n📋 Step 3: Checking batch manager...');
  
  // Look for batch manager in window
  const hasBatchManager = !!(window.plainBatchManager || window.__batchManager);
  console.log(hasBatchManager ? '⚠️ Batch manager detected (may delay saves)' : '✅ No batch manager (immediate saves)');
  
  // Step 4: Check debounce timers
  console.log('\n📋 Step 4: Checking debounce timers...');
  
  const debouncedSaves = window.__debouncedSave;
  if (debouncedSaves && debouncedSaves.size > 0) {
    console.log(`⚠️ Found ${debouncedSaves.size} pending debounced saves`);
    debouncedSaves.forEach((timer, key) => {
      console.log(`  - ${key}: timer ID ${timer}`);
    });
  } else {
    console.log('✅ No pending debounced saves');
  }
  
  // Step 5: Manual test instructions
  console.log('\n📋 Step 5: Manual Test Instructions:');
  console.log('%c1. Open a note and edit some content', 'color: green');
  console.log('%c2. Wait 1 second for auto-save', 'color: green');
  console.log('%c3. Refresh the page (F5)', 'color: green');
  console.log('%c4. Content should appear immediately', 'color: green');
  console.log('%c   (No second refresh needed!)', 'color: orange; font-weight: bold');
  
  console.log('\n%c=== Test Complete ===', 'color: blue; font-size: 16px; font-weight: bold');
  
  return {
    hasProvider,
    hasBatchManager,
    pendingSaves: debouncedSaves ? debouncedSaves.size : 0
  };
})();