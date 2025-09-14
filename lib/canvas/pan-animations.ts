/**
 * Canvas pan animation utilities for smooth viewport transitions
 * 
 * Provides smooth panning to newly created panels and other canvas elements.
 * Uses requestAnimationFrame for smooth 60fps animations.
 * 
 * @module lib/canvas/pan-animations
 */

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface PanOptions {
  duration?: number      // Animation duration in ms (default: 500)
  ease?: EasingFunction  // Easing function (default: easeInOutCubic)
  offset?: { x: number; y: number } // Offset from target (default: center)
  callback?: () => void  // Callback when animation completes
}

export type EasingFunction = (t: number) => number

/**
 * Common easing functions
 */
export const easings = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  }
}

/**
 * Calculate the viewport pan needed to center a panel
 */
export function calculatePanDelta(
  currentViewport: ViewportState,
  targetPosition: { x: number; y: number },
  panelDimensions: { width: number; height: number },
  viewportDimensions: { width: number; height: number }
): { x: number; y: number } {
  // Calculate center of panel
  const panelCenterX = targetPosition.x + panelDimensions.width / 2
  const panelCenterY = targetPosition.y + panelDimensions.height / 2
  
  // Calculate viewport center (accounting for zoom)
  const viewportCenterX = viewportDimensions.width / 2 / currentViewport.zoom
  const viewportCenterY = viewportDimensions.height / 2 / currentViewport.zoom
  
  // Calculate delta needed to center panel
  const deltaX = viewportCenterX - panelCenterX - currentViewport.x
  const deltaY = viewportCenterY - panelCenterY - currentViewport.y
  
  return { x: deltaX, y: deltaY }
}

/**
 * Smoothly pan the canvas to a target position
 */
export function smoothPanTo(
  currentViewport: ViewportState,
  targetPosition: { x: number; y: number },
  updateViewport: (viewport: Partial<ViewportState>) => void,
  options: PanOptions = {}
): () => void {
  const {
    duration = 500,
    ease = easings.easeInOutCubic,
    offset = { x: 0, y: 0 },
    callback
  } = options
  
  const startTime = Date.now()
  const startX = currentViewport.x
  const startY = currentViewport.y
  
  // Calculate target viewport position (negative because we're moving the viewport)
  const targetX = -targetPosition.x + offset.x
  const targetY = -targetPosition.y + offset.y
  
  let animationId: number
  
  const animate = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / duration, 1)
    const easedProgress = ease(progress)
    
    // Interpolate position
    const x = startX + (targetX - startX) * easedProgress
    const y = startY + (targetY - startY) * easedProgress
    
    updateViewport({ x, y })
    
    if (progress < 1) {
      animationId = requestAnimationFrame(animate)
    } else {
      callback?.()
    }
  }
  
  animationId = requestAnimationFrame(animate)
  
  // Return cleanup function
  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId)
    }
  }
}

/**
 * Pan to a specific panel with smooth animation
 */
export function panToPanel(
  panelId: string,
  getPanelPosition: (id: string) => { x: number; y: number } | null,
  currentViewport: ViewportState,
  updateViewport: (viewport: Partial<ViewportState>) => void,
  options: PanOptions = {}
): boolean {
  const position = getPanelPosition(panelId)
  if (!position) {
    console.warn(`Panel ${panelId} not found for panning`)
    return false
  }
  
  // Default panel dimensions (can be made configurable)
  const panelDimensions = { width: 500, height: 400 }
  const viewportDimensions = {
    width: window.innerWidth,
    height: window.innerHeight
  }
  
  // Calculate offset to center the panel
  const centerOffset = {
    x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / currentViewport.zoom,
    y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / currentViewport.zoom
  }
  
  smoothPanTo(
    currentViewport,
    position,
    updateViewport,
    {
      ...options,
      offset: centerOffset
    }
  )
  
  return true
}

/**
 * Focus on a panel with zoom and pan
 */
export function focusOnPanel(
  panelId: string,
  getPanelPosition: (id: string) => { x: number; y: number } | null,
  currentViewport: ViewportState,
  updateViewport: (viewport: Partial<ViewportState>) => void,
  targetZoom = 1,
  options: PanOptions = {}
): boolean {
  const position = getPanelPosition(panelId)
  if (!position) return false
  
  // First zoom, then pan
  const zoomDuration = 300
  const startZoom = currentViewport.zoom
  const zoomStartTime = Date.now()
  
  const animateZoom = () => {
    const elapsed = Date.now() - zoomStartTime
    const progress = Math.min(elapsed / zoomDuration, 1)
    const easedProgress = easings.easeOutQuad(progress)
    
    const zoom = startZoom + (targetZoom - startZoom) * easedProgress
    updateViewport({ zoom })
    
    if (progress < 1) {
      requestAnimationFrame(animateZoom)
    } else {
      // After zoom completes, pan to panel
      panToPanel(panelId, getPanelPosition, { ...currentViewport, zoom: targetZoom }, updateViewport, options)
    }
  }
  
  requestAnimationFrame(animateZoom)
  return true
}