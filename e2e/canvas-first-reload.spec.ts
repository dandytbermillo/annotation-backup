import { test, expect, Page } from '@playwright/test'

async function ensurePlainMode(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('collab-mode', 'plain')
    } catch {
      // ignore – localStorage might not be available yet
    }
  })
}

async function openFloatingToolbar(page: Page) {
  const canvas = page.locator('#canvas-container')
  await expect(canvas).toBeVisible({ timeout: 10000 })

  const box = await canvas.boundingBox()
  if (!box) {
    throw new Error('Canvas bounding box unavailable')
  }

  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2

  await page.mouse.click(centerX, centerY, { button: 'right' })
  await expect(page.getByRole('button', { name: /\+ Note/i })).toBeVisible({ timeout: 5000 })
}

async function ensureNotesLayer(page: Page) {
  let layerToggle = page.locator('button[title^="Toggle layer"]').first()
  if ((await layerToggle.count()) === 0 || !(await layerToggle.isVisible())) {
    await openFloatingToolbar(page)
    layerToggle = page.locator('button[title^="Toggle layer"]').first()
    await expect(layerToggle).toBeVisible({ timeout: 5000 })
  }

  const title = await layerToggle.getAttribute('title')
  if (title?.includes('Current: popups')) {
    await layerToggle.click()
    await expect(layerToggle).toHaveAttribute('title', /Current: notes/)
  }

  // Close the toolbar if it was opened
  await page.keyboard.press('Escape').catch(() => {})
}

const makeMainStoreKey = (noteId: string) => `${noteId}::main`

async function createNewNote(page: Page) {
  const awaitNoteCreation = () =>
    page.waitForResponse((response) =>
      response.url().includes('/api/items') && response.request().method() === 'POST'
    )

  await openFloatingToolbar(page)

  const createResponse = awaitNoteCreation()
  await page.getByRole('button', { name: /\+ Note/i }).click()
  const response = await createResponse

  let noteId: string | null = null
  try {
    const payload = await response.json()
    noteId = payload?.item?.id ?? null
  } catch {
    // ignore JSON parse errors; we'll assert noteId below
  }

  await ensureNotesLayer(page)
  await expect(page.locator('[data-panel-id="main"]')).toBeVisible({ timeout: 10000 })

  if (!noteId || typeof noteId !== 'string') {
    throw new Error('Failed to determine newly created note ID from /api/items response')
  }

  return noteId
}

async function getViewportSize(page: Page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
}

async function getMainPanelRect(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-panel-id="main"]') as HTMLElement | null
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  })
}

async function waitForCanvasDataStore(page: Page, storeKey: string) {
  await page.waitForFunction(
    (key) => {
      const ds = (window as any).canvasDataStore
      if (!ds?.get) return false
      const entry = ds.get(key)
      return !!entry
    },
    storeKey,
    { timeout: 10000 }
  )
}

async function getMainWorldPosition(page: Page, storeKey: string) {
  return page.evaluate((key) => {
    const ds = (window as any).canvasDataStore
    if (!ds?.get) return null
    const entry = ds.get(key)
    if (!entry) return null
    return {
      worldPosition: entry.worldPosition ?? null,
      position: entry.position ?? null,
    }
  }, storeKey)
}

async function dragMainPanel(page: Page, deltaX: number, deltaY: number) {
  const header = page.locator('[data-panel-id="main"] .panel-header').first()
  await expect(header).toBeVisible({ timeout: 5000 })
  const box = await header.boundingBox()
  if (!box) throw new Error('Main panel header bounding box not available')

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 20 })
  await page.mouse.up()
}

test.describe('Canvas workspace first-reload behaviour', () => {
  test('fresh note stays centered on first reload without dragging', async ({ page }) => {
    await ensurePlainMode(page)
    await page.goto('/')
    const noteId = await createNewNote(page)
    const storeKey = makeMainStoreKey(noteId)

    await waitForCanvasDataStore(page, storeKey)

    await page.reload()
    await ensureNotesLayer(page)
    await expect(page.locator('[data-panel-id="main"]')).toBeVisible({ timeout: 10000 })
    await waitForCanvasDataStore(page, storeKey)

    const rect = await getMainPanelRect(page)
    expect(rect).toBeTruthy()

    const viewport = await getViewportSize(page)
    const tolerance = 24
    expect(rect!.x).toBeGreaterThanOrEqual(-tolerance)
    expect(rect!.y).toBeGreaterThanOrEqual(-tolerance)
    expect(rect!.right).toBeLessThanOrEqual(viewport.width + tolerance)
    expect(rect!.bottom).toBeLessThanOrEqual(viewport.height + tolerance)
  })

  test('dragged main panel persists position across immediate reload', async ({ page }) => {
    await ensurePlainMode(page)
    await page.goto('/')
    const noteId = await createNewNote(page)

    const storeKey = makeMainStoreKey(noteId)
    await waitForCanvasDataStore(page, storeKey)

    const initial = await getMainWorldPosition(page, storeKey)

    await dragMainPanel(page, 280, 180)

    await page.waitForFunction(
      (key, previous) => {
        const ds = (window as any).canvasDataStore
        if (!ds?.get) return false
        const entry = ds.get(key)
        if (!entry) return false

        const world = entry.worldPosition || entry.position
        if (!world) return false

        const prevWorld = previous?.worldPosition || previous?.position
        if (!prevWorld) return true

        const dx = Math.abs(world.x - prevWorld.x)
        const dy = Math.abs(world.y - prevWorld.y)
        return Math.hypot(dx, dy) > 5
      },
      storeKey,
      initial,
      { timeout: 10000 }
    )

    const beforeReload = await getMainWorldPosition(page, storeKey)
    const beforePosition = beforeReload?.worldPosition ?? beforeReload?.position
    expect(beforePosition).toBeTruthy()

    await page.reload()
    await ensureNotesLayer(page)
    await waitForCanvasDataStore(page, storeKey)

    const afterReload = await getMainWorldPosition(page, storeKey)
    const afterPosition = afterReload?.worldPosition ?? afterReload?.position
    expect(afterPosition).toBeTruthy()

    const tolerance = 2
    expect(Math.abs(afterPosition!.x - beforePosition!.x)).toBeLessThan(tolerance)
    expect(Math.abs(afterPosition!.y - beforePosition!.y)).toBeLessThan(tolerance)

    const rect = await getMainPanelRect(page)
    expect(rect).toBeTruthy()

    const viewport = await getViewportSize(page)
    expect(rect!.x).toBeGreaterThan(-50)
    expect(rect!.y).toBeGreaterThan(-50)
    expect(rect!.right).toBeLessThan(viewport.width + 50)
    expect(rect!.bottom).toBeLessThan(viewport.height + 50)
  })
})
