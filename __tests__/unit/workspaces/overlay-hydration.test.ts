import {
  buildHydratedOverlayLayout,
  type OverlayViewportTransform,
} from '@/lib/workspaces/overlay-hydration'
import { CoordinateBridge } from '@/lib/utils/coordinate-bridge'
import type { OverlayLayoutPayload } from '@/lib/types/overlay-layout'

describe('buildHydratedOverlayLayout', () => {
  const transform: OverlayViewportTransform = { x: 10, y: -5, scale: 2 }

  it('hydrates popup descriptors into overlay popups with screen positions', () => {
    const layout: OverlayLayoutPayload = {
      schemaVersion: '2.0.0',
      popups: [
        {
          id: 'popup-1',
          folderId: 'folder-1',
          folderName: 'My Folder',
          parentId: null,
          canvasPosition: { x: 120, y: 80 },
          level: 1,
        },
      ],
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
    }

    const result = buildHydratedOverlayLayout(layout, transform)

    expect(result.hash).toBe(
      JSON.stringify({
        schemaVersion: '2.0.0',
        popups: layout.popups,
        inspectors: [],
      })
    )

    expect(result.popups).toHaveLength(1)
    const hydrated = result.popups[0]
    const expectedPosition = CoordinateBridge.canvasToScreen(layout.popups[0].canvasPosition, transform)

    expect(hydrated.folderId).toBe('folder-1')
    expect(hydrated.folderName).toBe('My Folder')
    expect(hydrated.isLoading).toBe(true)
    expect(hydrated.position).toEqual(expectedPosition)
    expect(hydrated.canvasPosition).toEqual(layout.popups[0].canvasPosition)
    expect(hydrated.parentPopupId).toBeUndefined()
  })

  it('falls back to untitled folder name and returns empty results for no popups', () => {
    const layoutWithMissingName: OverlayLayoutPayload = {
      schemaVersion: '2.0.0',
      popups: [
        {
          id: 'popup-2',
          folderId: 'folder-2',
          parentId: 'parent-1',
          canvasPosition: { x: 0, y: 0 },
          level: 0,
        },
      ],
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
    }

    const hydrated = buildHydratedOverlayLayout(layoutWithMissingName, transform)
    expect(hydrated.popups[0].folderName).toBe('Untitled Folder')
    expect(hydrated.popups[0].parentPopupId).toBe('parent-1')

    const emptyLayout: OverlayLayoutPayload = {
      schemaVersion: '2.0.0',
      popups: [],
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
    }

    const emptyHydration = buildHydratedOverlayLayout(emptyLayout, transform)
    expect(emptyHydration.popups).toHaveLength(0)
  })
})
