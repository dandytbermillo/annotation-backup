import { test, expect } from '@playwright/test'

const TEST_NOTE_ID = 'multi-layer-test-note'
const TEST_NOTE_TITLE = 'Test Multi-layer'
const FOLDER_TITLE = 'Research Folder'

const NOTE_DATA = {
  main: {
    title: TEST_NOTE_TITLE,
    type: 'main',
    content: '<p>Root content for multi-layer test.</p>',
    branches: ['research-folder'],
    position: { x: 1200, y: 900 },
    isEditable: false,
  },
  'research-folder': {
    title: FOLDER_TITLE,
    type: 'folder',
    parentId: 'main',
    position: { x: 1600, y: 1100 },
    isEditable: false,
    branches: [],
    // Provide children metadata so popups render meaningful content
    children: [
      {
        id: 'child-note',
        name: 'Child Node',
        type: 'note',
        parentId: 'research-folder',
        path: '/Research Folder/Child Node',
        icon: null,
        color: null,
        hasChildren: false,
      },
    ],
  },
  'child-note': {
    title: 'Child Node',
    type: 'note',
    parentId: 'research-folder',
    position: { x: 1900, y: 1350 },
    isEditable: true,
    originalText: 'child node highlight',
    content: '<p>Nested note content for popup testing.</p>',
    branches: [],
  },
}

// Helper to seed localStorage before the app loads
function seedLocalStorage({
  noteId,
  noteTitle,
  noteData,
}: {
  noteId: string
  noteTitle: string
  noteData: Record<string, unknown>
}) {
  const now = new Date().toISOString()
  const notes = [
    {
      id: noteId,
      title: noteTitle,
      createdAt: now,
      lastModified: now,
    },
  ]

  window.localStorage.clear()
  window.localStorage.setItem('annotation-notes', JSON.stringify(notes))
  window.localStorage.setItem(`note-data-${noteId}`, JSON.stringify(noteData))
  window.localStorage.setItem(
    'recent-notes',
    JSON.stringify([{ id: noteId, lastAccessed: Date.now() }])
  )
}

test.describe('Multi-layer canvas hover popups', () => {
  test('hovering folder eye opens overlay without flushSync errors', async ({ page }) => {
    await page.addInitScript(seedLocalStorage, {
      noteId: TEST_NOTE_ID,
      noteTitle: TEST_NOTE_TITLE,
      noteData: NOTE_DATA,
    })

    const flushSyncMessages: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('flushSync was called')) {
        flushSyncMessages.push(msg.text())
      }
    })

    await page.goto('/')

    const openExplorer = page.getByRole('button', { name: /Open Notes Explorer/i })
    if (await openExplorer.isVisible()) {
      await openExplorer.click()
    } else {
      const edgeToggle = page.locator('button[title="Notes Explorer"]')
      if (await edgeToggle.isVisible()) {
        await edgeToggle.click()
      }
    }

    const explorer = page.locator('[data-sidebar="sidebar"]')
    await expect(explorer).toBeVisible()

    await explorer.getByText(TEST_NOTE_TITLE, { exact: true }).first().click()

    await explorer.getByRole('button', { name: 'Organization' }).click()

    const rootTreeItem = explorer
      .locator('[role="treeitem"]').filter({ hasText: TEST_NOTE_TITLE })
      .first()
    const expandRoot = rootTreeItem.locator('button[aria-label="Expand"]')
    if (await expandRoot.isVisible()) {
      await expandRoot.click()
    }

    const folderTreeItem = explorer
      .locator('[role="treeitem"]').filter({ hasText: FOLDER_TITLE })
      .first()
    await folderTreeItem.locator('div.group').hover()

    const eyeButton = folderTreeItem
      .locator('button')
      .filter({ has: page.locator('svg[data-lucide="eye"]') })
      .first()

    await eyeButton.hover()
    await page.waitForTimeout(650)

    const popupCard = page.locator('#popup-overlay .popup-card').first()
    await expect(popupCard).toBeVisible({ timeout: 4000 })

    await expect(flushSyncMessages).toHaveLength(0)
  })
})
