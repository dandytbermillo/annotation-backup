const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate to the app
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  
  // Try to trigger some activity that might create a session
  try {
    // Check if we need to open notes explorer
    const openNotesBtn = page.locator('button:has-text("Open Notes Explorer")');
    if (await openNotesBtn.count() > 0) {
      await openNotesBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    // Ignore if button not found
  }
  
  // Get the session ID from localStorage
  const sessionData = await page.evaluate(() => {
    const sessionId = window.localStorage.getItem('debug-logger-session-id');
    const allKeys = Object.keys(window.localStorage);
    return {
      sessionId,
      hasDebugKeys: allKeys.filter(k => k.includes('debug')),
      hasPendingSaves: allKeys.filter(k => k.includes('pending_save'))
    };
  });
  
  console.log('Session ID:', sessionData.sessionId);
  console.log('Debug-related keys:', sessionData.hasDebugKeys);
  console.log('Pending save keys:', sessionData.hasPendingSaves);
  
  await browser.close();
})();
