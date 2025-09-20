import { test, expect } from '@playwright/test';

test('DEFINITIVE PROOF: inject localStorage and show it gets loaded', async ({ page }) => {
  console.log('\n=== DEFINITIVE DOUBLE RELOAD BUG PROOF ===\n');
  console.log('This test injects localStorage BEFORE loading the app');
  console.log('to prove lines 214-219 immediately load localStorage content\n');
  
  // First navigate to set up localStorage domain
  await page.goto('http://localhost:3000');
  
  // Inject a pending_save entry BEFORE the app loads
  // This simulates what would be there from a previous unload
  await page.evaluate(() => {
    // Use a real noteId that exists
    const noteId = '3cf0a212-87f6-4332-896b-4f56eda980fb'; 
    const panelId = 'main';
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    
    // Create stale content that's different from what's in the database
    const staleContent = {
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '🔴 STALE LOCALSTORAGE CONTENT - THIS PROVES THE BUG 🔴' }
            ]
          }
        ]
      },
      timestamp: Date.now() - 60000, // 1 minute old (within 5 minute window)
      noteId: noteId,
      panelId: panelId,
      version: 1
    };
    
    localStorage.setItem(pendingKey, JSON.stringify(staleContent));
    console.log(`Injected localStorage: ${pendingKey}`);
    console.log('Content: STALE LOCALSTORAGE CONTENT');
  });
  
  // Now reload the page - the app will initialize with localStorage present
  await page.reload();
  
  // Open the note
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Double-click on test-final.md to open it
  await page.dblclick('text=test-final.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000); // Let everything settle
  
  // Check what content is shown
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\nContent shown after reload: "${content}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  if (content?.includes('STALE LOCALSTORAGE')) {
    console.log('🔴 BUG CONFIRMED! 🔴');
    console.log('The app loaded and displayed the stale localStorage content!');
    console.log('This proves lines 214-219 in tiptap-editor-plain.tsx');
    console.log('immediately set localStorage content without waiting for database.');
    console.log('\nTHIS IS THE DOUBLE RELOAD BUG:');
    console.log('1. First reload shows localStorage (potentially stale)');
    console.log('2. Second reload would show database content (after localStorage cleared)');
  } else {
    console.log('✅ Bug NOT triggered in this test');
    console.log(`Instead showing: "${content}"`);
    console.log('The localStorage injection may not have worked as expected');
  }
  
  // Check if localStorage was cleared after load
  const localStorageAfter = await page.evaluate(() => {
    const noteId = '3cf0a212-87f6-4332-896b-4f56eda980fb';
    const panelId = 'main';
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    return localStorage.getItem(pendingKey);
  });
  
  console.log(`\nlocalStorage after load: ${localStorageAfter ? 'Still exists' : 'Cleared'}`);
});

test('REAL SCENARIO: Make edit and reload immediately', async ({ page }) => {
  console.log('\n=== REAL DOUBLE RELOAD SCENARIO ===\n');
  console.log('Testing the actual user workflow that triggers the bug\n');
  
  // Helper to open note
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=test-final.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  };
  
  // Start fresh
  await page.goto('http://localhost:3000');
  await openNote();
  
  const editor = page.locator('[contenteditable="true"]').first();
  const timestamp = Date.now();
  
  // Set initial content and let it save
  console.log('Step 1: Setting initial content and letting it save...');
  await editor.click();
  await editor.click({ clickCount: 3 }); // Select all
  await page.keyboard.type(`Initial content ${timestamp}`);
  await page.waitForTimeout(3000); // Ensure save completes
  
  // Make an edit
  console.log('Step 2: Making an edit...');
  await editor.click({ clickCount: 3 }); // Select all
  await page.keyboard.type(`EDITED content ${timestamp}`);
  
  // Immediately reload (simulating user pressing F5 right after typing)
  console.log('Step 3: Reloading IMMEDIATELY (before save completes)...');
  await page.reload();
  
  // First reload - check content
  console.log('\n--- FIRST RELOAD ---');
  await openNote();
  const firstContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${firstContent}"`);
  
  // Wait a moment for any background saves
  await page.waitForTimeout(3000);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  await openNote();
  const secondContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${secondContent}"`);
  
  // Analysis
  console.log('\n=== RESULT ===');
  const expectedContent = `EDITED content ${timestamp}`;
  console.log(`Expected: "${expectedContent}"`);
  
  if (firstContent !== secondContent) {
    console.log('\n🔴 DIFFERENT CONTENT BETWEEN RELOADS! 🔴');
    console.log('This is the double reload bug!');
    console.log(`First reload:  "${firstContent}"`);
    console.log(`Second reload: "${secondContent}"`);
  } else if (firstContent === expectedContent) {
    console.log('\n✅ Both reloads show correct edited content');
    console.log('The save may have completed before reload');
  } else if (firstContent === `Initial content ${timestamp}`) {
    console.log('\n⚠️ Both reloads show OLD content');
    console.log('The edit may not have triggered a save at all');
  }
});

test('INTERCEPT SAVE: Block save request to force race condition', async ({ page, context }) => {
  console.log('\n=== FORCING RACE CONDITION BY BLOCKING SAVE ===\n');
  console.log('This test blocks the save request to guarantee the race condition\n');
  
  // Helper to open note
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=test-final.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  };
  
  // Start fresh
  await page.goto('http://localhost:3000');
  await openNote();
  
  const editor = page.locator('[contenteditable="true"]').first();
  const timestamp = Date.now();
  
  // Set initial content and let it save
  console.log('Step 1: Setting initial content (this WILL save)...');
  await editor.click();
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`Initial content ${timestamp}`);
  await page.waitForTimeout(3000); // Let this save complete
  
  // Now block future save requests
  console.log('Step 2: Blocking save requests...');
  await page.route('**/api/postgres-offline/documents/**', route => {
    if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
      console.log('BLOCKED SAVE REQUEST!');
      // Don't respond - let it hang
      // This simulates the save being in-flight during reload
    } else {
      route.continue();
    }
  });
  
  // Make an edit
  console.log('Step 3: Making an edit (save will be BLOCKED)...');
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`EDITED content ${timestamp} - SAVE BLOCKED`);
  await page.waitForTimeout(500); // Give it a moment to try to save
  
  // The save request is now blocked/hanging
  // Reload immediately
  console.log('Step 4: Reloading with save request blocked...');
  await page.reload();
  
  // Unblock routes for the new page load
  await page.unroute('**/api/postgres-offline/documents/**');
  
  // First reload - check content
  console.log('\n--- FIRST RELOAD (save was blocked) ---');
  await openNote();
  const firstContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${firstContent}"`);
  
  // Check localStorage
  const hasLocalStorage = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        return true;
      }
    }
    return false;
  });
  console.log(`localStorage pending_save exists: ${hasLocalStorage}`);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  await openNote();
  const secondContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${secondContent}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  const expectedInitial = `Initial content ${timestamp}`;
  const expectedEdited = `EDITED content ${timestamp} - SAVE BLOCKED`;
  
  if (firstContent === expectedInitial && secondContent === expectedInitial) {
    console.log('✅ Confirmed: When save is blocked, old content persists');
    console.log('The localStorage backup should have been created but may not restore');
  } else if (firstContent?.includes('EDITED') && !secondContent?.includes('EDITED')) {
    console.log('🔴 BUG CONFIRMED! First reload showed edited content from localStorage!');
    console.log('Second reload reverted to database content!');
  } else if (firstContent !== secondContent) {
    console.log('🔴 DIFFERENT CONTENT BETWEEN RELOADS!');
    console.log(`First:  "${firstContent}"`);
    console.log(`Second: "${secondContent}"`);
  }
});