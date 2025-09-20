import { test, expect } from '@playwright/test';

test('ABSOLUTE PROOF: Inject localStorage and prove it loads', async ({ page }) => {
  console.log('\n=== ABSOLUTE PROOF OF DOUBLE RELOAD BUG ===\n');
  
  // Navigate to app
  await page.goto('http://localhost:3000');
  
  // Open Notes Explorer
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Create a new note (this ensures we have a valid noteId)
  console.log('Creating a new note...');
  await page.click('button:has-text("Create New Note")');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  // Get the current noteId from the page
  const noteInfo = await page.evaluate(() => {
    // Try to extract noteId from React props or DOM
    const editor = document.querySelector('[contenteditable="true"]');
    const wrapper = editor?.closest('[data-note-id]');
    const noteId = wrapper?.getAttribute('data-note-id');
    
    // Or try to find it in window or React fiber
    return { 
      noteId: noteId || 'unknown',
      url: window.location.href 
    };
  });
  
  console.log('Note info:', noteInfo);
  
  // Set some initial content
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('DATABASE CONTENT - This is what is saved in the database');
  await page.waitForTimeout(3000); // Let it save
  
  // Now inject stale localStorage DIRECTLY
  console.log('Injecting stale localStorage...');
  const injectionResult = await page.evaluate(() => {
    // Try to find any pending_save keys that already exist
    const existingKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        existingKeys.push(key);
      }
    }
    
    // Create our own pending_save entry
    // We'll use a generic pattern that should match
    const testKey = 'pending_save_test_main';
    const staleData = {
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph', 
            content: [
              { type: 'text', text: '🔴🔴🔴 STALE LOCALSTORAGE - BUG CONFIRMED IF YOU SEE THIS 🔴🔴🔴' }
            ]
          }
        ]
      },
      timestamp: Date.now() - 30000, // 30 seconds old
      noteId: 'test',
      panelId: 'main',
      version: 1
    };
    
    localStorage.setItem(testKey, JSON.stringify(staleData));
    
    return {
      existingKeys,
      injectedKey: testKey,
      allKeys: Object.keys(localStorage)
    };
  });
  
  console.log('Injection result:', injectionResult);
  
  // Reload the page
  console.log('Reloading page...');
  await page.reload();
  
  // Wait for the app to load
  await page.waitForTimeout(2000);
  
  // Try to open the same note or any note
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Click on the first note in the list (should be our created note)
  const noteElements = await page.locator('[role="button"]').filter({ hasText: /\.(md|txt)$/ }).all();
  if (noteElements.length > 0) {
    await noteElements[0].dblclick();
  } else {
    // Create a new note if no notes exist
    await page.click('button:has-text("Create New Note")');
  }
  
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  // Check the content
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\n=== CONTENT AFTER RELOAD ===`);
  console.log(`"${content}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  if (content?.includes('STALE LOCALSTORAGE')) {
    console.log('🔴🔴🔴 DOUBLE RELOAD BUG CONFIRMED! 🔴🔴🔴');
    console.log('The app loaded the STALE localStorage content!');
    console.log('This proves that lines 214-219 in tiptap-editor-plain.tsx');
    console.log('immediately display localStorage content without checking the database first.');
  } else if (content?.includes('DATABASE CONTENT')) {
    console.log('✅ Showing database content (expected if localStorage didn\'t match)');
  } else {
    console.log('❓ Showing different content:', content?.substring(0, 100));
  }
});

test('DIRECT PROOF: Force localStorage restoration', async ({ page }) => {
  console.log('\n=== DIRECT PROOF WITH FORCED LOCALSTORAGE ===\n');
  
  // Navigate and immediately inject localStorage before React loads
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  
  // Inject localStorage IMMEDIATELY
  await page.evaluate(() => {
    // Multiple attempts with different key patterns
    const keys = [
      'pending_save_test_main',
      'pending_save_undefined_main',
      'pending_save_new_main',
      'pending_save__main'
    ];
    
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '🚨 LOCALSTORAGE BUG - THIS TEXT SHOULD NOT BE VISIBLE 🚨' }
          ]
        }
      ]
    };
    
    keys.forEach(key => {
      localStorage.setItem(key, JSON.stringify({
        content,
        timestamp: Date.now() - 10000, // 10 seconds old
        version: 1
      }));
    });
    
    console.log('Injected localStorage keys:', keys);
  });
  
  // Now let the page finish loading
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Create a new note
  await page.click('button:has-text("Create New Note")');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${content}"`);
  
  if (content?.includes('LOCALSTORAGE BUG')) {
    console.log('\n🚨🚨🚨 BUG CONFIRMED! 🚨🚨🚨');
    console.log('localStorage content was restored!');
  }
});

test('TRACE LOCALSTORAGE: Watch localStorage usage', async ({ page }) => {
  console.log('\n=== TRACING LOCALSTORAGE USAGE ===\n');
  
  // Track all localStorage operations
  await page.addInitScript(() => {
    const originalSetItem = localStorage.setItem;
    const originalGetItem = localStorage.getItem;
    const originalRemoveItem = localStorage.removeItem;
    
    localStorage.setItem = function(key, value) {
      console.log(`[localStorage.setItem] ${key}:`, value?.substring?.(0, 100));
      return originalSetItem.call(this, key, value);
    };
    
    localStorage.getItem = function(key) {
      const value = originalGetItem.call(this, key);
      if (key.includes('pending_save') && value) {
        console.log(`[localStorage.getItem] ${key} FOUND:`, value.substring(0, 100));
      }
      return value;
    };
    
    localStorage.removeItem = function(key) {
      console.log(`[localStorage.removeItem] ${key}`);
      return originalRemoveItem.call(this, key);
    };
  });
  
  // Capture console logs
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('localStorage')) {
      logs.push(text);
      console.log(text);
    }
  });
  
  // Navigate
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Create a note
  await page.click('button:has-text("Create New Note")');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  
  // Type content
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('Test content for localStorage tracking');
  
  // Wait for potential save
  await page.waitForTimeout(2000);
  
  // Trigger unload event
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload'));
  });
  
  await page.waitForTimeout(1000);
  
  // Check what's in localStorage
  const localStorageState = await page.evaluate(() => {
    const result: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('pending_save')) {
        result[key] = localStorage.getItem(key);
      }
    }
    return result;
  });
  
  console.log('\n=== LOCALSTORAGE STATE ===');
  console.log(JSON.stringify(localStorageState, null, 2).substring(0, 500));
  
  // Reload and trace restoration
  console.log('\n=== RELOADING ===');
  await page.reload();
  
  await page.waitForTimeout(3000);
  
  console.log('\n=== LOCALSTORAGE OPERATIONS ===');
  logs.forEach(log => console.log(log));
});