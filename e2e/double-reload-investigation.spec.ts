import { test, expect } from '@playwright/test';

// Test configuration to capture all console logs
test.use({
  // Extend timeout for thorough testing
  timeout: 60000,
});

test.describe('Double Reload Investigation', () => {
  test('investigate why it takes two reloads to see changes', async ({ page, context }) => {
    // Enable console log capture
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(text);
      console.log(text);
    });

    // Track localStorage changes
    const getLocalStorageState = async () => {
      return await page.evaluate(() => {
        const state: Record<string, any> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.includes('pending_save')) {
            const value = localStorage.getItem(key);
            try {
              state[key] = JSON.parse(value || '');
            } catch {
              state[key] = value;
            }
          }
        }
        return state;
      });
    };

    // Helper to get editor content
    const getEditorContent = async () => {
      return await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        if (!editor) return null;
        const text = editor?.textContent || '';
        return text.trim();
      });
    };

    // Helper to wait for autosave
    const waitForAutosave = async () => {
      // Wait for debounce timer (300ms) plus processing time
      await page.waitForTimeout(500);
      
      // Wait for any pending saves to complete
      await page.waitForFunction(() => {
        const saves = (window as any).__debouncedSave;
        return !saves || saves.size === 0;
      }, { timeout: 5000 }).catch(() => {
        console.log('Warning: Debounced saves might still be pending');
      });
    };

    console.log('\n=== STARTING DOUBLE RELOAD INVESTIGATION ===\n');

    // Step 1: Navigate to the app
    console.log('Step 1: Navigating to application...');
    await page.goto('http://localhost:3000');
    
    // Wait for the welcome screen to load
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    
    // Open the notes explorer first
    console.log('Opening notes explorer...');
    await page.click('button:has-text("Open Notes Explorer")');
    
    // Wait for sidebar to open
    await page.waitForTimeout(1000); // Let sidebar animation complete
    
    // Double-click on the existing note "testing-11.md" to open it
    console.log('Opening existing note: testing-11.md');
    await page.dblclick('text=testing-11.md');
    
    // Wait for the editor to load
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    console.log('Editor loaded successfully');
    
    // Wait for initial load to complete
    await page.waitForTimeout(2000);

    // Step 2: Create initial content
    const timestamp = Date.now();
    const initialContent = `Initial content ${timestamp}`;
    console.log(`Step 2: Setting initial content: "${initialContent}"`);
    
    // Focus editor and clear existing content
    await page.click('[contenteditable="true"]');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    
    // Type initial content
    await page.keyboard.type(initialContent);
    
    // Wait for autosave
    console.log('Waiting for initial save...');
    await waitForAutosave();
    
    // Check localStorage state after initial save
    const localStorageAfterInitial = await getLocalStorageState();
    console.log('localStorage after initial save:', JSON.stringify(localStorageAfterInitial, null, 2));
    
    // Verify initial content is displayed
    const displayedInitial = await getEditorContent();
    console.log(`Initial content displayed: "${displayedInitial}"`);
    expect(displayedInitial).toBe(initialContent);

    // Step 3: Edit the content
    const editedContent = `Edited content ${timestamp}`;
    console.log(`\nStep 3: Editing content to: "${editedContent}"`);
    
    // Clear and type new content
    await page.click('[contenteditable="true"]');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(editedContent);
    
    // Wait for autosave
    console.log('Waiting for edit save...');
    await waitForAutosave();
    
    // Check localStorage state after edit
    const localStorageAfterEdit = await getLocalStorageState();
    console.log('localStorage after edit:', JSON.stringify(localStorageAfterEdit, null, 2));
    
    // Verify edited content is displayed
    const displayedAfterEdit = await getEditorContent();
    console.log(`Content after edit: "${displayedAfterEdit}"`);
    expect(displayedAfterEdit).toBe(editedContent);

    // Clear console logs before reload
    consoleLogs.length = 0;

    // Step 4: First reload
    console.log('\n=== FIRST RELOAD ===');
    console.log('localStorage before reload:', JSON.stringify(await getLocalStorageState(), null, 2));
    
    await page.reload();
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000); // Wait for content to load
    
    // Check what content is displayed after first reload
    const contentAfterFirstReload = await getEditorContent();
    console.log(`Content after FIRST reload: "${contentAfterFirstReload}"`);
    
    // Check localStorage state after first reload
    const localStorageAfterFirstReload = await getLocalStorageState();
    console.log('localStorage after first reload:', JSON.stringify(localStorageAfterFirstReload, null, 2));
    
    // Capture relevant console logs
    const relevantLogs1 = consoleLogs.filter(log => 
      log.includes('PlainOfflineProvider') || 
      log.includes('TiptapEditorPlain') ||
      log.includes('LOCALSTORAGE') ||
      log.includes('Restoring') ||
      log.includes('Discarding')
    );
    console.log('\nRelevant logs from first reload:');
    relevantLogs1.forEach(log => console.log(log));
    
    // Clear console logs before second reload
    consoleLogs.length = 0;

    // Step 5: Second reload
    console.log('\n=== SECOND RELOAD ===');
    console.log('localStorage before second reload:', JSON.stringify(await getLocalStorageState(), null, 2));
    
    await page.reload();
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000); // Wait for content to load
    
    // Check what content is displayed after second reload
    const contentAfterSecondReload = await getEditorContent();
    console.log(`Content after SECOND reload: "${contentAfterSecondReload}"`);
    
    // Check localStorage state after second reload
    const localStorageAfterSecondReload = await getLocalStorageState();
    console.log('localStorage after second reload:', JSON.stringify(localStorageAfterSecondReload, null, 2));
    
    // Capture relevant console logs
    const relevantLogs2 = consoleLogs.filter(log => 
      log.includes('PlainOfflineProvider') || 
      log.includes('TiptapEditorPlain') ||
      log.includes('LOCALSTORAGE') ||
      log.includes('Restoring') ||
      log.includes('Discarding')
    );
    console.log('\nRelevant logs from second reload:');
    relevantLogs2.forEach(log => console.log(log));

    // Step 6: Analysis
    console.log('\n=== ANALYSIS ===');
    console.log(`Expected content: "${editedContent}"`);
    console.log(`After first reload: "${contentAfterFirstReload}"`);
    console.log(`After second reload: "${contentAfterSecondReload}"`);
    
    if (contentAfterFirstReload !== editedContent) {
      console.log('❌ BUG CONFIRMED: First reload shows incorrect content!');
      if (contentAfterFirstReload === initialContent) {
        console.log('   First reload is showing the INITIAL content instead of edited content');
      } else {
        console.log('   First reload is showing unexpected content');
      }
    } else {
      console.log('✅ First reload shows correct content');
    }
    
    if (contentAfterSecondReload === editedContent) {
      console.log('✅ Second reload shows correct content');
    } else {
      console.log('❌ Second reload still shows incorrect content!');
    }
    
    // Final assertions
    expect(contentAfterSecondReload).toBe(editedContent);
  });

  test('test with tab switching to create stale localStorage', async ({ page }) => {
    console.log('\n=== TESTING WITH TAB SWITCH ===\n');
    
    // Enable console log capture
    page.on('console', msg => {
      console.log(`[${msg.type()}] ${msg.text()}`);
    });

    const getEditorContent = async () => {
      return await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        return editor?.textContent?.trim() || '';
      });
    };

    // Navigate to app
    await page.goto('http://localhost:3000');
    
    // Wait for the welcome screen to load
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    
    // Open the notes explorer first  
    console.log('Opening notes explorer...');
    await page.click('button:has-text("Open Notes Explorer")');
    
    // Wait for sidebar to open
    await page.waitForTimeout(1000); // Let sidebar animation complete
    
    // Double-click on the existing note "testing-11.md" to open it
    console.log('Opening existing note: testing-11.md');
    await page.dblclick('text=testing-11.md');
    
    // Wait for editor to load
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    console.log('Editor loaded successfully');
    await page.waitForTimeout(2000);

    // Create initial content
    const timestamp = Date.now();
    const content1 = `First edit ${timestamp}`;
    
    await page.click('[contenteditable="true"]');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(content1);
    await page.waitForTimeout(500); // Wait for debounced save
    
    console.log(`Set content: "${content1}"`);

    // Simulate tab switch (triggers visibility change)
    console.log('Simulating tab switch (visibility change)...');
    await page.evaluate(() => {
      // Dispatch visibility change event
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    await page.waitForTimeout(100);
    
    // Return from tab switch
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    console.log('Tab switch complete, localStorage backup created');

    // Make another edit
    const content2 = `Second edit ${timestamp}`;
    await page.click('[contenteditable="true"]');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(content2);
    await page.waitForTimeout(500);
    
    console.log(`Updated content to: "${content2}"`);

    // Check localStorage
    const localStorageState = await page.evaluate(() => {
      const state: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('pending_save')) {
          try {
            const value = JSON.parse(localStorage.getItem(key) || '');
            // Extract just the text content for readability
            if (value.content && typeof value.content === 'object') {
              const text = JSON.stringify(value.content).match(/"text":"([^"]+)"/)?.[1] || 'unknown';
              state[key] = { ...value, contentPreview: text };
            } else {
              state[key] = value;
            }
          } catch {
            state[key] = localStorage.getItem(key);
          }
        }
      }
      return state;
    });
    
    console.log('localStorage state before reload:', JSON.stringify(localStorageState, null, 2));

    // First reload
    console.log('\n=== FIRST RELOAD ===');
    await page.reload();
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
    
    const afterFirstReload = await getEditorContent();
    console.log(`After first reload: "${afterFirstReload}"`);

    // Second reload
    console.log('\n=== SECOND RELOAD ===');
    await page.reload();
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
    
    const afterSecondReload = await getEditorContent();
    console.log(`After second reload: "${afterSecondReload}"`);

    // Analysis
    console.log('\n=== ANALYSIS ===');
    console.log(`Expected: "${content2}"`);
    console.log(`First reload showed: "${afterFirstReload}"`);
    console.log(`Second reload showed: "${afterSecondReload}"`);
    
    if (afterFirstReload !== content2 && afterSecondReload === content2) {
      console.log('❌ BUG CONFIRMED: Tab switch created stale localStorage that interfered with first reload!');
    }
  });
});