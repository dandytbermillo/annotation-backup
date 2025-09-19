import { test, expect } from '@playwright/test';

test('double reload with proper navigation', async ({ page }) => {
  console.log('\n=== DOUBLE RELOAD TEST WITH NAVIGATION ===\n');
  
  // Enable console logging for debugging
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('PlainOfflineProvider') || 
        text.includes('LOCALSTORAGE') ||
        text.includes('TiptapEditorPlain') ||
        text.includes('getDocument') ||
        text.includes('loadDocument')) {
      console.log(`[Browser]: ${text}`);
    }
  });
  
  // Step 1: Navigate to app
  console.log('STEP 1: Navigating to app...');
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  
  // Step 2: Handle welcome screen - click Open Notes Explorer
  console.log('STEP 2: Opening Notes Explorer...');
  const openNotesBtn = page.locator('button:has-text("Open Notes Explorer")');
  if (await openNotesBtn.count() > 0) {
    await openNotesBtn.click();
    await page.waitForTimeout(2000);
  }
  
  // Step 3: Create or select a note
  console.log('STEP 3: Creating or selecting a note...');
  
  // Try to find "New Note" or "Create" button in the explorer
  const createButtons = page.locator('button').filter({ hasText: /New Note|Create|Add Note|\+/i });
  if (await createButtons.count() > 0) {
    console.log('   Found create button, clicking...');
    await createButtons.first().click();
    await page.waitForTimeout(2000);
  } else {
    // Try to click on an existing note if available
    const noteItems = page.locator('[role="button"], .note-item, .list-item').first();
    if (await noteItems.count() > 0) {
      console.log('   Clicking existing note...');
      await noteItems.click();
      await page.waitForTimeout(2000);
    }
  }
  
  // Step 4: Find the editor
  console.log('STEP 4: Finding editor...');
  const editorSelectors = [
    '[contenteditable="true"]',
    '.ProseMirror',
    '.tiptap',
    '[data-testid="editor"]',
    '.editor'
  ];
  
  let editor = null;
  for (const selector of editorSelectors) {
    const element = page.locator(selector).first();
    if (await element.count() > 0) {
      editor = element;
      console.log(`   Found editor with selector: ${selector}`);
      break;
    }
  }
  
  if (!editor) {
    // Take a screenshot to see current state
    await page.screenshot({ path: 'debug-no-editor.png' });
    console.log('   No editor found. Screenshot saved to debug-no-editor.png');
    console.log('   Current URL:', page.url());
    
    // Try navigating directly to a note URL
    console.log('   Attempting direct navigation to a note...');
    await page.goto('http://localhost:3000/notes/test-note');
    await page.waitForTimeout(3000);
    
    // Try finding editor again
    for (const selector of editorSelectors) {
      const element = page.locator(selector).first();
      if (await element.count() > 0) {
        editor = element;
        console.log(`   Found editor after direct navigation with selector: ${selector}`);
        break;
      }
    }
  }
  
  if (!editor) {
    console.log('ERROR: Could not find editor even after navigation');
    throw new Error('No editor found after all attempts');
  }
  
  // Get current noteId from URL
  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);
  const noteId = currentUrl.includes('/notes/') ? currentUrl.split('/notes/')[1]?.split('?')[0] : 'unknown';
  console.log(`Note ID: ${noteId}`);
  
  // Step 5: Type initial content
  console.log('\nSTEP 5: Setting initial content...');
  const timestamp = Date.now();
  const INITIAL_CONTENT = `Initial content ${timestamp}`;
  
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(INITIAL_CONTENT);
  console.log(`   Typed: "${INITIAL_CONTENT}"`);
  await page.waitForTimeout(500); // Wait for debounce
  
  // Step 6: Change content
  console.log('\nSTEP 6: Changing content...');
  const NEW_CONTENT = `NEW CONTENT ${timestamp}`;
  
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(NEW_CONTENT);
  console.log(`   Typed: "${NEW_CONTENT}"`);
  await page.waitForTimeout(500); // Wait for save
  
  // Check localStorage before reload
  const localStorageBefore = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.map(k => {
      const data = JSON.parse(localStorage.getItem(k) || '{}');
      return {
        key: k,
        hasContent: !!data.content,
        timestamp: data.timestamp
      };
    });
  });
  console.log('\nLocalStorage before reload:', localStorageBefore);
  
  // Get content before reload
  const contentBeforeReload = await editor.textContent();
  console.log(`Content before reload: "${contentBeforeReload}"`);
  
  // Step 7: First reload
  console.log('\n=== FIRST RELOAD ===');
  logs.length = 0; // Clear logs
  
  await page.reload();
  await page.waitForTimeout(3000);
  
  // Find editor after reload
  editor = null;
  for (const selector of editorSelectors) {
    const element = page.locator(selector).first();
    if (await element.count() > 0) {
      editor = element;
      break;
    }
  }
  
  if (!editor) {
    console.log('ERROR: Editor lost after first reload');
    throw new Error('Editor not found after first reload');
  }
  
  const contentAfterFirstReload = await editor.textContent();
  console.log(`Content after FIRST reload: "${contentAfterFirstReload}"`);
  
  // Check localStorage after first reload
  const localStorageAfter1 = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.length;
  });
  console.log(`LocalStorage pending saves after first reload: ${localStorageAfter1}`);
  
  // Analyze logs from first reload
  const relevantLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE') || 
    log.includes('loadDocument') ||
    log.includes('getDocument') ||
    log.includes('RESTORE')
  );
  console.log('\nKey logs from first reload:');
  relevantLogs.forEach(log => console.log(`  - ${log}`));
  
  // Step 8: Second reload
  console.log('\n=== SECOND RELOAD ===');
  logs.length = 0; // Clear logs
  
  await page.reload();
  await page.waitForTimeout(3000);
  
  // Find editor after second reload
  editor = null;
  for (const selector of editorSelectors) {
    const element = page.locator(selector).first();
    if (await element.count() > 0) {
      editor = element;
      break;
    }
  }
  
  if (!editor) {
    console.log('ERROR: Editor lost after second reload');
    throw new Error('Editor not found after second reload');
  }
  
  const contentAfterSecondReload = await editor.textContent();
  console.log(`Content after SECOND reload: "${contentAfterSecondReload}"`);
  
  // Check localStorage after second reload
  const localStorageAfter2 = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.length;
  });
  console.log(`LocalStorage pending saves after second reload: ${localStorageAfter2}`);
  
  // Analyze logs from second reload
  const secondReloadLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE') || 
    log.includes('loadDocument') ||
    log.includes('getDocument') ||
    log.includes('RESTORE')
  );
  console.log('\nKey logs from second reload:');
  secondReloadLogs.forEach(log => console.log(`  - ${log}`));
  
  // Step 9: Analysis
  console.log('\n=== ANALYSIS ===');
  console.log(`Expected content: "${NEW_CONTENT}"`);
  console.log(`Before reload:    "${contentBeforeReload}"`);
  console.log(`After 1st reload: "${contentAfterFirstReload}"`);
  console.log(`After 2nd reload: "${contentAfterSecondReload}"`);
  
  const firstReloadCorrect = contentAfterFirstReload === NEW_CONTENT;
  const secondReloadCorrect = contentAfterSecondReload === NEW_CONTENT;
  
  if (!firstReloadCorrect && secondReloadCorrect) {
    console.log('\n❌ BUG CONFIRMED: First reload shows wrong content, second reload shows correct content');
    console.log('This confirms the double reload issue is present');
    
    // Additional analysis
    if (contentAfterFirstReload === INITIAL_CONTENT) {
      console.log('   First reload reverted to INITIAL content (older save)');
    } else if (contentAfterFirstReload === '') {
      console.log('   First reload showed empty content');
    } else {
      console.log('   First reload showed unexpected content');
    }
  } else if (firstReloadCorrect && secondReloadCorrect) {
    console.log('\n✅ Both reloads show correct content - issue may be fixed or not reproduced');
  } else if (!firstReloadCorrect && !secondReloadCorrect) {
    console.log('\n❌ Neither reload shows correct content - different issue');
  } else if (firstReloadCorrect && !secondReloadCorrect) {
    console.log('\n⚠️ Unexpected: First reload correct, second reload wrong');
  }
  
  // Make assertions (these will fail if bug is present, which is what we want to document)
  expect(contentAfterFirstReload).toBe(NEW_CONTENT);
  expect(contentAfterSecondReload).toBe(NEW_CONTENT);
});