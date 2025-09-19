import { test, expect } from '@playwright/test';

test('verify content appending vs replacement claim', async ({ page }) => {
  console.log('\n=== VERIFYING CONTENT BEHAVIOR ===\n');
  
  // Navigate and open note
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Get initial content
  const initialContent = await editor.textContent();
  console.log(`Initial content length: ${initialContent?.length}`);
  console.log(`Initial content preview: "${initialContent?.substring(0, 50)}..."`);
  
  // Test 1: Type without selecting first
  console.log('\n--- Test 1: Type without selecting ---');
  await editor.click();
  await page.keyboard.type('TEST1');
  await page.waitForTimeout(100);
  
  const afterTest1 = await editor.textContent();
  console.log(`After TEST1 length: ${afterTest1?.length}`);
  console.log(`After TEST1 preview: "${afterTest1?.substring(0, 60)}..."`);
  
  // Test 2: Select all and type
  console.log('\n--- Test 2: Select all (Ctrl+A) and type ---');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(100);
  
  // Check what's selected
  const selectedText = await page.evaluate(() => {
    const selection = window.getSelection();
    return selection?.toString();
  });
  console.log(`Selected text length: ${selectedText?.length}`);
  console.log(`Selected text preview: "${selectedText?.substring(0, 50)}..."`);
  
  await page.keyboard.type('REPLACEMENT_TEXT');
  await page.waitForTimeout(100);
  
  const afterReplacement = await editor.textContent();
  console.log(`After replacement length: ${afterReplacement?.length}`);
  console.log(`After replacement: "${afterReplacement}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  if (afterReplacement === 'REPLACEMENT_TEXT') {
    console.log('✅ Control+A correctly replaced all text');
  } else if (afterReplacement?.includes('REPLACEMENT_TEXT') && afterReplacement.length > 16) {
    console.log('❌ Text was APPENDED, not replaced!');
    console.log(`   Expected: "REPLACEMENT_TEXT" (16 chars)`);
    console.log(`   Got: "${afterReplacement}" (${afterReplacement.length} chars)`);
  } else {
    console.log('⚠️ Unexpected behavior');
  }
});

test('verify double reload behavior', async ({ page }) => {
  console.log('\n=== VERIFYING DOUBLE RELOAD ===\n');
  
  // Track console logs for localStorage activity
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LOCALSTORAGE') || text.includes('localStorage')) {
      logs.push(text);
    }
  });
  
  // Navigate and open note
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Clear and set clean content
  console.log('Step 1: Setting clean content');
  await editor.click();
  await page.keyboard.press('Control+A');
  const timestamp = Date.now();
  await page.keyboard.type(`Clean content ${timestamp}`);
  await page.waitForTimeout(500); // Wait for autosave
  
  const contentBefore = await editor.textContent();
  console.log(`Content before reload: "${contentBefore}"`);
  
  // Edit content
  console.log('\nStep 2: Editing content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(`Edited content ${timestamp}`);
  await page.waitForTimeout(500); // Wait for autosave
  
  const contentAfterEdit = await editor.textContent();
  console.log(`Content after edit: "${contentAfterEdit}"`);
  
  // Check localStorage logs
  console.log('\nLocalStorage activity detected:');
  logs.forEach(log => console.log(`  - ${log}`));
  
  // First reload
  console.log('\n--- FIRST RELOAD ---');
  logs.length = 0; // Clear logs
  await page.reload();
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const contentAfterFirstReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after first reload: "${contentAfterFirstReload}"`);
  
  console.log('LocalStorage activity during first reload:');
  logs.forEach(log => console.log(`  - ${log}`));
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  logs.length = 0; // Clear logs
  await page.reload();
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const contentAfterSecondReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after second reload: "${contentAfterSecondReload}"`);
  
  console.log('LocalStorage activity during second reload:');
  logs.forEach(log => console.log(`  - ${log}`));
  
  // Analysis
  console.log('\n=== DOUBLE RELOAD ANALYSIS ===');
  const expectedContent = `Edited content ${timestamp}`;
  
  console.log(`Expected: "${expectedContent}"`);
  console.log(`1st reload: "${contentAfterFirstReload}"`);
  console.log(`2nd reload: "${contentAfterSecondReload}"`);
  
  if (contentAfterFirstReload !== expectedContent && contentAfterSecondReload === expectedContent) {
    console.log('\n✅ DOUBLE RELOAD ISSUE CONFIRMED');
    console.log('   First reload: incorrect content');
    console.log('   Second reload: correct content');
  } else if (contentAfterFirstReload === expectedContent && contentAfterSecondReload === expectedContent) {
    console.log('\n❌ NO DOUBLE RELOAD ISSUE FOUND');
    console.log('   Both reloads show correct content');
  } else if (contentAfterFirstReload?.includes(expectedContent) && contentAfterFirstReload.length > expectedContent.length) {
    console.log('\n⚠️ DIFFERENT ISSUE: Content appending');
    console.log('   Content is being appended rather than replaced');
  } else {
    console.log('\n⚠️ UNEXPECTED BEHAVIOR');
  }
});