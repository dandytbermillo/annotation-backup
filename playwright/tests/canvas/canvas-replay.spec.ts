/**
 * E2E Test: Canvas Replay & Toolbar Ordering
 *
 * Tests the full canvas workspace restoration workflow:
 * - Toolbar ordering persistence across sessions
 * - Panel position snapshot replay
 * - Highlight suppression during hydration
 * - 300ms batched persistence
 * - Feature flag toggle behavior
 *
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md
 */

import { test, expect, Page } from '@playwright/test'

// Helper to wait for workspace ready
async function waitForWorkspaceReady(page: Page) {
  await page.waitForFunction(() => {
    return window.localStorage.getItem('canvas_workspace_ready') === 'true' ||
      document.querySelector('[data-workspace-ready="true"]') !== null
  }, { timeout: 10000 })
}

// Helper to get panel position
async function getPanelPosition(page: Page, noteId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((id) => {
    const panel = document.querySelector(`[data-note-id="${id}"][data-panel-type="main"]`)
    if (!panel) return null

    const transform = window.getComputedStyle(panel).transform
    if (transform === 'none') return null

    const matrix = transform.match(/matrix\(([^)]+)\)/)
    if (!matrix) return null

    const values = matrix[1].split(',').map(parseFloat)
    return { x: values[4], y: values[5] }
  }, noteId)
}

test.describe('Canvas Replay with Toolbar Ordering', () => {
  test.beforeEach(async ({ page, context }) => {
    // Enable feature flag
    await context.addInitScript(() => {
      window.localStorage.setItem('NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY', 'enabled')
    })

    // Clear existing workspace state
    await context.clearCookies()
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.removeItem('canvas_workspace_pending')
      window.localStorage.removeItem('canvas_workspace_position_cache')
    })
  })

  test('should restore toolbar order and panel positions after page reload', async ({ page }) => {
    // Step 1: Open 3 notes and position them
    await page.goto('/')

    // Create and open first note
    await page.click('[data-test="create-note"]')
    await page.fill('[data-test="note-title"]', 'Test Note 1')
    await page.click('[data-test="open-in-canvas"]')

    // Wait for panel to appear
    await page.waitForSelector('[data-note-id][data-panel-type="main"]')
    const note1Id = await page.getAttribute('[data-note-id][data-panel-type="main"]', 'data-note-id')

    // Drag to position (100, 100)
    const panel1 = page.locator(`[data-note-id="${note1Id}"][data-panel-type="main"]`)
    await panel1.dragTo(panel1, {
      targetPosition: { x: 100, y: 100 },
      force: true
    })

    // Wait for batched persist (300ms)
    await page.waitForTimeout(400)

    // Create and open second note
    await page.click('[data-test="create-note"]')
    await page.fill('[data-test="note-title"]', 'Test Note 2')
    await page.click('[data-test="open-in-canvas"]')

    const note2Id = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('[data-note-id][data-panel-type="main"]'))
      return panels[1]?.getAttribute('data-note-id')
    })

    // Drag to position (300, 300)
    const panel2 = page.locator(`[data-note-id="${note2Id}"][data-panel-type="main"]`)
    await panel2.dragTo(panel2, {
      targetPosition: { x: 300, y: 300 },
      force: true
    })

    // Wait for batched persist
    await page.waitForTimeout(400)

    // Verify toolbar order before reload
    const toolbarBefore = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[data-test="toolbar-tab"]'))
      return tabs.map(tab => tab.getAttribute('data-note-id'))
    })

    expect(toolbarBefore).toHaveLength(2)

    // Step 2: Reload page
    await page.reload()
    await waitForWorkspaceReady(page)

    // Step 3: Verify toolbar order persisted
    const toolbarAfter = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[data-test="toolbar-tab"]'))
      return tabs.map(tab => tab.getAttribute('data-note-id'))
    })

    expect(toolbarAfter).toEqual(toolbarBefore)

    // Step 4: Verify panel positions were restored
    const pos1After = await getPanelPosition(page, note1Id!)
    const pos2After = await getPanelPosition(page, note2Id!)

    expect(pos1After).not.toBeNull()
    expect(pos2After).not.toBeNull()

    // Allow 10px tolerance for floating point rounding
    expect(Math.abs(pos1After!.x - 100)).toBeLessThan(10)
    expect(Math.abs(pos1After!.y - 100)).toBeLessThan(10)
    expect(Math.abs(pos2After!.x - 300)).toBeLessThan(10)
    expect(Math.abs(pos2After!.y - 300)).toBeLessThan(10)
  })

  test('should suppress highlight events during workspace hydration', async ({ page }) => {
    // Setup: Create note with existing workspace state
    await page.goto('/')
    await page.click('[data-test="create-note"]')
    await page.fill('[data-test="note-title"]', 'Highlight Test')
    await page.click('[data-test="open-in-canvas"]')

    // Wait for note to open
    await page.waitForSelector('[data-note-id][data-panel-type="main"]')
    const noteId = await page.getAttribute('[data-note-id][data-panel-type="main"]', 'data-note-id')

    // Wait for initial persist
    await page.waitForTimeout(400)

    // Track highlight events
    await page.evaluate(() => {
      ;(window as any).highlightEvents = []
      document.addEventListener('highlight', (e: any) => {
        ;(window as any).highlightEvents.push({
          noteId: e.detail.noteId,
          timestamp: Date.now(),
          isHydrating: e.detail.isHydrating
        })
      })
    })

    // Reload to trigger hydration
    await page.reload()

    // Wait for hydration to complete
    await page.waitForFunction(() => {
      const workspace = (window as any).__CANVAS_WORKSPACE__
      return workspace && workspace.isHydrating === false
    }, { timeout: 5000 })

    // Verify no highlight events were fired during hydration
    const highlightEvents = await page.evaluate(() => (window as any).highlightEvents || [])
    const duringHydration = highlightEvents.filter((e: any) => e.isHydrating === true)

    expect(duringHydration).toHaveLength(0)
  })

  test('should batch multiple position updates with 300ms debounce', async ({ page }) => {
    // Track network requests
    const updateRequests: any[] = []
    page.on('request', request => {
      if (request.url().includes('/api/canvas/workspace/update')) {
        updateRequests.push({
          method: request.method(),
          url: request.url(),
          timestamp: Date.now()
        })
      }
    })

    await page.goto('/')

    // Create and open note
    await page.click('[data-test="create-note"]')
    await page.fill('[data-test="note-title"]', 'Batch Test')
    await page.click('[data-test="open-in-canvas"]')

    // Wait for panel
    await page.waitForSelector('[data-note-id][data-panel-type="main"]')
    const noteId = await page.getAttribute('[data-note-id][data-panel-type="main"]', 'data-note-id')
    const panel = page.locator(`[data-note-id="${noteId}"][data-panel-type="main"]`)

    // Perform 3 quick drags within 300ms window
    updateRequests.length = 0

    await panel.dragTo(panel, { targetPosition: { x: 100, y: 100 }, force: true })
    await page.waitForTimeout(50)

    await panel.dragTo(panel, { targetPosition: { x: 150, y: 150 }, force: true })
    await page.waitForTimeout(50)

    await panel.dragTo(panel, { targetPosition: { x: 200, y: 200 }, force: true })

    // Wait for batch to flush
    await page.waitForTimeout(400)

    // Verify only 1 batched request was sent (not 3)
    const postRequests = updateRequests.filter(r => r.method === 'POST')
    expect(postRequests.length).toBeLessThanOrEqual(1)
  })

  test('should fall back to legacy PATCH when feature flag disabled', async ({ page, context }) => {
    // Disable feature flag
    await context.addInitScript(() => {
      delete process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY
    })

    // Track network requests
    const requests: any[] = []
    page.on('request', request => {
      if (request.url().includes('/api/canvas/workspace')) {
        requests.push({
          method: request.method(),
          url: request.url()
        })
      }
    })

    await page.goto('/')

    // Create and open note
    await page.click('[data-test="create-note"]')
    await page.fill('[data-test="note-title"]', 'Legacy Test')
    await page.click('[data-test="open-in-canvas"]')

    // Wait for panel and move it
    await page.waitForSelector('[data-note-id][data-panel-type="main"]')
    const noteId = await page.getAttribute('[data-note-id][data-panel-type="main"]', 'data-note-id')
    const panel = page.locator(`[data-note-id="${noteId}"][data-panel-type="main"]`)
    await panel.dragTo(panel, { targetPosition: { x: 100, y: 100 }, force: true })

    // Wait for persist
    await page.waitForTimeout(1000)

    // Verify PATCH was used (not POST /update)
    const patchRequests = requests.filter(r =>
      r.method === 'PATCH' && r.url.includes('/api/canvas/workspace') && !r.url.includes('/update')
    )
    const updateRequests = requests.filter(r => r.url.includes('/api/canvas/workspace/update'))

    expect(patchRequests.length).toBeGreaterThan(0)
    expect(updateRequests).toHaveLength(0)
  })
})
