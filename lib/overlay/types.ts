/**
 * Core types for floating overlay system
 */

export interface Point {
  x: number
  y: number
}

export interface Transform {
  x: number
  y: number
  scale: number
}

export interface OverlayCapabilities {
  transforms: boolean       // Always true (screen-space transforms always available)
  shortcuts: boolean        // Canvas-only (keyboard shortcuts for layer switching)
  layerToggle: boolean     // Canvas-only (multi-layer support)
  persistence: boolean     // Optional (layout persistence available)
  resetView: boolean       // Optional (view reset capability)
  toggleSidebar: boolean   // Canvas-only (sidebar toggle)
}

export interface OverlayPopupState {
  id: string
  folderId: string | null
  parentId: string | null
  canvasPosition: Point
  overlayPosition: Point
  level: number
  height?: number
}

export interface OverlayAdapter {
  readonly capabilities: OverlayCapabilities

  getTransform(): Transform
  onTransformChange(callback: (t: Transform) => void): () => void

  // Optional capabilities (only present if capability flag is true)
  setActiveLayer?(layer: string): void
  registerShortcut?(key: string, handler: () => void): () => void
  resetView?(): void
  toggleSidebar?(): void
}
