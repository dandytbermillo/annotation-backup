import { screenToWorld } from "@/lib/canvas/coordinate-utils"

export type CameraStateSnapshot = {
  translateX?: number | null
  translateY?: number | null
  zoom?: number | null
}

export type RapidSequenceState = {
  count: number
  lastTimestamp: number
}

export const CANVAS_SAFE_BOUNDS = {
  minX: -10000,
  maxX: 10000,
  minY: -10000,
  maxY: 10000,
}

export const RAPID_CENTERING_RESET_MS = 2000
export const RAPID_CENTERING_OFFSET = 50

export const clampToCanvasBounds = (position: { x: number; y: number }) => ({
  x: Math.max(CANVAS_SAFE_BOUNDS.minX, Math.min(CANVAS_SAFE_BOUNDS.maxX, position.x)),
  y: Math.max(CANVAS_SAFE_BOUNDS.minY, Math.min(CANVAS_SAFE_BOUNDS.maxY, position.y)),
})

export const computeViewportWorldCenter = (
  cameraState?: CameraStateSnapshot | null,
): { x: number; y: number } | null => {
  if (typeof window === "undefined") {
    return null
  }

  const { translateX = 0, translateY = 0, zoom = 1 } = cameraState ?? {}
  const effectiveZoom = Number.isFinite(zoom) && zoom && zoom > 0 ? zoom : 1
  const camera = { x: translateX, y: translateY }
  const viewportCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 }

  const worldPosition = screenToWorld(viewportCenter, camera, effectiveZoom)
  return clampToCanvasBounds(worldPosition)
}

export const computeViewportCenterWithOffset = (
  cameraState: CameraStateSnapshot | null | undefined,
  sequence: RapidSequenceState,
  options?: {
    offsetStep?: number
    resetMs?: number
  },
): { x: number; y: number } | null => {
  const basePosition = computeViewportWorldCenter(cameraState)
  if (!basePosition) {
    return null
  }

  const resetMs = options?.resetMs ?? RAPID_CENTERING_RESET_MS
  const offsetStep = options?.offsetStep ?? RAPID_CENTERING_OFFSET
  const now = Date.now()

  if (now - sequence.lastTimestamp > resetMs) {
    sequence.count = 0
  }

  const offsetAmount = sequence.count * offsetStep
  sequence.count += 1
  sequence.lastTimestamp = now

  return clampToCanvasBounds({
    x: basePosition.x + offsetAmount,
    y: basePosition.y + offsetAmount,
  })
}
