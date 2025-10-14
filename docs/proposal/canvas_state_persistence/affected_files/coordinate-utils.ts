/**
 * Canvas Coordinate Conversion Utilities
 *
 * Handles conversion between world-space (panel intrinsic coordinates) and
 * screen-space (viewport-relative coordinates) for the canvas system.
 *
 * Coordinate System:
 * - World position: Panel's intrinsic canvas coordinate (style.left/top values)
 * - Screen position: Viewport-relative position after camera transform and zoom
 * - Camera: Translation values (translateX, translateY) in screen pixels
 * - Zoom: Scale factor (>=0.5, default 1.0)
 *
 * The canvas container applies: transform: translate3d(translateX, translateY, 0) scale(zoom)
 * Because translation precedes scaling, screen coordinates follow: (world + translate) * zoom
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 63-87
 */

export interface XY {
  x: number
  y: number
}

/**
 * Convert screen-space coordinates to world-space coordinates
 *
 * Formula: world = screen / zoom - camera
 *
 * @param screen - Screen-space coordinate (viewport-relative pixels)
 * @param camera - Camera translation (translateX, translateY in screen pixels)
 * @param zoom - Zoom scale factor
 * @returns World-space coordinate (panel intrinsic position)
 *
 * @example
 * // User clicks at screen position (500, 300) with camera at (100, 50) and zoom 2x
 * const worldPos = screenToWorld({x: 500, y: 300}, {x: 100, y: 50}, 2)
 * // Result: {x: 150, y: 100} in world space
 */
export function screenToWorld(screen: XY, camera: XY, zoom: number): XY {
  return {
    x: screen.x / zoom - camera.x,
    y: screen.y / zoom - camera.y
  }
}

/**
 * Convert world-space coordinates to screen-space coordinates
 *
 * Formula: screen = (world + camera) * zoom
 *
 * @param world - World-space coordinate (panel intrinsic position)
 * @param camera - Camera translation (translateX, translateY in screen pixels)
 * @param zoom - Zoom scale factor
 * @returns Screen-space coordinate (viewport-relative pixels)
 *
 * @example
 * // Panel at world position (100, 200) with camera at (50, 75) and zoom 2x
 * const screenPos = worldToScreen({x: 100, y: 200}, {x: 50, y: 75}, 2)
 * // Result: {x: 300, y: 550} in screen space
 */
export function worldToScreen(world: XY, camera: XY, zoom: number): XY {
  return {
    x: (world.x + camera.x) * zoom,
    y: (world.y + camera.y) * zoom
  }
}

/**
 * Convert screen-space dimensions to world-space dimensions
 *
 * Formula: worldSize = screenSize / zoom
 *
 * Note: Dimensions don't include camera offset, only zoom scaling
 *
 * @param size - Screen-space dimensions (width, height in pixels)
 * @param zoom - Zoom scale factor
 * @returns World-space dimensions
 *
 * @example
 * // Panel appears as 400x300 pixels on screen at 2x zoom
 * const worldSize = sizeScreenToWorld({x: 400, y: 300}, 2)
 * // Result: {x: 200, y: 150} in world space
 */
export function sizeScreenToWorld(size: XY, zoom: number): XY {
  return {
    x: size.x / zoom,
    y: size.y / zoom
  }
}

/**
 * Convert world-space dimensions to screen-space dimensions
 *
 * Formula: screenSize = worldSize * zoom
 *
 * @param size - World-space dimensions (width, height)
 * @param zoom - Zoom scale factor
 * @returns Screen-space dimensions (pixels)
 *
 * @example
 * // Panel is 200x150 in world space at 2x zoom
 * const screenSize = sizeWorldToScreen({x: 200, y: 150}, 2)
 * // Result: {x: 400, y: 300} on screen
 */
export function sizeWorldToScreen(size: XY, zoom: number): XY {
  return {
    x: size.x * zoom,
    y: size.y * zoom
  }
}

/**
 * Verify coordinate conversion round-trip consistency
 *
 * Useful for testing that formulas are mathematically correct
 *
 * @param screen - Original screen coordinate
 * @param camera - Camera translation
 * @param zoom - Zoom factor
 * @param tolerance - Acceptable floating point error (default 0.001)
 * @returns true if round-trip conversion preserves original values
 */
export function verifyCoordinateRoundTrip(
  screen: XY,
  camera: XY,
  zoom: number,
  tolerance = 0.001
): boolean {
  const world = screenToWorld(screen, camera, zoom)
  const backToScreen = worldToScreen(world, camera, zoom)

  const deltaX = Math.abs(backToScreen.x - screen.x)
  const deltaY = Math.abs(backToScreen.y - screen.y)

  return deltaX < tolerance && deltaY < tolerance
}
