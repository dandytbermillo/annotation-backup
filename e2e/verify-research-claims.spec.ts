import { test, expect } from '@playwright/test';

test('verify PlainOfflineProvider cache persistence claim', async ({ page }) => {
  console.log('\n=== VERIFYING PROVIDER CACHE PERSISTENCE ===\n');
  console.log('Claim: PlainOfflineProvider uses in-memory storage lost on reload');
  
  // Track provider initialization and cache state
  let providerLogs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('PlainOfflineProvider') || 
        text.includes('documents.get') ||
        text.includes('getDocument') ||
        text.includes('cache')) {
      providerLogs.push(text);
      if (text.includes('Initializing') || text.includes('cache')) {
        console.log(`[LOG] ${text}`);
      }
    }
  });
  
  // Helper to open note
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  };
  
  // Step 1: Load note and check if provider has cached content
  console.log('Step 1: Loading note and setting content...');
  await page.goto('http://localhost:3000');
  await openNote();
  
  // Set unique content
  const timestamp = Date.now();
  const uniqueContent = `CACHE_TEST_${timestamp}`;
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(uniqueContent);
  await page.waitForTimeout(1000);
  
  // Check provider logs for cache references
  const cacheLogsBefore = providerLogs.filter(log => 
    log.includes('cache') || log.includes('documents.get')
  );
  console.log(`Cache-related logs before reload: ${cacheLogsBefore.length}`);
  
  // Step 2: Reload and check if provider is reinitialized
  console.log('\nStep 2: Reloading page...');
  providerLogs = []; // Clear logs
  
  await page.reload();
  
  // Check for provider reinitialization
  await page.waitForTimeout(1000);
  const initLogs = providerLogs.filter(log => log.includes('Initializing'));
  console.log(`Provider initialization logs after reload: ${initLogs.length}`);
  
  await openNote();
  
  // Step 3: Check if content was loaded from cache or server
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after reload: "${content}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  if (initLogs.length > 0) {
    console.log('✓ CLAIM VERIFIED: Provider was reinitialized on reload');
    console.log('  This confirms the in-memory cache is lost');
  } else {
    console.log('✗ CLAIM NOT VERIFIED: No provider reinitialization detected');
  }
  
  console.log(`\nContent persistence: ${content === uniqueContent ? 'Saved correctly' : 'Different content'}`);
});

test('verify localStorage restoration condition at line 268', async ({ page }) => {
  console.log('\n=== VERIFYING LOCALSTORAGE RESTORATION LOGIC ===\n');
  console.log('Checking the claim about line 268 in tiptap-editor-plain.tsx');
  
  // Inject localStorage entry to test restoration
  await page.goto('http://localhost:3000');
  
  // Create a fake pending save entry
  const noteId = '3cf0a212-87f6-4332-896b-4f56eda980fb';
  const panelId = 'main';
  const timestamp = Date.now();
  
  await page.evaluate(({ noteId, panelId, timestamp }) => {
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    const pendingData = {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'STALE_LOCALSTORAGE_CONTENT' }] }] },
      version: 99,
      timestamp: timestamp,
      metadata: { test: true }
    };
    localStorage.setItem(pendingKey, JSON.stringify(pendingData));
    console.log(`Set localStorage: ${pendingKey}`);
  }, { noteId, panelId, timestamp });
  
  // Track restoration attempts
  let restorationDetected = false;
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LOCALSTORAGE_RESTORE') || 
        text.includes('Restoring') ||
        text.includes('pending restore') ||
        text.includes('promoted.content')) {
      restorationDetected = true;
      console.log(`[RESTORATION] ${text}`);
    }
  });
  
  // Open the note
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(3000);
  
  // Check content
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  const hasStaleContent = content?.includes('STALE_LOCALSTORAGE_CONTENT');
  
  // Check if localStorage was cleared
  const remainingLocalStorage = await page.evaluate(({ noteId, panelId }) => {
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    return localStorage.getItem(pendingKey);
  }, { noteId, panelId });
  
  console.log('\n=== ANALYSIS ===');
  console.log(`Restoration detected: ${restorationDetected}`);
  console.log(`Stale content shown: ${hasStaleContent}`);
  console.log(`localStorage cleared: ${!remainingLocalStorage}`);
  
  if (hasStaleContent) {
    console.log('\n✓ CLAIM PARTIALLY VERIFIED: localStorage content CAN be restored');
    console.log('  However, in our tests this doesn\'t happen naturally');
  } else {
    console.log('\n✗ CLAIM NOT VERIFIED: localStorage content was not restored');
    console.log('  The restoration logic may have additional conditions');
  }
});

test('simulate the exact double reload scenario', async ({ page }) => {
  console.log('\n=== SIMULATING EXACT DOUBLE RELOAD SCENARIO ===\n');
  console.log('Attempting to reproduce: edit → save → immediate reload → stale content');
  
  // Helper
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
  await page.waitForTimeout(1500); // Ensure save completes
  
  // Make edit and reload WITHOUT waiting
  console.log('Making edit and reloading immediately...');
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`EDITED_${timestamp}`);
  
  // Trigger beforeunload to force localStorage backup
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload'));
  });
  
  // Reload immediately (simulating user pressing F5 right after edit)
  await page.reload();
  
  // First reload - check content
  console.log('\n--- FIRST RELOAD ---');
  await openNote();
  const firstContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${firstContent}"`);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  await openNote();
  const secondContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${secondContent}"`);
  
  // Analysis
  console.log('\n=== SCENARIO RESULT ===');
  const expectedContent = `EDITED_${timestamp}`;
  
  if (firstContent !== expectedContent && secondContent === expectedContent) {
    console.log('✓ DOUBLE RELOAD BUG REPRODUCED!');
    console.log(`  First reload: "${firstContent}" (incorrect)`);
    console.log(`  Second reload: "${secondContent}" (correct)`);
  } else if (firstContent === expectedContent && secondContent === expectedContent) {
    console.log('✗ Bug NOT reproduced - both reloads show correct content');
  } else {
    console.log('⚠ Different behavior observed');
    console.log(`  Expected: "${expectedContent}"`);
    console.log(`  First: "${firstContent}"`);
    console.log(`  Second: "${secondContent}"`);
  }
});