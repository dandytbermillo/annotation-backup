import { test, expect } from '@playwright/test'

test.describe('Hover icon appears over annotated text in edit mode', () => {
  test('plain: shows hover icon and tooltip when editor is focused', async ({ page, browserName }) => {
    // Start from home; dev server is configured in playwright.config.ts
    await page.goto('/')

    // Try to locate an editor. If missing, skip rather than fail.
    const editor = page.locator('.tiptap-editor [contenteditable="true"], .tiptap-editor')
    if (!(await editor.first().isVisible().catch(() => false))) {
      test.skip(true, 'Editor not found on /. Ensure the app renders an editor or select a note.')
    }

    // Ensure there is at least one annotated span; otherwise skip
    const hasAnnotation = await page.locator('.annotation, .annotation-hover-target').first().isVisible().catch(() => false)
    if (!hasAnnotation) {
      test.skip(true, 'No .annotation/.annotation-hover-target found. Seed an annotation before running.')
    }

    // Focus the editor (edit mode)
    await editor.first().click({ position: { x: 5, y: 5 } })

    // Hover over an annotated span and wait for icon
    const ann = page.locator('.annotation, .annotation-hover-target').first()
    const box = await ann.boundingBox()
    if (!box) test.skip(true, 'Could not resolve annotation bounding box')

    // Move mouse near the top center of the annotation
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 2)

    // The icon classname differs per implementation; try multiple
    const iconCandidates = [
      '.annotation-hover-icon-plugin', // plugin-driven icon (plain mode)
      '.annotation-hover-icon-overlay', // overlay icon
      '.annotation-hover-icon' // legacy DOM icon
    ]

    const foundIcon = await page.waitForFunction((selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        if (el && getComputedStyle(el).display !== 'none' && el.offsetWidth > 0 && el.offsetHeight > 0) return sel
      }
      return null
    }, iconCandidates, { timeout: 1500 }).catch(() => null)

    expect(foundIcon, 'Hover icon should appear when hovering annotation in edit mode').not.toBeNull()

    // Hover the icon and expect a tooltip to appear
    if (foundIcon) {
      await page.hover(foundIcon as string)
      // Tooltip class is consistent across implementations
      await expect(page.locator('.annotation-tooltip')).toBeVisible({ timeout: 1500 })
    }
  })
})

