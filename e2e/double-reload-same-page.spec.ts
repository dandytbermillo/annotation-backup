import { test, expect } from '@playwright/test';

test('investigate double reload on same page - detailed', async ({ page }) => {
  console.log('\n=== INVESTIGATING DOUBLE RELOAD ON SAME PAGE ===');
  console.log('Taking time to understand the exact behavior...\n');
  
  // Capture ALL console logs for analysis
  const logs: { type: string, text: string, timestamp: number }[] = [];
  page.on('console', msg => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now()
    };
    logs.push(entry);
    
    // Only print key logs to avoid clutter
    if (msg.text().includes('localStorage') || 
        msg.text().includes('LOCALSTORAGE') ||
        msg.text().includes('Restoring') ||
        msg.text().includes('Loading document') ||
        msg.text().includes('Loaded document') ||
        msg.text().includes('Saving document') ||
        msg.text().includes('CONTENT_LOADED') ||
        msg.text().includes('CONTENT_SET')) {
      console.log(`[${msg.type()}] ${msg.text()}`);
    }
  });
  
  // Step 1: Navigate to app and open a note
  console.log('STEP 1: Opening application and note...');
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Open the note
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000); // Let everything stabilize
  
  // Get the current URL - we'll stay on this page
  const noteUrl = page.url();
  console.log(`Note URL: ${noteUrl}`);
  
  // Step 2: Clear existing content and set a baseline
  console.log('\nSTEP 2: Setting baseline content...');
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Use triple-click to select all (as we learned it works better)
  await editor.click({ clickCount: 3 });
  const timestamp = Date.now();
  const baselineContent = `Baseline ${timestamp}`;
  await page.keyboard.type(baselineContent);
  
  // Wait for autosave
  console.log('Waiting for autosave...');
  await page.waitForTimeout(1000);
  
  // Verify baseline is set
  let currentContent = await editor.textContent();
  console.log(`Baseline content set: "${currentContent}"`);
  
  // Clear logs for clean observation
  logs.length = 0;
  
  // Step 3: Make an edit
  console.log('\nSTEP 3: Making an edit...');
  await editor.click({ clickCount: 3 });
  const editedContent = `Edited ${timestamp}`;
  await page.keyboard.type(editedContent);
  
  // Wait for autosave
  console.log('Waiting for autosave...');
  await page.waitForTimeout(1000);
  
  currentContent = await editor.textContent();
  console.log(`Content after edit: "${currentContent}"`);
  
  // Check localStorage before reload
  console.log('\nChecking localStorage before reload...');
  const localStorageBeforeReload = await page.evaluate(() => {
    const items: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        try {
          items[key] = JSON.parse(localStorage.getItem(key) || '{}');
        } catch {
          items[key] = localStorage.getItem(key);
        }
      }
    }
    return items;
  });
  console.log(`localStorage entries with pending_save: ${Object.keys(localStorageBeforeReload).length}`);
  
  // Step 4: FIRST RELOAD (staying on same page)
  console.log('\n=== FIRST RELOAD (staying on same page) ===');
  logs.length = 0; // Clear logs to see what happens during reload
  
  await page.reload();
  
  // Wait for editor to be available again
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(3000); // Give it time to load content
  
  const contentAfterFirstReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\nContent after FIRST reload: "${contentAfterFirstReload}"`);
  
  // Analyze logs from first reload
  const localStorageLogs = logs.filter(l => 
    l.text.includes('localStorage') || 
    l.text.includes('LOCALSTORAGE') ||
    l.text.includes('Restoring')
  );
  
  console.log(`\nLocalStorage-related logs during first reload: ${localStorageLogs.length}`);
  localStorageLogs.forEach(log => {
    console.log(`  - ${log.text.substring(0, 100)}...`);
  });
  
  // Check localStorage after first reload
  const localStorageAfterFirstReload = await page.evaluate(() => {
    const items: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        try {
          items[key] = JSON.parse(localStorage.getItem(key) || '{}');
        } catch {
          items[key] = localStorage.getItem(key);
        }
      }
    }
    return items;
  });
  console.log(`localStorage entries after first reload: ${Object.keys(localStorageAfterFirstReload).length}`);
  
  // Step 5: SECOND RELOAD (staying on same page)
  console.log('\n=== SECOND RELOAD (staying on same page) ===');
  logs.length = 0; // Clear logs again
  
  await page.reload();
  
  // Wait for editor to be available again
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(3000); // Give it time to load content
  
  const contentAfterSecondReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\nContent after SECOND reload: "${contentAfterSecondReload}"`);
  
  // Analyze logs from second reload
  const localStorageLogsSecond = logs.filter(l => 
    l.text.includes('localStorage') || 
    l.text.includes('LOCALSTORAGE') ||
    l.text.includes('Restoring')
  );
  
  console.log(`\nLocalStorage-related logs during second reload: ${localStorageLogsSecond.length}`);
  localStorageLogsSecond.forEach(log => {
    console.log(`  - ${log.text.substring(0, 100)}...`);
  });
  
  // Step 6: Analysis
  console.log('\n=== DETAILED ANALYSIS ===');
  console.log(`Expected content: "${editedContent}"`);
  console.log(`After 1st reload: "${contentAfterFirstReload}"`);
  console.log(`After 2nd reload: "${contentAfterSecondReload}"`);
  
  const firstReloadCorrect = contentAfterFirstReload === editedContent;
  const secondReloadCorrect = contentAfterSecondReload === editedContent;
  const bothSame = contentAfterFirstReload === contentAfterSecondReload;
  
  console.log(`\nFirst reload shows correct content: ${firstReloadCorrect}`);
  console.log(`Second reload shows correct content: ${secondReloadCorrect}`);
  console.log(`Both reloads show same content: ${bothSame}`);
  
  if (!firstReloadCorrect && secondReloadCorrect) {
    console.log('\n🔴 DOUBLE RELOAD BUG CONFIRMED!');
    console.log('First reload shows old/wrong content');
    console.log('Second reload shows the correct edited content');
    console.log('\nThis suggests localStorage restoration or caching issue on first reload');
  } else if (firstReloadCorrect && secondReloadCorrect) {
    console.log('\n✅ NO BUG: Both reloads show correct content');
  } else if (!firstReloadCorrect && !secondReloadCorrect) {
    console.log('\n⚠️ SAVE ISSUE: Edit was not persisted properly');
  } else if (firstReloadCorrect && !secondReloadCorrect) {
    console.log('\n⚠️ UNEXPECTED: First reload correct, second reload wrong');
  }
  
  // Additional analysis for content differences
  if (contentAfterFirstReload !== editedContent) {
    console.log('\nFirst reload content analysis:');
    if (contentAfterFirstReload === baselineContent) {
      console.log('  - Shows the BASELINE content (before edit)');
    } else if (contentAfterFirstReload.includes(editedContent)) {
      console.log('  - Contains edited content but with extra text');
    } else if (contentAfterFirstReload.includes(baselineContent)) {
      console.log('  - Contains baseline content');
    } else {
      console.log('  - Shows completely different content');
    }
  }
});

test('investigate double reload with clean start', async ({ page }) => {
  console.log('\n=== CLEAN START DOUBLE RELOAD TEST ===');
  console.log('Starting with a completely fresh note to eliminate accumulated content...\n');
  
  // Navigate to app
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Create a NEW note for clean testing
  console.log('Creating a new note for clean testing...');
  await page.click('button:has-text("Create New Note")');
  
  // Wait for editor
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Set initial content
  console.log('\nSetting initial content...');
  const timestamp = Date.now();
  const initialContent = `Initial-${timestamp}`;
  await editor.click();
  await page.keyboard.type(initialContent);
  await page.waitForTimeout(1000); // Wait for autosave
  
  let content = await editor.textContent();
  console.log(`Initial content: "${content}"`);
  
  // Make an edit
  console.log('\nMaking an edit...');
  await editor.click({ clickCount: 3 });
  const editedContent = `Edited-${timestamp}`;
  await page.keyboard.type(editedContent);
  await page.waitForTimeout(1000); // Wait for autosave
  
  content = await editor.textContent();
  console.log(`Content after edit: "${content}"`);
  
  // First reload
  console.log('\n--- FIRST RELOAD ---');
  await page.reload();
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(3000);
  
  const afterFirst = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`After 1st reload: "${afterFirst}"`);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(3000);
  
  const afterSecond = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`After 2nd reload: "${afterSecond}"`);
  
  // Analysis
  console.log('\n--- ANALYSIS ---');
  console.log(`Expected: "${editedContent}"`);
  console.log(`1st reload: "${afterFirst}"`);
  console.log(`2nd reload: "${afterSecond}"`);
  
  if (afterFirst !== editedContent && afterSecond === editedContent) {
    console.log('\n🔴 DOUBLE RELOAD BUG CONFIRMED WITH NEW NOTE!');
  } else if (afterFirst === editedContent && afterSecond === editedContent) {
    console.log('\n✅ Both reloads correct with new note');
  } else {
    console.log('\n⚠️ Different behavior with new note');
  }
});