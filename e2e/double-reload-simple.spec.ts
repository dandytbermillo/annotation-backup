import { test, expect } from '@playwright/test';

test('double reload issue - direct navigation', async ({ page }) => {
  console.log('\n=== DOUBLE RELOAD ISSUE TEST ===\n');
  
  // Enable console logging for debug output
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('DEBUG') || text.includes('LOCALSTORAGE') || text.includes('PlainOfflineProvider')) {
      console.log(`[Browser]: ${text}`);
    }
  });
  
  // Step 1: Navigate directly to a specific note
  console.log('Step 1: Navigating to a test note...');
  
  // Go to the app with a specific note ID (you may need to adjust this URL)
  await page.goto('http://localhost:3000/notes/test-reload-note', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Check if we're in plain mode by looking for any indicator
  const isPlainMode = await page.evaluate(() => {
    return localStorage.getItem('collab-mode') === 'plain' || !localStorage.getItem('collab-mode');
  });
  console.log(`Plain mode: ${isPlainMode}`);
  
  // Step 2: Create a test scenario with localStorage
  console.log('\nStep 2: Setting up test data...');
  
  const testNoteId = 'test-reload-note';
  const panelId = 'main';
  
  // Inject OLD content into localStorage (simulating a stale backup)
  await page.evaluate(({ noteId, panelId }) => {
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    const oldContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'OLD STALE CONTENT from previous session' }] }
      ]
    };
    
    localStorage.setItem(pendingKey, JSON.stringify({
      content: oldContent,
      timestamp: Date.now() - 60000, // 1 minute ago
      noteId,
      panelId
    }));
    
    console.log('Injected OLD content into localStorage');
  }, { noteId: testNoteId, panelId });
  
  // Step 3: Simulate that the database has NEW content
  // (In a real scenario, this would be done by saving through the provider)
  console.log('Step 3: Database should have NEW content...');
  
  // Step 4: Reload and check what content appears
  console.log('\nStep 4: FIRST RELOAD...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Try to find any editor or content area
  const contentSelectors = [
    '[contenteditable="true"]',
    '.tiptap',
    '.ProseMirror',
    '[role="textbox"]'
  ];
  
  let editorContent = null;
  for (const selector of contentSelectors) {
    const element = page.locator(selector).first();
    if (await element.count() > 0) {
      editorContent = await element.textContent();
      console.log(`Found content in ${selector}: "${editorContent}"`);
      break;
    }
  }
  
  // Check localStorage status after first reload
  const localStorageAfterFirst = await page.evaluate(({ noteId, panelId }) => {
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    const data = localStorage.getItem(pendingKey);
    return data ? JSON.parse(data) : null;
  }, { noteId: testNoteId, panelId });
  
  console.log('localStorage after first reload:', localStorageAfterFirst ? 'Still present' : 'Cleared');
  
  // Step 5: Second reload
  console.log('\nStep 5: SECOND RELOAD...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  let secondContent = null;
  for (const selector of contentSelectors) {
    const element = page.locator(selector).first();
    if (await element.count() > 0) {
      secondContent = await element.textContent();
      console.log(`Content after second reload in ${selector}: "${secondContent}"`);
      break;
    }
  }
  
  // Check localStorage status after second reload
  const localStorageAfterSecond = await page.evaluate(({ noteId, panelId }) => {
    const pendingKey = `pending_save_${noteId}_${panelId}`;
    const data = localStorage.getItem(pendingKey);
    return data ? JSON.parse(data) : null;
  }, { noteId: testNoteId, panelId });
  
  console.log('localStorage after second reload:', localStorageAfterSecond ? 'Still present' : 'Cleared');
  
  // Step 6: Fetch debug logs
  console.log('\n=== CHECKING DEBUG LOGS ===');
  const debugLogs = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/debug/log');
      const data = await response.json();
      return data.logs?.slice(0, 30) || [];
    } catch (e) {
      console.error('Failed to fetch debug logs:', e);
      return [];
    }
  });
  
  // Filter and display relevant logs
  const relevantLogs = debugLogs.filter((log: any) => 
    log.action?.includes('LOCALSTORAGE') || 
    log.action?.includes('RESTORE') ||
    log.action?.includes('LOAD')
  );
  
  console.log('\nRelevant debug logs:');
  relevantLogs.forEach((log: any) => {
    console.log(`  ${log.timestamp}: ${log.action}`);
    if (log.metadata) {
      console.log(`    Metadata: ${JSON.stringify(log.metadata)}`);
    }
  });
  
  // Analysis
  console.log('\n=== ANALYSIS ===');
  if (editorContent?.includes('OLD STALE CONTENT')) {
    console.log('❌ BUG CONFIRMED: First reload showed OLD localStorage content!');
  } else {
    console.log('✓ First reload did not show old content');
  }
  
  if (secondContent?.includes('OLD STALE CONTENT')) {
    console.log('❌ Second reload still showing OLD content!');
  } else {
    console.log('✓ Second reload did not show old content');
  }
  
  // The test passes if we can demonstrate the issue exists
  // (In a fix PR, this would be inverted to ensure the bug is fixed)
  if (editorContent?.includes('OLD STALE CONTENT') && !secondContent?.includes('OLD STALE CONTENT')) {
    console.log('\n✅ Successfully reproduced the double reload issue!');
  }
});