/**
 * FloatingOverlayController
 *
 * Central controller for floating notes overlay system.
 * Manages popup positions, transforms, and adapter integration.
 *
 * Key responsibilities:
 * - Coordinate transform management (screen-space primary)
 * - Popup position tracking and reconciliation
 * - Capability-based API for canvas vs non-canvas contexts
 * - Adapter registration and lifecycle
 */

import { CoordinateBridge } from '@/lib/utils/coordinate-bridge'
import type {
  Point,
  Transform,
  OverlayCapabilities,
  OverlayPopupState,
  OverlayAdapter,
} from './types'

// Tolerance threshold for transform drift detection (pixels)
const TOLERANCE_PX = 5

/**
 * Reconcile screen-space and canvas-space positions
 */
function reconcilePosition(
  overlayPosition: Point | undefined,
  canvasPosition: Point,
  transform: Transform
): { primary: Point; drift: number } {
  // If no overlay position, derive from canvas
  if (!overlayPosition) {
    const derived = CoordinateBridge.canvasToScreen(canvasPosition, transform)
    return { primary: derived, drift: 0 }
  }

  // Calculate expected screen position from canvas position
  const derivedFromCanvas = CoordinateBridge.canvasToScreen(canvasPosition, transform)

  // Measure drift
  const drift = Math.hypot(
    derivedFromCanvas.x - overlayPosition.x,
    derivedFromCanvas.y - overlayPosition.y
  )

  // Screen-space is source of truth
  return { primary: overlayPosition, drift }
}

export class FloatingOverlayController {
  private adapter: OverlayAdapter | null = null
  private popups: Map<string, OverlayPopupState> = new Map()
  private transformListeners: Set<(t: Transform) => void> = new Set()
  private adapterCleanup?: () => void

  /**
   * Get current capabilities based on registered adapter
   */
  get capabilities(): OverlayCapabilities {
    return this.adapter?.capabilities ?? {
      transforms: true,
      shortcuts: false,
      layerToggle: false,
      persistence: false,
      resetView: false,
      toggleSidebar: false,
    }
  }

  /**
   * Register an overlay adapter
   */
  registerAdapter(adapter: OverlayAdapter): void {
    // Unregister previous adapter
    if (this.adapterCleanup) {
      this.adapterCleanup()
      this.adapterCleanup = undefined
    }

    this.adapter = adapter

    // Subscribe to transform changes from adapter
    this.adapterCleanup = adapter.onTransformChange((transform) => {
      this.handleTransformChange(transform)
    })

    // Notify listeners of initial transform
    const initialTransform = adapter.getTransform()
    this.notifyTransformListeners(initialTransform)
  }

  /**
   * Unregister current adapter
   */
  unregisterAdapter(): void {
    if (this.adapterCleanup) {
      this.adapterCleanup()
      this.adapterCleanup = undefined
    }
    this.adapter = null

    // Reset to identity transform
    this.notifyTransformListeners({ x: 0, y: 0, scale: 1 })
  }

  /**
   * Get current transform from adapter (or identity if none)
   */
  getTransform(): Transform {
    return this.adapter?.getTransform() ?? { x: 0, y: 0, scale: 1 }
  }

  /**
   * Subscribe to transform changes
   */
  onTransformChange(callback: (t: Transform) => void): () => void {
    this.transformListeners.add(callback)
    // Call immediately with current transform
    callback(this.getTransform())

    return () => {
      this.transformListeners.delete(callback)
    }
  }

  /**
   * Register a popup with the controller
   */
  registerPopup(popup: OverlayPopupState): void {
    this.popups.set(popup.id, popup)
  }

  /**
   * Unregister a popup
   */
  unregisterPopup(id: string): void {
    this.popups.delete(id)
  }

  /**
   * Update popup position (in screen-space)
   */
  updatePopupPosition(id: string, position: Point): void {
    const popup = this.popups.get(id)
    if (!popup) {
      console.warn(`Cannot update position for unknown popup: ${id}`)
      return
    }

    // Update screen-space position
    popup.overlayPosition = position

    // Derive canvas position if adapter available
    if (this.adapter) {
      const transform = this.adapter.getTransform()
      popup.canvasPosition = CoordinateBridge.screenToCanvas(position, transform)
    } else {
      // No adapter: canvas position = screen position
      popup.canvasPosition = position
    }

    // Note: Persistence is handled by consumers (e.g., PopupOverlay component)
    // Controller only manages in-memory state
  }

  /**
   * Get popup state by ID
   */
  getPopup(id: string): OverlayPopupState | undefined {
    return this.popups.get(id)
  }

  /**
   * Get all registered popups
   */
  getAllPopups(): OverlayPopupState[] {
    return Array.from(this.popups.values())
  }

  /**
   * Handle transform changes from adapter
   */
  private handleTransformChange(transform: Transform): void {
    // Reconcile all popup positions
    let driftCount = 0

    this.popups.forEach((popup) => {
      const { primary, drift } = reconcilePosition(
        popup.overlayPosition,
        popup.canvasPosition,
        transform
      )

      if (drift > TOLERANCE_PX) {
        driftCount++
        console.warn(
          `Transform drift detected for popup ${popup.id}: ${drift.toFixed(2)}px`
        )

        // Update canvas position to match screen-space (screen is source of truth)
        popup.canvasPosition = CoordinateBridge.screenToCanvas(primary, transform)

        // Note: Persistence should be triggered by consumers watching transform changes
      }

      // Ensure overlayPosition is always set
      if (!popup.overlayPosition) {
        popup.overlayPosition = primary
      }
    })

    if (driftCount > 0) {
      console.info(
        `Reconciled ${driftCount} popup(s) after transform change`
      )
    }

    // Notify listeners
    this.notifyTransformListeners(transform)
  }

  /**
   * Notify all transform listeners
   */
  private notifyTransformListeners(transform: Transform): void {
    this.transformListeners.forEach((listener) => {
      listener(transform)
    })
  }

  /**
   * Capability-aware methods (forward to adapter if available)
   */

  setActiveLayer(layer: string): void {
    if (this.capabilities.layerToggle && this.adapter?.setActiveLayer) {
      this.adapter.setActiveLayer(layer)
    } else {
      console.warn('setActiveLayer not available (no adapter or capability)')
    }
  }

  resetView(): void {
    if (this.capabilities.resetView && this.adapter?.resetView) {
      this.adapter.resetView()
    } else {
      console.warn('resetView not available (no adapter or capability)')
    }
  }

  toggleSidebar(): void {
    if (this.capabilities.toggleSidebar && this.adapter?.toggleSidebar) {
      this.adapter.toggleSidebar()
    } else {
      console.warn('toggleSidebar not available (no adapter or capability)')
    }
  }
}
