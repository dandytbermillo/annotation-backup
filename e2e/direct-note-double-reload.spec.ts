import { test, expect } from '@playwright/test';

test('direct note navigation - double reload test', async ({ page }) => {
  console.log('\n=== DIRECT NOTE DOUBLE RELOAD TEST ===\n');
  
  // Capture console logs
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
  
  // Step 1: Navigate directly to a specific note (use one we saw in sidebar)
  console.log('STEP 1: Navigating directly to testing-11 note...');
  await page.goto('http://localhost:3000/notes/testing-11');
  await page.waitForTimeout(3000);
  
  // Step 2: Find the editor
  console.log('STEP 2: Finding editor...');
  const editorSelectors = [
    '[contenteditable="true"]',
    '.ProseMirror',
    '.tiptap',
    '[role="textbox"]'
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
    // If no editor, try clicking the note in sidebar
    console.log('   No editor found, trying to click note in sidebar...');
    const noteItem = page.locator('text="testing-11.md"').first();
    if (await noteItem.count() > 0) {
      await noteItem.click({ force: true }); // Force click to bypass overlays
      await page.waitForTimeout(2000);
      
      // Try finding editor again
      for (const selector of editorSelectors) {
        const element = page.locator(selector).first();
        if (await element.count() > 0) {
          editor = element;
          console.log(`   Found editor after clicking note`);
          break;
        }
      }
    }
  }
  
  if (!editor) {
    console.log('ERROR: Could not find editor');
    // Take screenshot for debugging
    await page.screenshot({ path: 'debug-no-editor-direct.png' });
    throw new Error('No editor found');
  }
  
  // Step 3: Clear and type initial content
  console.log('\nSTEP 3: Setting initial content...');
  const timestamp = Date.now();
  const INITIAL = `Initial content ${timestamp}`;
  
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(INITIAL);
  console.log(`   Typed: "${INITIAL}"`);
  await page.waitForTimeout(500); // Wait for debounce
  
  // Step 4: Change to new content
  console.log('\nSTEP 4: Changing to NEW content...');
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
      const contentText = JSON.stringify(data.content).substring(0, 100);
      return {
        key: k,
        contentPreview: contentText,
        timestamp: data.timestamp
      };
    });
  });
  console.log('\nLocalStorage before reload:', JSON.stringify(lsBefore, null, 2));
  
  // Get content before reload
  const contentBefore = await editor.textContent();
  console.log(`\nContent before reload: "${contentBefore}"`);
  
  // Step 5: FIRST RELOAD
  console.log('\n=== FIRST RELOAD ===');
  logs.length = 0; // Clear logs for this reload
  
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
    await page.screenshot({ path: 'debug-first-reload.png' });
    throw new Error('Editor not found after first reload');
  }
  
  const contentFirst = await editor.textContent();
  console.log(`Content after FIRST reload: "${contentFirst}"`);
  
  // Check localStorage after first reload
  const lsAfter1 = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return {
      count: keys.length,
      keys: keys
    };
  });
  console.log(`LocalStorage pending saves after first reload: ${lsAfter1.count} keys`);
  
  // Log analysis for first reload
  const restoreLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE_RESTORE') ||
    log.includes('LOCALSTORAGE_CHECK') ||
    log.includes('loadDocument') ||
    log.includes('getDocument')
  );
  if (restoreLogs.length > 0) {
    console.log('\nKey logs from first reload:');
    restoreLogs.forEach(log => console.log(`  - ${log}`));
  }
  
  // Step 6: SECOND RELOAD
  console.log('\n=== SECOND RELOAD ===');
  logs.length = 0; // Clear logs for this reload
  
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
    await page.screenshot({ path: 'debug-second-reload.png' });
    throw new Error('Editor not found after second reload');
  }
  
  const contentSecond = await editor.textContent();
  console.log(`Content after SECOND reload: "${contentSecond}"`);
  
  // Check localStorage after second reload
  const lsAfter2 = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
    return {
      count: keys.length,
      keys: keys
    };
  });
  console.log(`LocalStorage pending saves after second reload: ${lsAfter2.count} keys`);
  
  // Log analysis for second reload
  const secondLogs = logs.filter(log => 
    log.includes('LOCALSTORAGE_RESTORE') ||
    log.includes('LOCALSTORAGE_CHECK') ||
    log.includes('loadDocument') ||
    log.includes('getDocument')
  );
  if (secondLogs.length > 0) {
    console.log('\nKey logs from second reload:');
    secondLogs.forEach(log => console.log(`  - ${log}`));
  }
  
  // Step 7: ANALYSIS
  console.log('\n=== ANALYSIS ===');
  console.log('Content timeline:');
  console.log(`  Before reload: "${contentBefore}"`);
  console.log(`  After 1st:     "${contentFirst}"`);
  console.log(`  After 2nd:     "${contentSecond}"`);
  console.log(`  Expected:      "${NEW}"`);
  
  const firstCorrect = contentFirst === NEW;
  const secondCorrect = contentSecond === NEW;
  
  if (!firstCorrect && secondCorrect) {
    console.log('\n❌ BUG CONFIRMED: Double reload issue present');
    console.log('   First reload: WRONG content');
    console.log('   Second reload: CORRECT content');
    
    if (contentFirst === INITIAL) {
      console.log('   → First reload reverted to INITIAL content');
    } else if (contentFirst === '') {
      console.log('   → First reload showed EMPTY content');  
    } else {
      console.log('   → First reload showed UNEXPECTED content');
    }
  } else if (firstCorrect && secondCorrect) {
    console.log('\n✅ WORKING: Both reloads show correct content');
  } else if (!firstCorrect && !secondCorrect) {
    console.log('\n❌ BROKEN: Neither reload shows correct content');
  } else {
    console.log('\n⚠️ UNEXPECTED: First correct, second wrong');
  }
  
  // These assertions document expected behavior (will fail if bug exists)
  console.log('\n--- Test assertions (expecting both to pass) ---');
  try {
    expect(contentFirst).toBe(NEW);
    console.log('✓ First reload assertion passed');
  } catch (e) {
    console.log('✗ First reload assertion failed');
  }
  
  try {
    expect(contentSecond).toBe(NEW);
    console.log('✓ Second reload assertion passed');
  } catch (e) {
    console.log('✗ Second reload assertion failed');
  }
});