import { test, expect, Page } from '@playwright/test';

test.describe('Double Reload Issue', () => {
  let page: Page;
  
  test.beforeEach(async ({ browser }) => {
    // Create a new page for each test
    page = await browser.newPage();
    
    // Enable console logging
    page.on('console', msg => {
      if (msg.text().includes('DEBUG') || msg.text().includes('PlainOfflineProvider') || msg.text().includes('LOCALSTORAGE')) {
        console.log(`[Browser Console]: ${msg.text()}`);
      }
    });
    
    // Navigate to the app
    await page.goto('http://localhost:3000');
    
    // Wait for app to load
    await page.waitForTimeout(3000);
    
    // Check if we need to dismiss any initial setup
    const loadingText = await page.locator('text="Loading application..."').count();
    if (loadingText === 0) {
      console.log('App loaded successfully');
    } else {
      console.log('App still loading, waiting more...');
      await page.waitForTimeout(5000);
    }
  });

  test('reproduces double reload issue with localStorage backup', async () => {
    console.log('\n=== STARTING DOUBLE RELOAD TEST ===\n');
    
    // Step 1: Navigate to a note
    console.log('Step 1: Navigating to a note...');
    
    // Look for any existing note or create area
    const noteArea = await page.locator('[contenteditable="true"]').first();
    const hasEditor = await noteArea.count() > 0;
    
    if (!hasEditor) {
      console.log('No editor found, trying to create a note...');
      // Try to find and click a create note button
      const createButton = page.locator('button:has-text("Create"), button:has-text("New Note"), button:has-text("+")').first();
      if (await createButton.count() > 0) {
        await createButton.click();
        await page.waitForTimeout(2000);
      }
    }
    
    // Wait for editor to be ready
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    const editor = page.locator('[contenteditable="true"]').first();
    
    // Step 2: Type initial content
    console.log('Step 2: Typing initial content...');
    await editor.click();
    await page.keyboard.press('Control+A'); // Select all
    await page.keyboard.press('Delete'); // Clear
    await editor.type('Initial content from test');
    await page.waitForTimeout(1000); // Wait for debounce
    
    // Step 3: Simulate visibility change to create localStorage backup
    console.log('Step 3: Simulating visibility change (tab switch)...');
    
    // Manually create a localStorage backup with OLD content
    await page.evaluate(() => {
      const noteId = window.location.pathname.split('/').pop() || 'test-note';
      const panelId = 'main';
      const pendingKey = `pending_save_${noteId}_${panelId}`;
      
      const oldContent = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'OLD STALE CONTENT from visibility change' }] }
        ]
      };
      
      localStorage.setItem(pendingKey, JSON.stringify({
        content: oldContent,
        timestamp: Date.now() - 30000, // 30 seconds ago
        noteId,
        panelId
      }));
      
      console.log('Created localStorage backup with OLD content');
    });
    
    // Step 4: Type new content
    console.log('Step 4: Typing NEW content...');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await editor.type('NEW FRESH CONTENT that should be visible');
    await page.waitForTimeout(2000); // Wait for save to complete
    
    // Get content before reload
    const contentBeforeReload = await editor.textContent();
    console.log(`Content before reload: "${contentBeforeReload}"`);
    
    // Step 5: First reload
    console.log('\nStep 5: FIRST RELOAD...');
    await page.reload();
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    
    const editorAfterFirstReload = page.locator('[contenteditable="true"]').first();
    const contentAfterFirstReload = await editorAfterFirstReload.textContent();
    console.log(`Content after first reload: "${contentAfterFirstReload}"`);
    
    // Check localStorage status
    const localStorageStatus1 = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
      return keys.map(k => {
        const data = JSON.parse(localStorage.getItem(k) || '{}');
        return {
          key: k,
          content: data.content?.content?.[0]?.content?.[0]?.text || 'unknown'
        };
      });
    });
    console.log('localStorage after first reload:', localStorageStatus1);
    
    // Step 6: Second reload
    console.log('\nStep 6: SECOND RELOAD...');
    await page.reload();
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    
    const editorAfterSecondReload = page.locator('[contenteditable="true"]').first();
    const contentAfterSecondReload = await editorAfterSecondReload.textContent();
    console.log(`Content after second reload: "${contentAfterSecondReload}"`);
    
    // Check localStorage status
    const localStorageStatus2 = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter(k => k.includes('pending_save'));
      return keys.map(k => {
        const data = JSON.parse(localStorage.getItem(k) || '{}');
        return {
          key: k,
          content: data.content?.content?.[0]?.content?.[0]?.text || 'unknown'
        };
      });
    });
    console.log('localStorage after second reload:', localStorageStatus2);
    
    // Fetch and display debug logs
    console.log('\n=== FETCHING DEBUG LOGS ===');
    const debugLogs = await page.evaluate(async () => {
      const response = await fetch('/api/debug/log');
      const data = await response.json();
      return data.logs?.slice(0, 20).map((log: any) => ({
        time: log.timestamp,
        action: log.action,
        metadata: log.metadata,
        content_preview: log.content_preview?.substring(0, 50)
      }));
    });
    
    console.log('\nDebug logs from database:');
    debugLogs?.forEach((log: any) => {
      if (log.action.includes('LOCALSTORAGE') || log.action.includes('RESTORE')) {
        console.log(`  ${log.time}: ${log.action}`);
        if (log.metadata) {
          console.log(`    Metadata: ${JSON.stringify(log.metadata)}`);
        }
      }
    });
    
    // Analysis
    console.log('\n=== ANALYSIS ===');
    
    if (contentAfterFirstReload?.includes('OLD STALE CONTENT')) {
      console.log('❌ BUG CONFIRMED: First reload showed OLD localStorage content!');
    } else if (contentAfterFirstReload?.includes('NEW FRESH CONTENT')) {
      console.log('✓ First reload showed correct NEW content');
    } else {
      console.log('? First reload showed unexpected content:', contentAfterFirstReload);
    }
    
    if (contentAfterSecondReload?.includes('NEW FRESH CONTENT')) {
      console.log('✓ Second reload showed correct NEW content');
    } else if (contentAfterSecondReload?.includes('OLD STALE CONTENT')) {
      console.log('❌ Second reload still showing OLD content!');
    } else {
      console.log('? Second reload showed unexpected content:', contentAfterSecondReload);
    }
    
    // Assertions
    expect(contentAfterFirstReload).not.toContain('OLD STALE CONTENT');
    expect(contentAfterFirstReload).toContain('NEW FRESH CONTENT');
    expect(contentAfterSecondReload).toContain('NEW FRESH CONTENT');
  });

  test.afterEach(async () => {
    await page.close();
  });
});