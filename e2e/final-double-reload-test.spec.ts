import { test, expect } from '@playwright/test';

test('demonstrate double reload issue', async ({ page }) => {
  console.log('\n=== DOUBLE RELOAD ISSUE TEST ===\n');
  
  // Helper to open the note
  const openNote = async (message: string) => {
    console.log(message);
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  };
  
  // Step 1: Navigate to app and open note
  console.log('Step 1: Navigate to app...');
  await page.goto('http://localhost:3000');
  await openNote('Step 2: Opening note testing-11.md...');
  
  // Step 3: Set initial content
  const timestamp = Date.now();
  const initialContent = `Initial ${timestamp}`;
  console.log(`Step 3: Setting initial content: "${initialContent}"`);
  
  await page.click('[contenteditable="true"]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(initialContent);
  await page.waitForTimeout(500); // Wait for autosave
  
  let content = await page.locator('[contenteditable="true"]').textContent();
  console.log(`   Content saved: "${content}"`);
  
  // Step 4: Edit content
  const editedContent = `Edited ${timestamp}`;
  console.log(`Step 4: Editing content: "${editedContent}"`);
  
  await page.click('[contenteditable="true"]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(editedContent);
  await page.waitForTimeout(500); // Wait for autosave
  
  content = await page.locator('[contenteditable="true"]').textContent();
  console.log(`   Content after edit: "${content}"`);
  
  // Step 5: First reload
  console.log('\n=== FIRST RELOAD ===');
  await page.reload();
  await openNote('   Re-opening note after first reload...');
  
  const contentAfterFirstReload = await page.locator('[contenteditable="true"]').textContent();
  console.log(`   Content after FIRST reload: "${contentAfterFirstReload}"`);
  
  // Step 6: Second reload
  console.log('\n=== SECOND RELOAD ===');
  await page.reload();
  await openNote('   Re-opening note after second reload...');
  
  const contentAfterSecondReload = await page.locator('[contenteditable="true"]').textContent();
  console.log(`   Content after SECOND reload: "${contentAfterSecondReload}"`);
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  console.log(`Expected content: "${editedContent}"`);
  console.log(`After 1st reload: "${contentAfterFirstReload}"`);
  console.log(`After 2nd reload: "${contentAfterSecondReload}"`);
  
  const firstReloadCorrect = contentAfterFirstReload === editedContent;
  const secondReloadCorrect = contentAfterSecondReload === editedContent;
  
  if (!firstReloadCorrect && secondReloadCorrect) {
    console.log('\n❌ DOUBLE RELOAD BUG CONFIRMED!');
    console.log('   First reload shows wrong content');
    console.log('   Second reload shows correct content');
    console.log('\n   This confirms the localStorage restoration issue:');
    console.log('   - On first reload, stale localStorage is restored');
    console.log('   - On second reload, fresh data is loaded from database');
  } else if (firstReloadCorrect && secondReloadCorrect) {
    console.log('\n✅ Bug appears to be fixed - both reloads show correct content');
  } else if (!firstReloadCorrect && !secondReloadCorrect) {
    console.log('\n⚠️ Both reloads show wrong content - different issue');
  } else {
    console.log('\n⚠️ Unexpected result - first reload correct, second wrong');
  }
  
  // Optional: Show what the content looks like to detect append issues
  if (contentAfterFirstReload.includes(editedContent) && contentAfterFirstReload.length > editedContent.length) {
    console.log('\n📝 Note: Content appears to be appended rather than replaced');
  }
});