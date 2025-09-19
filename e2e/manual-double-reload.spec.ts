import { test, expect } from '@playwright/test';

test('manual double reload simulation', async ({ page }) => {
  console.log('\n=== MANUAL DOUBLE RELOAD SIMULATION ===\n');
  console.log('This test simulates the double reload issue by:');
  console.log('1. Setting up localStorage with old content');
  console.log('2. Simulating what happens on first reload');
  console.log('3. Checking if localStorage restore happens incorrectly\n');
  
  // Capture console logs
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('PlainOfflineProvider') || 
        text.includes('LOCALSTORAGE') ||
        text.includes('TiptapEditorPlain') ||
        text.includes('getDocument') ||
        text.includes('loadDocument')) {
      logs.push(text);
      console.log(`[Browser]: ${text}`);
    }
  });
  
  // Step 1: Navigate to app
  console.log('STEP 1: Navigating to app...');
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  
  // Step 2: Set up a simulated scenario
  console.log('\nSTEP 2: Setting up test scenario in localStorage...');
  
  const testResult = await page.evaluate(() => {
    // Simulate a pending save in localStorage (old content)
    const noteId = 'test-note';
    const panelId = 'main';
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    
    const oldContent = {
      type: 'doc',
      content: [
        { 
          type: 'paragraph', 
          content: [
            { type: 'text', text: 'OLD STALE CONTENT from localStorage' }
          ] 
        }
      ]
    };
    
    localStorage.setItem(pendingKey, JSON.stringify({
      content: oldContent,
      timestamp: Date.now() - 30000, // 30 seconds ago
      noteId,
      panelId
    }));
    
    // Check what's in localStorage
    const stored = localStorage.getItem(pendingKey);
    return {
      key: pendingKey,
      stored: !!stored,
      content: stored ? JSON.parse(stored).content : null
    };
  });
  
  console.log('   localStorage setup:', testResult.stored ? 'SUCCESS' : 'FAILED');
  console.log('   Pending save key:', testResult.key);
  
  // Step 3: Navigate to a note URL (even if it 404s, we want to see the provider behavior)
  console.log('\nSTEP 3: Navigating to note URL to trigger provider...');
  await page.goto('http://localhost:3000/notes/test-note');
  await page.waitForTimeout(2000);
  
  // Check if provider initialized
  const providerLogs = logs.filter(log => log.includes('PlainOfflineProvider'));
  console.log(`   Provider logs: ${providerLogs.length} entries`);
  
  // Step 4: Check what happens with localStorage on page load
  console.log('\nSTEP 4: Checking localStorage behavior...');
  
  const localStorageCheck = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.map(k => {
      const data = JSON.parse(localStorage.getItem(k) || '{}');
      return {
        key: k,
        hasContent: !!data.content,
        timestamp: data.timestamp,
        age: Date.now() - (data.timestamp || 0)
      };
    });
  });
  
  console.log('   Pending saves in localStorage:');
  localStorageCheck.forEach(item => {
    console.log(`     - ${item.key}: age=${Math.round(item.age/1000)}s, hasContent=${item.hasContent}`);
  });
  
  // Step 5: Simulate a reload
  console.log('\nSTEP 5: Simulating first reload...');
  logs.length = 0; // Clear logs
  
  await page.reload();
  await page.waitForTimeout(3000);
  
  // Analyze logs from reload
  const restoreLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE_RESTORE') ||
    log.includes('LOCALSTORAGE_CHECK') ||
    log.includes('localStorage backup found')
  );
  
  if (restoreLogs.length > 0) {
    console.log('\n   localStorage restore logs found:');
    restoreLogs.forEach(log => console.log(`     - ${log}`));
  } else {
    console.log('\n   No localStorage restore logs found');
  }
  
  // Check if localStorage was cleared
  const afterReload = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.length;
  });
  
  console.log(`\n   Pending saves after reload: ${afterReload}`);
  
  // Step 6: Simulate second reload
  console.log('\nSTEP 6: Simulating second reload...');
  logs.length = 0; // Clear logs
  
  await page.reload();
  await page.waitForTimeout(3000);
  
  const secondRestoreLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE_RESTORE') ||
    log.includes('LOCALSTORAGE_CHECK')
  );
  
  if (secondRestoreLogs.length > 0) {
    console.log('\n   localStorage restore logs on second reload:');
    secondRestoreLogs.forEach(log => console.log(`     - ${log}`));
  } else {
    console.log('\n   No localStorage restore logs on second reload');
  }
  
  // Final localStorage check
  const afterSecond = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.length;
  });
  
  console.log(`\n   Pending saves after second reload: ${afterSecond}`);
  
  // Step 7: Analysis
  console.log('\n=== ANALYSIS ===');
  
  if (restoreLogs.length > 0 && secondRestoreLogs.length === 0) {
    console.log('❌ PATTERN MATCHES DOUBLE RELOAD BUG:');
    console.log('   - First reload: localStorage restore was attempted');
    console.log('   - Second reload: No localStorage restore');
    console.log('   This suggests first reload incorrectly restores old content');
  } else if (restoreLogs.length === 0 && secondRestoreLogs.length === 0) {
    console.log('✓ localStorage restore was not triggered (expected behavior)');
  } else {
    console.log('⚠️ Unexpected localStorage restore pattern');
  }
  
  // Check provider behavior
  const providerGetDocLogs = logs.filter(log => log.includes('getDocument'));
  const providerLoadLogs = logs.filter(log => log.includes('loadDocument'));
  
  console.log(`\nProvider activity:`);
  console.log(`  - getDocument calls: ${providerGetDocLogs.length}`);
  console.log(`  - loadDocument calls: ${providerLoadLogs.length}`);
  
  if (providerGetDocLogs.length > 0) {
    console.log('\n  Sample getDocument logs:');
    providerGetDocLogs.slice(0, 3).forEach(log => console.log(`    - ${log}`));
  }
  
  // Step 8: Direct component testing
  console.log('\nSTEP 8: Testing component behavior directly...');
  
  const componentTest = await page.evaluate(async () => {
    // Simulate what TiptapEditorPlain does
    const noteId = 'test-note';
    const panelId = 'main';
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    
    // Check if localStorage has pending save
    const pendingSave = localStorage.getItem(pendingKey);
    if (!pendingSave) {
      return { hasPendingSave: false };
    }
    
    const data = JSON.parse(pendingSave);
    const age = Date.now() - data.timestamp;
    
    // Simulate the condition from line 230 in tiptap-editor-plain.tsx
    const shouldRestore = age < 5 * 60 * 1000; // Less than 5 minutes old
    
    return {
      hasPendingSave: true,
      age: Math.round(age / 1000),
      shouldRestore,
      content: data.content?.content?.[0]?.content?.[0]?.text || 'unknown'
    };
  });
  
  console.log('   Component simulation:');
  console.log(`     - Has pending save: ${componentTest.hasPendingSave}`);
  if (componentTest.hasPendingSave) {
    console.log(`     - Age: ${componentTest.age} seconds`);
    console.log(`     - Should restore: ${componentTest.shouldRestore}`);
    console.log(`     - Content: "${componentTest.content}"`);
  }
  
  console.log('\n=== CONCLUSION ===');
  
  if (componentTest.hasPendingSave && componentTest.shouldRestore) {
    console.log('The localStorage backup WOULD be restored on first reload');
    console.log('This explains why old content appears on first reload');
    console.log('The condition at line 230 in tiptap-editor-plain.tsx allows restoration');
    console.log('because the backup is less than 5 minutes old.');
  } else {
    console.log('localStorage backup would NOT be restored (correct behavior)');
  }
});