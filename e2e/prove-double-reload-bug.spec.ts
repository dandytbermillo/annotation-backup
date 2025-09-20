import { test, expect } from '@playwright/test';

test.skip('prove the double reload bug exists', async ({ page, context }) => {
  console.log('\n=== PROVING THE DOUBLE RELOAD BUG ===\n');
  console.log('The bug: localStorage content is shown immediately on first reload,');
  console.log('before checking if database has newer content.\n');
  
  // We need to simulate the exact scenario:
  // 1. Edit content
  // 2. Page unloads BEFORE save completes (localStorage backup created)
  // 3. On reload, localStorage content is shown (might be stale)
  // 4. Second reload shows database content (correct)
  
  // Helper to open note
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    // Create a new note for clean testing
    await page.click('button:has-text("Create New Note")');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  };
  
  // Navigate and create note
  await page.goto('http://localhost:3000');
  await openNote();
  
  const editor = page.locator('[contenteditable="true"]').first();
  const timestamp = Date.now();
  
  // Set initial content and let it save
  console.log('Step 1: Setting initial content and letting it save...');
  await editor.click();
  await page.keyboard.type(`Initial content ${timestamp}`);
  await page.waitForTimeout(2000); // Ensure it saves to database
  
  // Now make an edit
  console.log('Step 2: Making an edit...');
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`Edited content ${timestamp}`);
  
  // Immediately trigger the localStorage backup (simulating page unload)
  console.log('Step 3: Forcing localStorage backup before save completes...');
  await page.evaluate(() => {
    // This is what happens on beforeunload
    const editor = document.querySelector('[contenteditable="true"]');
    if (editor && window.localStorage) {
      // Simulate what the code does - save current content to localStorage
      const event = new Event('beforeunload');
      window.dispatchEvent(event);
    }
  });
  
  // Check what's in localStorage
  const localStorageContent = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        keys.push(key);
      }
    }
    return keys;
  });
  console.log(`LocalStorage pending_save keys: ${localStorageContent}`);
  
  // Wait a bit to let save complete (or not)
  await page.waitForTimeout(1000);
  
  // First reload
  console.log('\n--- FIRST RELOAD ---');
  await page.reload();
  
  // The bug: localStorage content loads IMMEDIATELY (lines 214-219)
  // before provider.loadDocument even runs
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const firstReloadContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after first reload: "${firstReloadContent}"`);
  
  // Check if localStorage still exists
  const localStorageAfterFirst = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        keys.push(key);
      }
    }
    return keys;
  });
  console.log(`LocalStorage after first reload: ${localStorageAfterFirst}`);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const secondReloadContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after second reload: "${secondReloadContent}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  console.log(`Expected: "Edited content ${timestamp}"`);
  console.log(`First reload: "${firstReloadContent}"`);
  console.log(`Second reload: "${secondReloadContent}"`);
  
  // The bug would manifest as:
  // - First reload might show content from localStorage (could be stale)
  // - Second reload shows content from database (correct)
  
  if (firstReloadContent !== secondReloadContent) {
    console.log('\n⚠️ DIFFERENT CONTENT BETWEEN RELOADS');
    console.log('This could indicate the localStorage restoration issue');
  } else {
    console.log('\nSame content on both reloads');
    console.log('The bug might not manifest in this specific test run');
  }
});

test.skip('manually inject stale localStorage to prove the bug', async ({ page }) => {
  console.log('\n=== MANUALLY PROVING LOCALSTORAGE BUG ===\n');
  console.log('Injecting stale localStorage to show it gets restored\n');
  
  // Navigate to app
  await page.goto('http://localhost:3000');
  
  // Get a valid noteId from creating a note
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Create New Note")');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  
  // Get the noteId from the page
  const noteInfo = await page.evaluate(() => {
    // Try to find the noteId from the React props or data attributes
    const url = window.location.href;
    // Extract from URL or find another way
    return { url };
  });
  
  // Set some content
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('CURRENT DATABASE CONTENT');
  await page.waitForTimeout(2000); // Let it save
  
  // Now inject stale localStorage
  await page.evaluate(() => {
    // Create a pending_save entry with OLD content
    // This simulates what would happen if an old save was in localStorage
    const pendingKey = 'pending_save_test_test'; // We'll need the actual noteId
    const staleData = {
      content: { 
        type: 'doc', 
        content: [
          { 
            type: 'paragraph', 
            content: [
              { type: 'text', text: 'STALE LOCALSTORAGE CONTENT - THIS SHOULD NOT BE SHOWN' }
            ] 
          }
        ] 
      },
      timestamp: Date.now() - 60000, // 1 minute old (within 5 minute window)
      version: 1
    };
    localStorage.setItem(pendingKey, JSON.stringify(staleData));
    console.log('Injected stale localStorage:', pendingKey);
  });
  
  // Reload and see what happens
  console.log('Reloading with stale localStorage present...');
  await page.reload();
  
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after reload: "${content}"`);
  
  if (content?.includes('STALE LOCALSTORAGE')) {
    console.log('\n🔴 BUG CONFIRMED!');
    console.log('Stale localStorage content was restored!');
    console.log('This proves lines 214-219 load localStorage content immediately');
  } else if (content?.includes('CURRENT DATABASE')) {
    console.log('\n✅ Correct database content shown');
    console.log('The localStorage restoration did not trigger in this case');
  }
});