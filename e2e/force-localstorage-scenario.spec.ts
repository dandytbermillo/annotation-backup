import { test, expect } from '@playwright/test';

test('force localStorage backup scenario', async ({ page }) => {
  console.log('\n=== FORCING LOCALSTORAGE BACKUP SCENARIO ===');
  console.log('Attempting to trigger the exact conditions for localStorage backup...\n');
  
  // Comprehensive logging
  const logs: { type: string, text: string }[] = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push({ type: msg.type(), text });
    
    // Log everything related to localStorage
    if (text.includes('LOCALSTORAGE') || 
        text.includes('localStorage') ||
        text.includes('pending_save') ||
        text.includes('Saving document') ||
        text.includes('Restoring') ||
        text.includes('BACKUP') ||
        text.includes('visibility')) {
      console.log(`[${msg.type()}] ${text.substring(0, 200)}`);
    }
  });
  
  // Helper to open note
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(500);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(1500);
  };
  
  // Start
  await page.goto('http://localhost:3000');
  await openNote();
  
  const editor = page.locator('[contenteditable="true"]').first();
  const timestamp = Date.now();
  
  // Set baseline
  console.log('Setting baseline content...');
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`BASELINE_${timestamp}`);
  await page.waitForTimeout(1500); // Give time for save
  
  const baseline = await editor.textContent();
  console.log(`Baseline: "${baseline}"`);
  
  // Test 1: Edit and reload IMMEDIATELY (before autosave)
  console.log('\n--- TEST 1: Edit and immediate reload (no autosave) ---');
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`QUICK_EDIT_${timestamp}`);
  // NO WAIT - reload immediately
  
  await page.reload();
  await openNote();
  const afterQuickReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`After immediate reload: "${afterQuickReload}"`);
  
  // Test 2: Edit, trigger backup, then reload
  console.log('\n--- TEST 2: Edit with forced backup ---');
  await editor.click({ clickCount: 3 });
  const editWithBackup = `EDIT_WITH_BACKUP_${timestamp}`;
  await page.keyboard.type(editWithBackup);
  
  // Force localStorage backup by triggering visibility change
  console.log('Forcing localStorage backup via page.evaluate...');
  await page.evaluate(() => {
    // Trigger the visibility change handler
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  
  await page.waitForTimeout(500);
  
  // Check localStorage directly
  const localStorageContent = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (key.includes('pending_save') && value) {
          // Just get first 100 chars for logging
          items[key] = value.substring(0, 100);
        }
      }
    }
    return items;
  });
  
  console.log('\nLocalStorage after forced backup:');
  if (Object.keys(localStorageContent).length === 0) {
    console.log('  Still no pending_save entries!');
  } else {
    Object.entries(localStorageContent).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}...`);
    });
  }
  
  // Now reload
  console.log('\nReloading after forced backup...');
  await page.reload();
  await openNote();
  
  const afterBackupReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after reload: "${afterBackupReload}"`);
  
  // Test 3: Multiple rapid edits and reload
  console.log('\n--- TEST 3: Multiple rapid edits ---');
  for (let i = 0; i < 3; i++) {
    await editor.click({ clickCount: 3 });
    await page.keyboard.type(`RAPID_${i}_${timestamp}`);
    await page.waitForTimeout(100); // Very short wait
  }
  
  // Reload immediately
  await page.reload();
  await openNote();
  
  const afterRapidEdits = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`After rapid edits and reload: "${afterRapidEdits}"`);
  
  // Second reload to check difference
  console.log('\nDoing second reload...');
  await page.reload();
  await openNote();
  
  const afterSecondReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`After second reload: "${afterSecondReload}"`);
  
  // Analysis
  console.log('\n=== FINAL ANALYSIS ===');
  if (afterRapidEdits !== afterSecondReload) {
    console.log('🔴 DIFFERENT CONTENT BETWEEN RELOADS!');
    console.log(`First: "${afterRapidEdits}"`);
    console.log(`Second: "${afterSecondReload}"`);
  } else {
    console.log('Content consistent between reloads');
  }
  
  // Check if any localStorage restoration happened
  const restorationLogs = logs.filter(l => 
    l.text.includes('Restoring') || 
    l.text.includes('RESTORE') ||
    l.text.includes('LOCALSTORAGE_RESTORE')
  );
  
  console.log(`\nRestoration events detected: ${restorationLogs.length}`);
  restorationLogs.forEach(log => {
    console.log(`  - ${log.text.substring(0, 100)}`);
  });
});

test('test with manual delay between edit and reload', async ({ page }) => {
  console.log('\n=== TESTING WITH VARIOUS DELAYS ===\n');
  
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(500);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(1500);
  };
  
  await page.goto('http://localhost:3000');
  await openNote();
  
  const editor = page.locator('[contenteditable="true"]').first();
  const timestamp = Date.now();
  
  // Test different delay scenarios
  const delays = [0, 100, 300, 500, 1000];
  
  for (const delay of delays) {
    console.log(`\n--- Testing with ${delay}ms delay ---`);
    
    // Make edit
    await editor.click({ clickCount: 3 });
    const content = `DELAY_${delay}_${timestamp}`;
    await page.keyboard.type(content);
    
    // Wait specified delay
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }
    
    // First reload
    await page.reload();
    await openNote();
    const firstReload = await page.locator('[contenteditable="true"]').first().textContent();
    
    // Second reload
    await page.reload();
    await openNote();
    const secondReload = await page.locator('[contenteditable="true"]').first().textContent();
    
    console.log(`Expected: "${content}"`);
    console.log(`1st reload: "${firstReload}"`);
    console.log(`2nd reload: "${secondReload}"`);
    
    if (firstReload !== secondReload) {
      console.log('⚠️ DIFFERENCE DETECTED!');
    } else if (firstReload === content) {
      console.log('✓ Both reloads correct');
    } else {
      console.log('✗ Content not saved');
    }
  }
});