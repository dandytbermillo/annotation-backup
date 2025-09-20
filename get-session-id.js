const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate to the app
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  
  // Get the session ID from localStorage
  const sessionId = await page.evaluate(() => {
    return window.localStorage.getItem('debug-logger-session-id');
  });
  
  console.log('Session ID:', sessionId);
  
  await browser.close();
})();
