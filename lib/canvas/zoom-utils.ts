/**
 * Zoom utility helpers for wheel-based zooming.
 * Normalizes wheel input so trackpads and mice feel consistent.
 */

export interface WheelZoomEventLike {
  deltaX: number
  deltaY: number
  deltaMode?: number
}

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const LINE_HEIGHT_PX = 16
const PAGE_HEIGHT_PX = 800

function normalizeWheelDelta({ deltaX, deltaY, deltaMode = 0 }: WheelZoomEventLike): number {
  const dominant = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX

  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return dominant * LINE_HEIGHT_PX
    case DOM_DELTA_PAGE:
      return dominant * PAGE_HEIGHT_PX
    default:
      return dominant
  }
}

export interface ZoomMultiplierOptions {
  intensity?: number
  maxMagnitude?: number
}

export function getWheelZoomMultiplier(
  event: WheelZoomEventLike,
  { intensity = 0.0006, maxMagnitude = 600 }: ZoomMultiplierOptions = {}
): number {
  const normalized = Math.max(
    -maxMagnitude,
    Math.min(maxMagnitude, normalizeWheelDelta(event))
  )

  return Math.exp(-normalized * intensity)
}
