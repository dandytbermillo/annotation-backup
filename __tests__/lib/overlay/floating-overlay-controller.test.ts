/**
 * Unit Tests: FloatingOverlayController
 *
 * Tests for capability introspection, transform management,
 * and popup position tracking.
 */

import { FloatingOverlayController } from '@/lib/overlay/floating-overlay-controller'
import type { OverlayAdapter, Transform, OverlayCapabilities } from '@/lib/overlay/types'

// Mock adapter for testing
class MockAdapter implements OverlayAdapter {
  capabilities: OverlayCapabilities
  private transform: Transform = { x: 0, y: 0, scale: 1 }
  private listeners: Set<(t: Transform) => void> = new Set()

  constructor(capabilities: Partial<OverlayCapabilities> = {}) {
    this.capabilities = {
      transforms: true,
      shortcuts: false,
      layerToggle: false,
      persistence: false,
      resetView: false,
      toggleSidebar: false,
      ...capabilities,
    }
  }

  getTransform(): Transform {
    return this.transform
  }

  onTransformChange(callback: (t: Transform) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  // Test helper: simulate transform change
  simulateTransformChange(newTransform: Transform): void {
    this.transform = newTransform
    this.listeners.forEach((listener) => listener(newTransform))
  }
}

describe('FloatingOverlayController', () => {
  describe('capabilities', () => {
    it('should report default capabilities without adapter', () => {
      const controller = new FloatingOverlayController()
      const caps = controller.capabilities

      expect(caps.transforms).toBe(true) // Always available
      expect(caps.shortcuts).toBe(false)
      expect(caps.layerToggle).toBe(false)
      expect(caps.persistence).toBe(false)
      expect(caps.resetView).toBe(false)
      expect(caps.toggleSidebar).toBe(false)
    })

    it('should report adapter capabilities when registered', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter({
        shortcuts: true,
        layerToggle: true,
        resetView: true,
      })

      controller.registerAdapter(adapter)
      const caps = controller.capabilities

      expect(caps.transforms).toBe(true)
      expect(caps.shortcuts).toBe(true)
      expect(caps.layerToggle).toBe(true)
      expect(caps.resetView).toBe(true)
      expect(caps.persistence).toBe(false)
      expect(caps.toggleSidebar).toBe(false)
    })

    it('should reset capabilities when adapter unregistered', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter({ shortcuts: true })

      controller.registerAdapter(adapter)
      expect(controller.capabilities.shortcuts).toBe(true)

      controller.unregisterAdapter()
      expect(controller.capabilities.shortcuts).toBe(false)
    })
  })

  describe('transform management', () => {
    it('should return identity transform without adapter', () => {
      const controller = new FloatingOverlayController()
      const transform = controller.getTransform()

      expect(transform).toEqual({ x: 0, y: 0, scale: 1 })
    })

    it('should return adapter transform when registered', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter()
      adapter.simulateTransformChange({ x: 100, y: 200, scale: 1.5 })

      controller.registerAdapter(adapter)
      const transform = controller.getTransform()

      expect(transform).toEqual({ x: 100, y: 200, scale: 1.5 })
    })

    it('should notify listeners on transform change', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter()
      controller.registerAdapter(adapter)

      const listener = jest.fn()
      controller.onTransformChange(listener)

      // Initial notification
      expect(listener).toHaveBeenCalledWith({ x: 0, y: 0, scale: 1 })

      // Change transform
      adapter.simulateTransformChange({ x: 50, y: 75, scale: 2 })
      expect(listener).toHaveBeenCalledWith({ x: 50, y: 75, scale: 2 })
    })

    it('should cleanup listener on unsubscribe', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter()
      controller.registerAdapter(adapter)

      const listener = jest.fn()
      const cleanup = controller.onTransformChange(listener)

      cleanup()
      listener.mockClear()

      adapter.simulateTransformChange({ x: 100, y: 100, scale: 1 })
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('popup management', () => {
    it('should register and retrieve popup', () => {
      const controller = new FloatingOverlayController()
      const popup = {
        id: 'popup-1',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 10, y: 20 },
        overlayPosition: { x: 10, y: 20 },
        level: 0,
      }

      controller.registerPopup(popup)
      const retrieved = controller.getPopup('popup-1')

      expect(retrieved).toEqual(popup)
    })

    it('should unregister popup', () => {
      const controller = new FloatingOverlayController()
      const popup = {
        id: 'popup-1',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 10, y: 20 },
        overlayPosition: { x: 10, y: 20 },
        level: 0,
      }

      controller.registerPopup(popup)
      controller.unregisterPopup('popup-1')

      expect(controller.getPopup('popup-1')).toBeUndefined()
    })

    it('should update popup position in screen-space', () => {
      const controller = new FloatingOverlayController()
      const popup = {
        id: 'popup-1',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 0, y: 0 },
        overlayPosition: { x: 0, y: 0 },
        level: 0,
      }

      controller.registerPopup(popup)
      controller.updatePopupPosition('popup-1', { x: 100, y: 150 })

      const updated = controller.getPopup('popup-1')
      expect(updated?.overlayPosition).toEqual({ x: 100, y: 150 })
    })

    it('should derive canvas position when adapter present', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter()
      adapter.simulateTransformChange({ x: 50, y: 50, scale: 2 })
      controller.registerAdapter(adapter)

      const popup = {
        id: 'popup-1',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 0, y: 0 },
        overlayPosition: { x: 100, y: 100 },
        level: 0,
      }

      controller.registerPopup(popup)
      controller.updatePopupPosition('popup-1', { x: 100, y: 100 })

      const updated = controller.getPopup('popup-1')
      // Screen position 100,100 with transform (50,50,2) => canvas (25, 25)
      expect(updated?.canvasPosition.x).toBeCloseTo(25)
      expect(updated?.canvasPosition.y).toBeCloseTo(25)
    })

    it('should get all registered popups', () => {
      const controller = new FloatingOverlayController()

      controller.registerPopup({
        id: 'popup-1',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 0, y: 0 },
        overlayPosition: { x: 0, y: 0 },
        level: 0,
      })

      controller.registerPopup({
        id: 'popup-2',
        folderId: null,
        parentId: null,
        canvasPosition: { x: 10, y: 10 },
        overlayPosition: { x: 10, y: 10 },
        level: 1,
      })

      const allPopups = controller.getAllPopups()
      expect(allPopups).toHaveLength(2)
      expect(allPopups.map((p) => p.id)).toEqual(['popup-1', 'popup-2'])
    })
  })

  describe('adapter lifecycle', () => {
    it('should cleanup previous adapter when registering new one', () => {
      const controller = new FloatingOverlayController()
      const adapter1 = new MockAdapter()
      const adapter2 = new MockAdapter()

      controller.registerAdapter(adapter1)
      const listener = jest.fn()
      controller.onTransformChange(listener)

      listener.mockClear()

      // Register second adapter
      controller.registerAdapter(adapter2)

      // Should get notification from new adapter
      expect(listener).toHaveBeenCalledWith({ x: 0, y: 0, scale: 1 })

      // Old adapter should be disconnected
      adapter1.simulateTransformChange({ x: 999, y: 999, scale: 1 })
      expect(listener).not.toHaveBeenCalledWith({ x: 999, y: 999, scale: 1 })
    })
  })

  describe('capability-aware methods', () => {
    it('should warn when calling unavailable capability', () => {
      const controller = new FloatingOverlayController()
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      controller.resetView()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('resetView not available')
      )

      consoleSpy.mockRestore()
    })

    it('should not warn when capability is available', () => {
      const controller = new FloatingOverlayController()
      const adapter = new MockAdapter({ resetView: true })
      adapter.resetView = jest.fn()

      controller.registerAdapter(adapter)

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      controller.resetView()
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})
