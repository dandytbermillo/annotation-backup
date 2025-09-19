import { test, expect } from '@playwright/test';

test('simple double reload test', async ({ page }) => {
  console.log('\n=== SIMPLE DOUBLE RELOAD TEST ===\n');
  
  // Enable console logging
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('PlainOfflineProvider') || 
        text.includes('LOCALSTORAGE') ||
        text.includes('TiptapEditorPlain')) {
      console.log(`[Browser]: ${text}`);
    }
  });
  
  // Navigate to app root
  console.log('1. Navigating to app...');
  await page.goto('http://localhost:3000');
  
  // Open notes explorer
  console.log('2. Opening notes explorer...');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  // Open existing note
  console.log('3. Opening existing note...');
  await page.dblclick('text=testing-11.md');
  
  // Wait for editor to load
  console.log('4. Waiting for editor...');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Type initial content
  console.log('5. Setting initial content...');
  const timestamp = Date.now();
  const INITIAL = `Initial content ${timestamp}`;
  
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(INITIAL);
  console.log(`   Typed: "${INITIAL}"`);
  await page.waitForTimeout(500); // Wait for debounce
  
  // Change content
  console.log('6. Changing content...');
  const NEW = `New content ${timestamp}`;
  
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(NEW);
  console.log(`   Typed: "${NEW}"`);
  await page.waitForTimeout(500); // Wait for debounce
  
  // Get content before reload
  const beforeReload = await editor.textContent();
  console.log(`\n7. Content before reload: "${beforeReload}"`);
  
  // First reload
  console.log('\n8. FIRST RELOAD...');
  await page.reload();
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const afterFirstReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`   Content after first reload: "${afterFirstReload}"`);
  
  // Second reload
  console.log('\n9. SECOND RELOAD...');
  await page.reload();
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const afterSecondReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`   Content after second reload: "${afterSecondReload}"`);
  
  // Analysis
  console.log('\n=== RESULTS ===');
  console.log(`Expected: "${NEW}"`);
  console.log(`1st reload: "${afterFirstReload}"`);
  console.log(`2nd reload: "${afterSecondReload}"`);
  
  const firstCorrect = afterFirstReload === NEW;
  const secondCorrect = afterSecondReload === NEW;
  
  if (!firstCorrect && secondCorrect) {
    console.log('\n❌ BUG CONFIRMED: Takes two reloads to see changes');
  } else if (firstCorrect && secondCorrect) {
    console.log('\n✅ Both reloads show correct content');
  } else {
    console.log('\n⚠️ Unexpected behavior');
  }
});