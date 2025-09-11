import { test, expect } from '@playwright/test'

test.describe('Auto-Edit Mode for Empty Notes', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:3001')
    
    // Wait for the app to load
    await page.waitForLoadState('networkidle')
  })

  test('main note window should auto-focus when empty', async ({ page }) => {
    // Open notes explorer if not already open
    const explorerButton = page.locator('button:has-text("Open Notes Explorer")')
    if (await explorerButton.isVisible()) {
      await explorerButton.click()
    }
    
    // Click on a note in the sidebar
    await page.locator('.notes-explorer').first().click()
    
    // Wait for the main panel to load
    await page.waitForSelector('.panel[data-panel-id="main"]', { timeout: 5000 })
    
    // Check if the editor is in edit mode
    const editor = page.locator('.ProseMirror').first()
    await expect(editor).toBeVisible()
    
    // Verify the editor is editable
    const isEditable = await editor.evaluate(el => el.contentEditable)
    expect(isEditable).toBe('true')
    
    // Verify the editor is focused (cursor should be blinking)
    const isFocused = await editor.evaluate(el => document.activeElement === el)
    expect(isFocused).toBe(true)
    
    // Try typing to verify it works
    await editor.type('Test content')
    const content = await editor.textContent()
    expect(content).toContain('Test content')
  })

  test('switching to empty note should auto-focus', async ({ page }) => {
    // Open notes explorer
    const menuButton = page.locator('button[aria-label="Menu"]').or(page.locator('button:has(svg)')).first()
    await menuButton.click()
    
    // Create a new note
    const newNoteButton = page.locator('button:has-text("New Note")').or(page.locator('button[title="Create new note"]'))
    if (await newNoteButton.isVisible()) {
      await newNoteButton.click()
      
      // Wait for the new note to be created
      await page.waitForTimeout(1000)
      
      // The new note should be selected and focused
      const editor = page.locator('.ProseMirror').first()
      await expect(editor).toBeVisible()
      
      // Verify auto-focus
      const isFocused = await editor.evaluate(el => document.activeElement === el)
      expect(isFocused).toBe(true)
      
      // Verify it's in edit mode
      const isEditable = await editor.evaluate(el => el.contentEditable)
      expect(isEditable).toBe('true')
    }
  })

  test('empty annotation panels should auto-focus', async ({ page }) => {
    // First, ensure we have a note loaded
    await page.locator('.notes-explorer').first().click()
    await page.waitForSelector('.panel[data-panel-id="main"]')
    
    // Select some text in the main editor
    const editor = page.locator('.ProseMirror').first()
    await editor.selectText() // This would need to be implemented based on your app
    
    // Click on annotation toolbar button (Note/Explore/Promote)
    const annotationButton = page.locator('button:has-text("Note")').first()
    if (await annotationButton.isVisible()) {
      await annotationButton.click()
      
      // Wait for the annotation panel to appear
      await page.waitForSelector('.panel[data-panel-id*="branch"]', { timeout: 5000 })
      
      // Find the new annotation panel's editor
      const annotationEditor = page.locator('.panel[data-panel-id*="branch"] .ProseMirror').first()
      await expect(annotationEditor).toBeVisible()
      
      // Verify it's auto-focused
      const isFocused = await annotationEditor.evaluate(el => document.activeElement === el)
      expect(isFocused).toBe(true)
      
      // Verify it's editable
      const isEditable = await annotationEditor.evaluate(el => el.contentEditable)
      expect(isEditable).toBe('true')
    }
  })

  test('multiple focus attempts should ensure cursor appears', async ({ page }) => {
    // This test verifies that our multiple focus attempts work
    await page.locator('.notes-explorer').first().click()
    await page.waitForSelector('.panel[data-panel-id="main"]')
    
    const editor = page.locator('.ProseMirror').first()
    
    // Wait for multiple focus attempts (we try at 100ms, 300ms, 500ms, 800ms)
    await page.waitForTimeout(1000)
    
    // After all attempts, editor should be focused
    const isFocused = await editor.evaluate(el => document.activeElement === el)
    expect(isFocused).toBe(true)
    
    // Cursor should be visible (check for caret-color style)
    const caretColor = await editor.evaluate(el => {
      const styles = window.getComputedStyle(el)
      return styles.caretColor
    })
    expect(caretColor).not.toBe('transparent')
  })
})

// Helper test to verify console logs (for debugging)
test.describe('Debug Auto-Focus Logs', () => {
  test('should log auto-focus attempts', async ({ page }) => {
    const consoleLogs: string[] = []
    
    // Capture console logs
    page.on('console', msg => {
      if (msg.text().includes('[CanvasPanel]')) {
        consoleLogs.push(msg.text())
      }
    })
    
    await page.goto('http://localhost:3001')
    await page.waitForLoadState('networkidle')
    
    // Click on a note
    await page.locator('.notes-explorer').first().click()
    await page.waitForTimeout(1000)
    
    // Verify we got the expected logs
    const focusLogs = consoleLogs.filter(log => log.includes('Auto-focusing'))
    expect(focusLogs.length).toBeGreaterThan(0)
    
    // Should have main panel focus logs
    const mainPanelLogs = consoleLogs.filter(log => log.includes('main'))
    expect(mainPanelLogs.length).toBeGreaterThan(0)
  })
})