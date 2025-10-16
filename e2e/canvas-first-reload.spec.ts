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

async function openNotesExplorer(page: Page) {
  const openExplorerButton = page.getByRole('button', { name: /Open Notes Explorer/i })
  if (await openExplorerButton.isVisible()) {
    await openExplorerButton.click()
  }
  await expect(page.getByRole('button', { name: /Create New Note/i })).toBeVisible()
}

async function createNewNote(page: Page) {
  await openNotesExplorer(page)

  const createResponse = page.waitForResponse((response) =>
    response.url().includes('/api/postgres-offline/notes') && response.request().method() === 'POST'
  )

  await page.getByRole('button', { name: /Create New Note/i }).click()
  const response = await createResponse
  const payload = await response.json()

  const noteTitle: string = payload.title

  // Wait for the note item to appear and select it to open the canvas
  const noteListItem = page.getByText(noteTitle, { exact: true }).first()
  await noteListItem.waitFor()
  await noteListItem.click()

  await page.waitForURL('**/notes/**', { timeout: 10000 })
  await expect(page.locator('[data-panel-id="main"]')).toBeVisible({ timeout: 10000 })
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

async function getMainStoreKey(page: Page) {
  return page.evaluate(() => {
    const path = window.location.pathname || ''
    const marker = '/notes/'
    const idx = path.indexOf(marker)
    if (idx === -1) return null
    const slug = path.slice(idx + marker.length).split(/[/?#]/)[0]
    if (!slug) return null
    return `${slug}::main`
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
  const panel = page.locator('[data-panel-id="main"]').first()
  const box = await panel.boundingBox()
  if (!box) throw new Error('Main panel bounding box not available')

  const startX = box.x + box.width / 2
  const startY = box.y + 24 // near header to avoid inner content interference

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 15 })
  await page.mouse.up()
}

test.describe('Canvas workspace first-reload behaviour', () => {
  test('fresh note stays centered on first reload without dragging', async ({ page }) => {
    await ensurePlainMode(page)
    await page.goto('/')
    await createNewNote(page)

    await waitForCanvasDataStore(page, (await getMainStoreKey(page))!)

    await page.reload()
    await page.waitForURL('**/notes/**', { timeout: 10000 })
    await expect(page.locator('[data-panel-id="main"]')).toBeVisible({ timeout: 10000 })
    await waitForCanvasDataStore(page, (await getMainStoreKey(page))!)

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
    await createNewNote(page)

    const storeKey = await getMainStoreKey(page)
    expect(storeKey).toBeTruthy()
    await waitForCanvasDataStore(page, storeKey!)

    const initial = await getMainWorldPosition(page, storeKey!)

    await dragMainPanel(page, 280, 180)

    await page.waitForFunction(
      (key, previous) => {
        const ds = (window as any).canvasDataStore
        if (!ds?.get) return false
        const entry = ds.get(key)
        if (!entry?.worldPosition) return false
        if (!previous?.worldPosition) return true
        const dx = Math.abs(entry.worldPosition.x - previous.worldPosition.x)
        const dy = Math.abs(entry.worldPosition.y - previous.worldPosition.y)
        return dx > 5 || dy > 5
      },
      storeKey!,
      initial,
      { timeout: 10000 }
    )

    const beforeReload = await getMainWorldPosition(page, storeKey!)
    expect(beforeReload?.worldPosition).toBeTruthy()

    await page.reload()
    await page.waitForURL('**/notes/**', { timeout: 10000 })
    await waitForCanvasDataStore(page, storeKey!)

    const afterReload = await getMainWorldPosition(page, storeKey!)
    expect(afterReload?.worldPosition).toBeTruthy()

    const tolerance = 2
    expect(Math.abs(afterReload!.worldPosition!.x - beforeReload!.worldPosition!.x)).toBeLessThan(tolerance)
    expect(Math.abs(afterReload!.worldPosition!.y - beforeReload!.worldPosition!.y)).toBeLessThan(tolerance)

    const rect = await getMainPanelRect(page)
    expect(rect).toBeTruthy()

    const viewport = await getViewportSize(page)
    expect(rect!.x).toBeGreaterThan(-50)
    expect(rect!.y).toBeGreaterThan(-50)
    expect(rect!.right).toBeLessThan(viewport.width + 50)
    expect(rect!.bottom).toBeLessThan(viewport.height + 50)
  })
})
