#!/usr/bin/env node

/**
 * Manual test script for auto-edit mode functionality
 * Run this in the browser console to verify auto-edit behavior
 */

console.log('=== Auto-Edit Mode Test Suite ===\n');

// Test 1: Check if main panel is in edit mode when empty
function testMainPanelAutoEdit() {
  console.log('Test 1: Main Panel Auto-Edit Mode');
  
  const mainPanel = document.querySelector('[data-panel-id="main"]');
  if (!mainPanel) {
    console.error('❌ Main panel not found');
    return false;
  }
  
  const editor = mainPanel.querySelector('.ProseMirror');
  if (!editor) {
    console.error('❌ Editor not found in main panel');
    return false;
  }
  
  const isEditable = editor.contentEditable === 'true';
  const isFocused = document.activeElement === editor;
  const isEmpty = editor.textContent.trim() === '';
  
  console.log('  Editable:', isEditable);
  console.log('  Focused:', isFocused);
  console.log('  Empty:', isEmpty);
  
  if (isEmpty && isEditable && isFocused) {
    console.log('✅ Main panel correctly auto-focused when empty');
    return true;
  } else if (!isEmpty) {
    console.log('ℹ️ Main panel has content - auto-focus not required');
    return true;
  } else {
    console.error('❌ Main panel should be auto-focused when empty');
    return false;
  }
}

// Test 2: Check all panels for correct edit state
function testAllPanelsEditState() {
  console.log('\nTest 2: All Panels Edit State');
  
  const panels = document.querySelectorAll('.panel');
  const results = [];
  
  panels.forEach(panel => {
    const panelId = panel.dataset.panelId || panel.getAttribute('data-panel-id');
    const editor = panel.querySelector('.ProseMirror');
    
    if (editor) {
      const isEditable = editor.contentEditable === 'true';
      const isFocused = document.activeElement === editor;
      const content = editor.textContent.trim();
      const isEmpty = content === '' || content.includes('Start writing your');
      
      results.push({
        panelId,
        isEditable,
        isFocused,
        isEmpty,
        contentPreview: content.substring(0, 50)
      });
      
      console.log(`  Panel ${panelId}:`);
      console.log(`    - Editable: ${isEditable}`);
      console.log(`    - Focused: ${isFocused}`);
      console.log(`    - Empty: ${isEmpty}`);
      
      if (isEmpty && !isEditable) {
        console.error(`    ❌ Empty panel should be editable`);
      }
    }
  });
  
  return results;
}

// Test 3: Simulate note switching
function testNoteSwitching() {
  console.log('\nTest 3: Note Switching Focus Test');
  console.log('  (This test requires manual interaction)');
  console.log('  1. Click on a different note in the sidebar');
  console.log('  2. Check if empty note auto-focuses');
  console.log('  3. Run testMainPanelAutoEdit() again');
}

// Test 4: Check focus attempts in console
function checkFocusLogs() {
  console.log('\nTest 4: Focus Attempt Logs');
  console.log('  Look for these console messages:');
  console.log('  - [CanvasPanel] Auto-focusing main panel');
  console.log('  - [CanvasPanel] Focus attempt at XXXms');
  console.log('  - [TiptapEditorPlain] Auto-focusing empty/placeholder panel');
  console.log('\n  To see logs, enable verbose console output or check browser dev tools');
}

// Run all tests
function runAllTests() {
  console.log('Running all auto-edit mode tests...\n');
  
  const test1 = testMainPanelAutoEdit();
  const test2 = testAllPanelsEditState();
  
  console.log('\n=== Test Summary ===');
  console.log('Test 1 (Main Panel):', test1 ? '✅ PASSED' : '❌ FAILED');
  console.log('Test 2 (All Panels): See results above');
  console.log('Test 3 (Note Switch): Manual test required');
  console.log('Test 4 (Logs): Check console output');
  
  // Return helper functions for manual testing
  return {
    testMain: testMainPanelAutoEdit,
    testAll: testAllPanelsEditState,
    checkLogs: checkFocusLogs,
    
    // Utility function to force focus
    focusMain: () => {
      const editor = document.querySelector('[data-panel-id="main"] .ProseMirror');
      if (editor) {
        editor.focus();
        console.log('Forced focus on main panel');
      }
    },
    
    // Check if any editor is focused
    getFocusedEditor: () => {
      const focused = document.activeElement;
      if (focused && focused.classList.contains('ProseMirror')) {
        const panel = focused.closest('.panel');
        const panelId = panel ? panel.dataset.panelId : 'unknown';
        console.log(`Currently focused: Panel ${panelId}`);
        return panelId;
      } else {
        console.log('No editor currently focused');
        return null;
      }
    }
  };
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  window.autoEditTests = runAllTests();
  console.log('\n💡 Tests loaded! Use window.autoEditTests for manual testing:');
  console.log('  - autoEditTests.testMain() - Test main panel');
  console.log('  - autoEditTests.testAll() - Test all panels');
  console.log('  - autoEditTests.focusMain() - Force focus main panel');
  console.log('  - autoEditTests.getFocusedEditor() - Check current focus');
  
  // Auto-run tests after a delay
  setTimeout(() => {
    console.log('\n🚀 Auto-running tests in 2 seconds...');
    runAllTests();
  }, 2000);
}