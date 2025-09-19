import { test, expect } from '@playwright/test';

test('realistic double reload investigation', async ({ page }) => {
  console.log('\n=== REALISTIC DOUBLE RELOAD INVESTIGATION ===');
  console.log('Simulating real user behavior: edit, save, reload, reopen note...\n');
  
  // Helper to open the note
  const openTestingNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000); // Let content load
  };
  
  // Track important logs
  const importantLogs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LOCALSTORAGE') || 
        text.includes('localStorage') ||
        text.includes('Restoring') ||
        text.includes('pending_save') ||
        text.includes('RESTORE') ||
        text.includes('DISCARD')) {
      importantLogs.push(text);
      console.log(`[LOG] ${text.substring(0, 150)}`);
    }
  });
  
  // Step 1: Open note and set baseline
  console.log('STEP 1: Opening note and setting baseline...');
  await page.goto('http://localhost:3000');
  await openTestingNote();
  
  const editor = page.locator('[contenteditable="true"]').first();
  const timestamp = Date.now();
  const baseline = `BASELINE_${timestamp}`;
  
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(baseline);
  await page.waitForTimeout(1000); // Wait for autosave
  
  let content = await editor.textContent();
  console.log(`Baseline set: "${content}"`);
  
  // Step 2: Make an edit
  console.log('\nSTEP 2: Making an edit...');
  const edited = `EDITED_${timestamp}`;
  await editor.click({ clickCount: 3 });
  await page.keyboard.type(edited);
  await page.waitForTimeout(1000); // Wait for autosave
  
  content = await editor.textContent();
  console.log(`After edit: "${content}"`);
  
  // Check localStorage before reload
  const checkLocalStorage = async () => {
    return await page.evaluate(() => {
      const pendingSaves: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('pending_save')) {
          pendingSaves.push(key);
        }
      }
      return pendingSaves;
    });
  };
  
  let pendingKeys = await checkLocalStorage();
  console.log(`\nLocalStorage pending_save keys before reload: ${pendingKeys.length}`);
  pendingKeys.forEach(key => console.log(`  - ${key}`));
  
  // Step 3: FIRST RELOAD and reopen
  console.log('\n=== FIRST RELOAD ===');
  importantLogs.length = 0;
  
  await page.reload();
  console.log('Page reloaded, reopening note...');
  await openTestingNote();
  
  const contentAfterFirstReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\nContent after FIRST reload: "${contentAfterFirstReload}"`);
  
  // Check if localStorage was used
  const restoredFromLocalStorage = importantLogs.some(log => 
    log.includes('Restoring') || log.includes('RESTORE')
  );
  console.log(`Was content restored from localStorage? ${restoredFromLocalStorage}`);
  
  pendingKeys = await checkLocalStorage();
  console.log(`LocalStorage pending_save keys after first reload: ${pendingKeys.length}`);
  
  // Step 4: SECOND RELOAD and reopen
  console.log('\n=== SECOND RELOAD ===');
  importantLogs.length = 0;
  
  await page.reload();
  console.log('Page reloaded, reopening note...');
  await openTestingNote();
  
  const contentAfterSecondReload = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`\nContent after SECOND reload: "${contentAfterSecondReload}"`);
  
  const restoredFromLocalStorageSecond = importantLogs.some(log => 
    log.includes('Restoring') || log.includes('RESTORE')
  );
  console.log(`Was content restored from localStorage? ${restoredFromLocalStorageSecond}`);
  
  pendingKeys = await checkLocalStorage();
  console.log(`LocalStorage pending_save keys after second reload: ${pendingKeys.length}`);
  
  // Step 5: Analysis
  console.log('\n=== ANALYSIS ===');
  console.log(`Expected: "${edited}"`);
  console.log(`1st reload: "${contentAfterFirstReload}"`);
  console.log(`2nd reload: "${contentAfterSecondReload}"`);
  
  if (contentAfterFirstReload !== edited && contentAfterSecondReload === edited) {
    console.log('\n🔴 DOUBLE RELOAD BUG CONFIRMED!');
    console.log('  - First reload shows wrong content');
    console.log('  - Second reload shows correct content');
    console.log('\nLikely cause: localStorage restoration on first reload');
  } else if (contentAfterFirstReload === edited && contentAfterSecondReload === edited) {
    console.log('\n✅ NO BUG: Both reloads show correct edited content');
  } else if (contentAfterFirstReload === baseline) {
    console.log('\n⚠️ First reload shows BASELINE (edit not saved?)');
  } else {
    console.log('\n⚠️ Unexpected behavior detected');
  }
});

test('focused localStorage investigation', async ({ page }) => {
  console.log('\n=== FOCUSED LOCALSTORAGE INVESTIGATION ===');
  console.log('Specifically tracking localStorage save and restore behavior...\n');
  
  // Enhanced logging for localStorage
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LOCALSTORAGE_BACKUP') ||
        text.includes('LOCALSTORAGE_CHECK') ||
        text.includes('LOCALSTORAGE_RESTORE') ||
        text.includes('pending_save')) {
      console.log(`[${msg.type()}] ${text}`);
    }
  });
  
  // Helper
  const openNote = async () => {
    await page.waitForSelector('button:has-text("Open Notes Explorer")', { timeout: 10000 });
    await page.click('button:has-text("Open Notes Explorer")');
    await page.waitForTimeout(1000);
    await page.dblclick('text=testing-11.md');
    await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  };
  
  // Detailed localStorage inspection
  const inspectLocalStorage = async (label: string) => {
    const data = await page.evaluate(() => {
      const result: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('pending_save')) {
          try {
            const value = localStorage.getItem(key);
            const parsed = JSON.parse(value || '{}');
            result[key] = {
              content: parsed.content ? 'has content' : 'no content',
              timestamp: parsed.timestamp,
              version: parsed.version
            };
          } catch {
            result[key] = 'parse error';
          }
        }
      }
      return result;
    });
    
    console.log(`\n${label}:`);
    if (Object.keys(data).length === 0) {
      console.log('  No pending_save entries in localStorage');
    } else {
      Object.entries(data).forEach(([key, value]) => {
        console.log(`  ${key}:`, value);
      });
    }
  };
  
  // Start test
  await page.goto('http://localhost:3000');
  await openNote();
  
  // Clean slate
  console.log('Setting clean content...');
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click({ clickCount: 3 });
  const timestamp = Date.now();
  await page.keyboard.type(`CLEAN_${timestamp}`);
  await page.waitForTimeout(1000);
  
  await inspectLocalStorage('After setting clean content');
  
  // Make edit
  console.log('\nMaking edit...');
  await editor.click({ clickCount: 3 });
  const editContent = `EDIT_${timestamp}`;
  await page.keyboard.type(editContent);
  await page.waitForTimeout(1000);
  
  await inspectLocalStorage('After edit');
  
  // Trigger localStorage backup by simulating page hide
  console.log('\nSimulating page visibility change (triggers localStorage backup)...');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('beforeunload'));
  });
  await page.waitForTimeout(500);
  
  await inspectLocalStorage('After visibility change events');
  
  // First reload
  console.log('\n=== FIRST RELOAD ===');
  await page.reload();
  await inspectLocalStorage('Immediately after first reload');
  
  await openNote();
  const firstContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${firstContent}"`);
  
  await inspectLocalStorage('After opening note (first reload)');
  
  // Second reload
  console.log('\n=== SECOND RELOAD ===');
  await page.reload();
  await inspectLocalStorage('Immediately after second reload');
  
  await openNote();
  const secondContent = await page.locator('[contenteditable="true"]').first().textContent();
  console.log(`Content: "${secondContent}"`);
  
  await inspectLocalStorage('After opening note (second reload)');
  
  // Final analysis
  console.log('\n=== LOCALSTORAGE ANALYSIS ===');
  console.log(`Expected content: "${editContent}"`);
  console.log(`First reload: "${firstContent}"`);
  console.log(`Second reload: "${secondContent}"`);
  
  if (firstContent !== editContent && secondContent === editContent) {
    console.log('\nConclusion: localStorage interference on first reload!');
  }
});