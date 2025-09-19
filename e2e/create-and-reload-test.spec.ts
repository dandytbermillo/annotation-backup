import { test, expect } from '@playwright/test';

test('create note and test double reload', async ({ page }) => {
  console.log('\n=== CREATE NOTE AND TEST DOUBLE RELOAD ===\n');
  
  // Capture console logs
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('PlainOfflineProvider') || 
        text.includes('LOCALSTORAGE') ||
        text.includes('TiptapEditorPlain') ||
        text.includes('getDocument') ||
        text.includes('loadDocument') ||
        text.includes('saveDocument')) {
      console.log(`[Browser]: ${text}`);
    }
  });
  
  // Step 1: Navigate to app root
  console.log('STEP 1: Navigating to app...');
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  
  // Step 2: Open Notes Explorer if welcome screen is shown
  console.log('STEP 2: Opening Notes Explorer...');
  const openNotesBtn = page.locator('button:has-text("Open Notes Explorer")');
  if (await openNotesBtn.count() > 0) {
    await openNotesBtn.click();
    await page.waitForTimeout(1500);
  }
  
  // Step 3: Close sidebar if it's blocking (force click on close button)
  const closeBtn = page.locator('button[aria-label="Close"], button:has-text("×")').first();
  if (await closeBtn.count() > 0) {
    try {
      await closeBtn.click({ force: true, timeout: 1000 });
      console.log('   Closed sidebar');
    } catch (e) {
      console.log('   Could not close sidebar');
    }
  }
  
  // Step 4: Click on an existing note from sidebar or create new
  console.log('STEP 3: Selecting a note...');
  
  // Try clicking on testing-11.md if it exists
  const testingNote = page.locator('text="testing-11.md"');
  if (await testingNote.count() > 0) {
    console.log('   Clicking on testing-11.md');
    await testingNote.click({ force: true });
    await page.waitForTimeout(2000);
  } else {
    // Try clicking first note in list
    const firstNote = page.locator('[role="button"]').filter({ hasText: /.md$/ }).first();
    if (await firstNote.count() > 0) {
      const noteName = await firstNote.textContent();
      console.log(`   Clicking on first note: ${noteName}`);
      await firstNote.click({ force: true });
      await page.waitForTimeout(2000);
    }
  }
  
  // Check current URL to see if we're on a note page
  const currentUrl = page.url();
  console.log(`   Current URL: ${currentUrl}`);
  
  // Step 5: Find the editor (it should be visible now)
  console.log('\nSTEP 4: Finding editor...');
  const editorSelectors = [
    '[contenteditable="true"]',
    '.ProseMirror',
    '.tiptap',
    '[role="textbox"]',
    '.editor-content'
  ];
  
  let editor = null;
  let foundSelector = '';
  
  // Wait for any editor to appear
  try {
    await page.waitForSelector(editorSelectors.join(', '), { timeout: 5000 });
  } catch (e) {
    console.log('   Warning: Editor selector timeout');
  }
  
  for (const selector of editorSelectors) {
    const elements = page.locator(selector);
    const count = await elements.count();
    console.log(`   Checking ${selector}: ${count} elements`);
    
    if (count > 0) {
      // Check if it's visible
      const firstElement = elements.first();
      const isVisible = await firstElement.isVisible();
      if (isVisible) {
        editor = firstElement;
        foundSelector = selector;
        console.log(`   ✓ Found visible editor with selector: ${selector}`);
        break;
      }
    }
  }
  
  if (!editor) {
    console.log('ERROR: Could not find any editor');
    await page.screenshot({ path: 'debug-no-editor-create.png' });
    
    // Print page content for debugging
    const bodyText = await page.locator('body').textContent();
    console.log('Page text content:', bodyText?.substring(0, 500));
    
    throw new Error('No editor found after navigation');
  }
  
  // Get the note ID from URL if available
  const noteId = currentUrl.includes('/notes/') 
    ? currentUrl.split('/notes/')[1]?.split('?')[0] 
    : 'unknown';
  console.log(`   Note ID: ${noteId}`);
  
  // Step 6: Type initial content
  console.log('\nSTEP 5: Setting initial content...');
  const timestamp = Date.now();
  const INITIAL = `Initial content ${timestamp}`;
  
  await editor.click();
  // Clear existing content
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  // Type new content
  await page.keyboard.type(INITIAL);
  console.log(`   Typed: "${INITIAL}"`);
  await page.waitForTimeout(1000); // Wait for debounce and save
  
  // Step 7: Change to new content
  console.log('\nSTEP 6: Changing to NEW content...');
  const NEW = `NEW CONTENT ${timestamp}`;
  
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(NEW);
  console.log(`   Typed: "${NEW}"`);
  await page.waitForTimeout(1000); // Wait for save
  
  // Check localStorage before reload
  const lsBefore = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return keys.map(k => {
      const data = JSON.parse(localStorage.getItem(k) || '{}');
      let contentText = 'unknown';
      if (data.content?.content?.[0]?.content?.[0]?.text) {
        contentText = data.content.content[0].content[0].text;
      }
      return {
        key: k,
        content: contentText,
        timestamp: data.timestamp
      };
    });
  });
  
  if (lsBefore.length > 0) {
    console.log('\nLocalStorage before reload:');
    lsBefore.forEach(item => {
      console.log(`  - ${item.key}: "${item.content}"`);
    });
  } else {
    console.log('\nNo localStorage pending saves before reload');
  }
  
  // Get content before reload
  const contentBefore = await editor.textContent();
  console.log(`\nContent visible before reload: "${contentBefore}"`);
  
  // Step 8: FIRST RELOAD
  console.log('\n=== FIRST RELOAD ===');
  logs.length = 0; // Clear logs
  
  await page.reload();
  console.log('   Page reloaded, waiting for editor...');
  await page.waitForTimeout(3000);
  
  // Find editor after reload (use same selector that worked before)
  editor = null;
  if (foundSelector) {
    editor = page.locator(foundSelector).first();
    if (await editor.count() === 0) {
      // Try all selectors again
      for (const selector of editorSelectors) {
        const element = page.locator(selector).first();
        if (await element.count() > 0 && await element.isVisible()) {
          editor = element;
          console.log(`   Found editor after reload with: ${selector}`);
          break;
        }
      }
    } else {
      console.log(`   Found editor with same selector: ${foundSelector}`);
    }
  }
  
  if (!editor) {
    console.log('ERROR: Editor lost after first reload');
    await page.screenshot({ path: 'debug-first-reload-lost.png' });
    throw new Error('Editor not found after first reload');
  }
  
  const contentFirst = await editor.textContent();
  console.log(`   Content after FIRST reload: "${contentFirst}"`);
  
  // Check localStorage after first reload
  const lsAfter1 = await page.evaluate(() => {
    return Object.keys(localStorage).filter(k => k.includes('pending_save')).length;
  });
  console.log(`   LocalStorage pending saves: ${lsAfter1}`);
  
  // Analyze logs
  const keyLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE_RESTORE') ||
    log.includes('loadDocument') ||
    log.includes('getDocument')
  );
  if (keyLogs.length > 0) {
    console.log('   Key logs from reload:');
    keyLogs.slice(0, 5).forEach(log => console.log(`     - ${log}`));
  }
  
  // Step 9: SECOND RELOAD
  console.log('\n=== SECOND RELOAD ===');
  logs.length = 0; // Clear logs
  
  await page.reload();
  console.log('   Page reloaded, waiting for editor...');
  await page.waitForTimeout(3000);
  
  // Find editor after second reload
  editor = page.locator(foundSelector || editorSelectors[0]).first();
  if (await editor.count() === 0) {
    for (const selector of editorSelectors) {
      const element = page.locator(selector).first();
      if (await element.count() > 0 && await element.isVisible()) {
        editor = element;
        break;
      }
    }
  }
  
  if (!editor) {
    console.log('ERROR: Editor lost after second reload');
    throw new Error('Editor not found after second reload');
  }
  
  const contentSecond = await editor.textContent();
  console.log(`   Content after SECOND reload: "${contentSecond}"`);
  
  // Check localStorage after second reload
  const lsAfter2 = await page.evaluate(() => {
    return Object.keys(localStorage).filter(k => k.includes('pending_save')).length;
  });
  console.log(`   LocalStorage pending saves: ${lsAfter2}`);
  
  // Step 10: ANALYSIS
  console.log('\n=== ANALYSIS ===');
  console.log('Timeline:');
  console.log(`  Before any reload: "${contentBefore}" (should be "${NEW}")`);
  console.log(`  After 1st reload:  "${contentFirst}"`);
  console.log(`  After 2nd reload:  "${contentSecond}"`);
  console.log(`  Expected:          "${NEW}"`);
  
  const firstCorrect = contentFirst === NEW || contentFirst === contentBefore;
  const secondCorrect = contentSecond === NEW || contentSecond === contentBefore;
  
  if (contentFirst !== NEW && contentSecond === NEW) {
    console.log('\n❌ DOUBLE RELOAD BUG CONFIRMED!');
    console.log('   First reload: Shows WRONG content');
    console.log('   Second reload: Shows CORRECT content');
    console.log('   This is the double reload issue!');
  } else if (contentFirst === NEW && contentSecond === NEW) {
    console.log('\n✅ WORKING CORRECTLY: Both reloads show new content');
  } else if (contentFirst !== NEW && contentSecond !== NEW) {
    console.log('\n❌ BROKEN: Neither reload shows new content');
    console.log('   Content is not persisting at all');
  } else {
    console.log('\n⚠️ UNEXPECTED PATTERN');
  }
  
  // Document if localStorage restoration happened
  if (keyLogs.some(log => log.includes('LOCALSTORAGE_RESTORE'))) {
    console.log('\n📝 localStorage restoration was triggered on first reload');
  }
});