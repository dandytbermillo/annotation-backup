/**
 * Unit Tests: Overlay Layout Schema v2
 *
 * Tests for dual coordinate storage (canvasPosition + overlayPosition)
 * and backward compatibility with v1 layouts.
 */

import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  OverlayPopupDescriptor,
  OverlayLayoutPayload,
  OverlayCanvasPosition,
} from '@/lib/types/overlay-layout'

describe('Overlay Layout Schema v2', () => {
  describe('OVERLAY_LAYOUT_SCHEMA_VERSION', () => {
    it('should be version 2.0.0', () => {
      expect(OVERLAY_LAYOUT_SCHEMA_VERSION).toBe('2.0.0')
    })
  })

  describe('OverlayPopupDescriptor', () => {
    it('should support dual coordinate storage', () => {
      const canvasPos: OverlayCanvasPosition = { x: 100, y: 200 }
      const overlayPos: OverlayCanvasPosition = { x: 150, y: 250 }

      const popup: OverlayPopupDescriptor = {
        id: 'test-popup',
        folderId: null,
        parentId: null,
        canvasPosition: canvasPos,
        overlayPosition: overlayPos,
        level: 0,
        height: 400,
      }

      expect(popup.canvasPosition).toEqual(canvasPos)
      expect(popup.overlayPosition).toEqual(overlayPos)
      expect(popup.overlayPosition).toBeDefined()
    })

    it('should allow overlayPosition to be optional (backward compatible)', () => {
      const popup: OverlayPopupDescriptor = {
        id: 'test-popup-v1',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 100, y: 200 },
        // overlayPosition omitted (v1 layout)
        level: 0,
      }

      expect(popup.canvasPosition).toEqual({ x: 100, y: 200 })
      expect(popup.overlayPosition).toBeUndefined()
    })

    it('should preserve all popup fields with overlayPosition', () => {
      const popup: OverlayPopupDescriptor = {
        id: 'popup-with-all-fields',
        folderId: 'folder-123',
        parentId: 'parent-456',
        canvasPosition: { x: 10, y: 20 },
        overlayPosition: { x: 30, y: 40 },
        level: 2,
        height: 500,
      }

      expect(popup.id).toBe('popup-with-all-fields')
      expect(popup.folderId).toBe('folder-123')
      expect(popup.parentId).toBe('parent-456')
      expect(popup.level).toBe(2)
      expect(popup.height).toBe(500)
    })

    it('should handle null folderId and parentId', () => {
      const popup: OverlayPopupDescriptor = {
        id: 'root-popup',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 0, y: 0 },
        overlayPosition: { x: 0, y: 0 },
        level: 0,
      }

      expect(popup.folderId).toBeNull()
      expect(popup.parentId).toBeNull()
    })
  })

  describe('OverlayLayoutPayload', () => {
    it('should support multiple popups with mixed v1/v2 descriptors', () => {
      const layout: OverlayLayoutPayload = {
        schemaVersion: '2.0.0',
        popups: [
          {
            id: 'popup-v2',
            folderId: null,
            parentId: null,
            canvasPosition: { x: 100, y: 100 },
            overlayPosition: { x: 150, y: 150 },
            level: 0,
          },
          {
            id: 'popup-v1',
            folderId: null,
            parentId: null,
            canvasPosition: { x: 200, y: 200 },
            // no overlayPosition (backward compatible)
            level: 1,
          },
        ],
        inspectors: [],
        lastSavedAt: new Date().toISOString(),
      }

      expect(layout.schemaVersion).toBe('2.0.0')
      expect(layout.popups).toHaveLength(2)
      expect(layout.popups[0].overlayPosition).toBeDefined()
      expect(layout.popups[1].overlayPosition).toBeUndefined()
    })

    it('should validate schema version is a string', () => {
      const layout: OverlayLayoutPayload = {
        schemaVersion: '2.0.0',
        popups: [],
        inspectors: [],
        lastSavedAt: new Date().toISOString(),
      }

      expect(typeof layout.schemaVersion).toBe('string')
      expect(layout.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/) // semver format
    })
  })

  describe('Coordinate equality', () => {
    it('should allow overlayPosition to equal canvasPosition', () => {
      const position: OverlayCanvasPosition = { x: 100, y: 200 }

      const popup: OverlayPopupDescriptor = {
        id: 'same-coords',
        folderId: null,
        parentId: null,
        canvasPosition: position,
        overlayPosition: position, // Same reference
        level: 0,
      }

      expect(popup.canvasPosition).toBe(popup.overlayPosition)
    })

    it('should allow overlayPosition to be backfilled from canvasPosition', () => {
      const canvasPos = { x: 50, y: 75 }

      // Simulate backfill (migration logic)
      const popup: OverlayPopupDescriptor = {
        id: 'backfilled',
        folderId: null,
        parentId: null,
        canvasPosition: canvasPos,
        overlayPosition: canvasPos, // Backfilled
        level: 0,
      }

      expect(popup.overlayPosition).toEqual(canvasPos)
      expect(popup.overlayPosition?.x).toBe(50)
      expect(popup.overlayPosition?.y).toBe(75)
    })
  })

  describe('Type safety', () => {
    it('should enforce OverlayCanvasPosition structure', () => {
      const validPosition: OverlayCanvasPosition = { x: 10, y: 20 }

      expect(validPosition.x).toBe(10)
      expect(validPosition.y).toBe(20)
      expect(Object.keys(validPosition)).toEqual(['x', 'y'])
    })

    it('should enforce number types for coordinates', () => {
      const position: OverlayCanvasPosition = { x: 123.45, y: 678.90 }

      expect(typeof position.x).toBe('number')
      expect(typeof position.y).toBe('number')
    })
  })

  describe('Migration scenarios', () => {
    it('should represent a v1 layout before migration', () => {
      const v1Layout: OverlayLayoutPayload = {
        schemaVersion: '1.0.0',
        popups: [
          {
            id: 'old-popup',
            folderId: null,
            parentId: null,
            canvasPosition: { x: 10, y: 20 },
            // no overlayPosition
            level: 0,
          },
        ],
        inspectors: [],
        lastSavedAt: '2025-09-01T00:00:00Z',
      }

      expect(v1Layout.schemaVersion).toBe('1.0.0')
      expect(v1Layout.popups[0].overlayPosition).toBeUndefined()
    })

    it('should represent a v2 layout after migration', () => {
      const v2Layout: OverlayLayoutPayload = {
        schemaVersion: '2.0.0',
        popups: [
          {
            id: 'migrated-popup',
            folderId: null,
            parentId: null,
            canvasPosition: { x: 10, y: 20 },
            overlayPosition: { x: 10, y: 20 }, // Backfilled
            level: 0,
          },
        ],
        inspectors: [],
        lastSavedAt: '2025-10-01T00:00:00Z',
      }

      expect(v2Layout.schemaVersion).toBe('2.0.0')
      expect(v2Layout.popups[0].overlayPosition).toBeDefined()
      expect(v2Layout.popups[0].overlayPosition).toEqual(
        v2Layout.popups[0].canvasPosition
      )
    })
  })
})
