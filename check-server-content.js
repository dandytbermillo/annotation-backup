const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Navigate to the app
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
  
  // Try to open notes explorer and get a note
  try {
    const openNotesBtn = page.locator('button:has-text("Open Notes Explorer")');
    if (await openNotesBtn.count() > 0) {
      await openNotesBtn.click();
      await page.waitForTimeout(1500);
    }
    
    // Try to open an existing note
    const noteItem = page.locator('text="testing-11.md"').first();
    if (await noteItem.count() > 0) {
      await noteItem.dblclick();
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.log('Could not open note:', e.message);
  }
  
  // Get the current URL to extract noteId
  const url = page.url();
  console.log('Current URL:', url);
  
  // Extract noteId from URL if present
  let noteId = 'testing-11'; // default
  if (url.includes('/notes/')) {
    noteId = url.split('/notes/')[1]?.split('?')[0] || noteId;
  }
  console.log('Note ID:', noteId);
  
  // Fetch the server content
  const serverContent = await page.evaluate(async (noteId) => {
    try {
      const response = await fetch(`/api/postgres-offline/documents/${noteId}/main`);
      const json = await response.json();
      return {
        success: true,
        content: json.content,
        version: json.version
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }, noteId);
  
  console.log('serverContent:', JSON.stringify(serverContent, null, 2));
  
  await browser.close();
})();
