import { test, expect } from '@playwright/test';

test('honest investigation of editor behavior', async ({ page }) => {
  console.log('\n=== HONEST INVESTIGATION - NO ASSUMPTIONS ===\n');
  
  // Helper to get clean content without extra whitespace
  const getEditorContent = async () => {
    const content = await page.locator('[contenteditable="true"]').first().textContent();
    return content || '';
  };
  
  // Navigate to app
  console.log('1. Opening the app...');
  await page.goto('http://localhost:3000');
  
  // Open notes explorer and note
  console.log('2. Opening notes explorer...');
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  
  console.log('3. Opening note testing-11.md...');
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  // Check what's currently in the editor
  console.log('\n--- CURRENT STATE ---');
  let content = await getEditorContent();
  console.log(`Current content: "${content}"`);
  console.log(`Current length: ${content.length} characters`);
  
  // Try to clear the editor completely
  console.log('\n--- ATTEMPTING TO CLEAR EDITOR ---');
  const editor = page.locator('[contenteditable="true"]').first();
  
  // Method 1: Click and select all
  await editor.click();
  await page.keyboard.press('Control+A');
  
  // Check what got selected
  const selectedText = await page.evaluate(() => {
    const selection = window.getSelection();
    return {
      text: selection?.toString() || '',
      rangeCount: selection?.rangeCount || 0,
      isCollapsed: selection?.isCollapsed || false
    };
  });
  
  console.log(`Selection info:`, selectedText);
  
  // Type something to see what happens
  await page.keyboard.type('HELLO');
  await page.waitForTimeout(500);
  
  content = await getEditorContent();
  console.log(`After typing HELLO: "${content}"`);
  console.log(`Length: ${content.length}`);
  
  // Try Method 2: Triple-click to select all
  console.log('\n--- TRYING TRIPLE-CLICK ---');
  await editor.click({ clickCount: 3 });
  await page.keyboard.type('WORLD');
  await page.waitForTimeout(500);
  
  content = await getEditorContent();
  console.log(`After triple-click + WORLD: "${content}"`);
  console.log(`Length: ${content.length}`);
  
  // Save a specific marker text
  console.log('\n--- SETTING MARKER TEXT ---');
  await editor.click({ clickCount: 3 });
  const marker = `MARKER_${Date.now()}`;
  await page.keyboard.type(marker);
  await page.waitForTimeout(1000); // Give autosave more time
  
  content = await getEditorContent();
  console.log(`After setting marker: "${content}"`);
  
  // Now test reload behavior
  console.log('\n--- TESTING RELOAD ---');
  console.log('Reloading page...');
  await page.reload();
  
  // Need to reopen the note after reload
  await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
  await page.click('button:has-text("Open Notes Explorer")');
  await page.waitForTimeout(1000);
  await page.dblclick('text=testing-11.md');
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const contentAfterReload = await getEditorContent();
  console.log(`Content after reload: "${contentAfterReload}"`);
  console.log(`Length after reload: ${contentAfterReload.length}`);
  
  // Check if our marker is there
  if (contentAfterReload.includes(marker)) {
    console.log(`✓ Marker "${marker}" found in content`);
    if (contentAfterReload === marker) {
      console.log('✓ Content is EXACTLY our marker (replacement worked)');
    } else {
      console.log('✗ Content contains MORE than just our marker');
      const markerIndex = contentAfterReload.indexOf(marker);
      console.log(`  Marker position: ${markerIndex}`);
      if (markerIndex === 0) {
        console.log('  Marker is at the BEGINNING (prepended)');
      } else if (markerIndex === contentAfterReload.length - marker.length) {
        console.log('  Marker is at the END (appended)');
      } else {
        console.log('  Marker is in the MIDDLE');
      }
    }
  } else {
    console.log(`✗ Marker "${marker}" NOT found - content was not saved or was lost`);
  }
  
  console.log('\n--- SUMMARY ---');
  console.log('What we learned:');
  console.log(`1. Control+A selection: ${selectedText.text ? 'Selected something' : 'Selected nothing'}`);
  console.log(`2. Content replacement: ${content === marker ? 'Works' : 'Does not work - content accumulates'}`);
  console.log(`3. Content persistence: ${contentAfterReload.includes(marker) ? 'Content was saved' : 'Content was not saved'}`);
});

test('honest investigation of double reload', async ({ page }) => {
  console.log('\n=== HONEST DOUBLE RELOAD TEST ===\n');
  
  // Helper function
  const openNoteAndGetContent = async (message: string) => {
    console.log(message);
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
    const content = await page.locator('[contenteditable="true"]').first().textContent();
    return content || '';
  };
  
  // Start fresh
  await page.goto('http://localhost:3000');
  let content = await openNoteAndGetContent('Opening note initially...');
  console.log(`Initial content: "${content.substring(0, 50)}..."`);
  
  // Make a unique edit
  const uniqueEdit = `UNIQUE_${Date.now()}`;
  console.log(`\nMaking edit: "${uniqueEdit}"`);
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(uniqueEdit);
  await page.waitForTimeout(1000); // Wait for autosave
  
  content = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content after edit: "${content}"`);
  
  // First reload
  console.log('\n--- FIRST RELOAD ---');
  await page.reload();
  const firstReloadContent = await openNoteAndGetContent('Re-opening note after first reload...');
  console.log(`Content after 1st reload: "${firstReloadContent}"`);
  
  // Second reload
  console.log('\n--- SECOND RELOAD ---');
  await page.reload();
  const secondReloadContent = await openNoteAndGetContent('Re-opening note after second reload...');
  console.log(`Content after 2nd reload: "${secondReloadContent}"`);
  
  // Analysis
  console.log('\n--- ANALYSIS ---');
  console.log(`Edit was: "${uniqueEdit}"`);
  
  const firstHasEdit = firstReloadContent.includes(uniqueEdit);
  const secondHasEdit = secondReloadContent.includes(uniqueEdit);
  const contentsSame = firstReloadContent === secondReloadContent;
  
  console.log(`First reload has our edit: ${firstHasEdit}`);
  console.log(`Second reload has our edit: ${secondHasEdit}`);
  console.log(`Both reloads show same content: ${contentsSame}`);
  
  if (!firstHasEdit && secondHasEdit) {
    console.log('\n✓ DOUBLE RELOAD BUG CONFIRMED!');
    console.log('  First reload: missing our edit');
    console.log('  Second reload: shows our edit');
  } else if (firstHasEdit && secondHasEdit && contentsSame) {
    console.log('\n✗ NO DOUBLE RELOAD BUG');
    console.log('  Both reloads show the same content with our edit');
  } else if (firstHasEdit && secondHasEdit && !contentsSame) {
    console.log('\n⚠ DIFFERENT ISSUE');
    console.log('  Both have the edit but show different content');
  } else if (!firstHasEdit && !secondHasEdit) {
    console.log('\n⚠ SAVE ISSUE');
    console.log('  Edit was not saved at all');
  }
  
  // Show actual differences if any
  if (!contentsSame) {
    console.log('\nContent differences:');
    console.log(`Length difference: ${firstReloadContent.length} vs ${secondReloadContent.length}`);
  }
});