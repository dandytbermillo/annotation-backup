import { test, expect } from '@playwright/test';

test('FINAL PROOF: Double reload bug with existing note', async ({ page }) => {
  console.log('\n=== FINAL DOUBLE RELOAD BUG PROOF ===\n');
  console.log('Testing with existing note: test-final.md\n');
  
  // Navigate to app
  await page.goto('http://localhost:3001');
  
  // Open Notes Explorer
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Open test-final.md
  console.log('Opening test-final.md...');
  await page.dblclick('text=test-final.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
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
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(`EDITED content ${timestamp}`);
  
  // Force localStorage save by triggering beforeunload
  console.log('Step 3: Forcing localStorage backup...');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload'));
  });
  await page.waitForTimeout(100);
  
  // Check localStorage
  const localStorageBefore = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        const value = localStorage.getItem(key);
        if (value) {
          const parsed = JSON.parse(value);
          items[key] = parsed.content?.content?.[0]?.content?.[0]?.text || 'unknown';
        }
      }
    }
    return items;
  });
  console.log('localStorage pending saves:', localStorageBefore);
  
  // Reload immediately (before save completes)
  console.log('Step 4: Reloading immediately...');
  await page.reload();
  
  // First reload - open note and check content
  console.log('\n--- FIRST RELOAD ---');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=test-final.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const firstContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${firstContent}"`);
  
  // Check localStorage after first reload
  const localStorageAfterFirst = await page.evaluate(() => {
    const items: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        items.push(key);
      }
    }
    return items;
  });
  console.log(`localStorage after first reload: ${localStorageAfterFirst.length > 0 ? localStorageAfterFirst : 'cleared'}`);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=test-final.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const secondContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${secondContent}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  const expectedContent = `EDITED content ${timestamp}`;
  console.log(`Expected: "${expectedContent}"`);
  
  if (firstContent !== secondContent) {
    console.log('\n🔴 DIFFERENT CONTENT BETWEEN RELOADS! 🔴');
    console.log('This confirms the double reload bug!');
    console.log(`First reload:  "${firstContent}"`);
    console.log(`Second reload: "${secondContent}"`);
  } else if (firstContent === expectedContent && secondContent === expectedContent) {
    console.log('\n✅ Both reloads show correct edited content');
    console.log('The save completed before reload or localStorage worked correctly');
  } else {
    console.log('\n⚠️ Unexpected result');
    console.log(`Both show: "${firstContent}"`);
  }
});

test('INJECT BUG: Pre-inject localStorage to force bug', async ({ page }) => {
  console.log('\n=== PRE-INJECTED LOCALSTORAGE BUG TEST ===\n');
  
  // Navigate to app
  await page.goto('http://localhost:3001');
  
  // Before opening any note, inject stale localStorage
  console.log('Injecting stale localStorage for test-final.md...');
  await page.evaluate(() => {
    // We need to figure out the noteId for test-final.md
    // For now, use a pattern that might match
    const possibleKeys = [
      'pending_save_test-final_main',
      'pending_save_test-final.md_main',
    ];
    
    const staleContent = {
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '🔴 STALE CONTENT FROM LOCALSTORAGE - BUG IS REAL 🔴'
          }]
        }]
      },
      timestamp: Date.now() - 60000, // 1 minute old
      version: 1
    };
    
    possibleKeys.forEach(key => {
      localStorage.setItem(key, JSON.stringify(staleContent));
    });
    
    console.log('Injected keys:', possibleKeys);
  });
  
  // Now open the note
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  console.log('Opening test-final.md with pre-injected localStorage...');
  await page.dblclick('text=test-final.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\nContent shown: "${content}"`);
  
  if (content?.includes('STALE CONTENT FROM LOCALSTORAGE')) {
    console.log('\n🔴🔴🔴 DOUBLE RELOAD BUG CONFIRMED! 🔴🔴🔴');
    console.log('The app loaded the pre-injected stale localStorage!');
    console.log('This definitively proves the bug exists.');
  } else {
    console.log('\n❓ Bug not triggered - showing different content');
    console.log('The localStorage key pattern might not match the actual noteId');
  }
  
  // Check what localStorage keys exist
  const actualKeys = await page.evaluate(() => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  });
  console.log('\nAll localStorage keys:', actualKeys);
});

test('MONITOR SAVE: Track actual save behavior', async ({ page }) => {
  console.log('\n=== MONITORING SAVE BEHAVIOR ===\n');
  
  // Intercept save requests
  let saveCount = 0;
  page.on('request', request => {
    if (request.url().includes('postgres-offline/documents') && 
        (request.method() === 'POST' || request.method() === 'PUT')) {
      saveCount++;
      console.log(`[SAVE REQUEST ${saveCount}] ${request.method()} to ${request.url()}`);
    }
  });
  
  // Navigate
  await page.goto('http://localhost:3001');
  
  // Open Notes Explorer
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Open test-final.md
  await page.dblclick('text=test-final.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Type and observe save
  console.log('Typing content...');
  await editor.click();
  await page.keyboard.type('Monitoring save behavior');
  
  console.log('Waiting for autosave...');
  await page.waitForTimeout(3000);
  
  console.log(`Total saves observed: ${saveCount}`);
  
  // Trigger unload
  console.log('Triggering unload event...');
  const unloadResult = await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload'));
    
    // Check if localStorage was written
    let pendingKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        pendingKeys.push(key);
      }
    }
    return pendingKeys;
  });
  
  console.log('localStorage keys after unload:', unloadResult);
  
  // Wait to see if another save happens
  await page.waitForTimeout(2000);
  console.log(`Final save count: ${saveCount}`);
});