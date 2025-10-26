import { screenToWorld } from "@/lib/canvas/coordinate-utils"
import { debugLog } from "@/lib/utils/debug-logger"

// Panel size for centering calculation
const MAIN_PANEL_SIZE = { width: 500, height: 400 }

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

export const RAPID_CENTERING_OFFSET = 50
export const RAPID_CENTERING_RESET_MS = 2000
const DECAY_FACTOR = 0.85
const DECAY_STEPS = 5

export const clampToCanvasBounds = (position: { x: number; y: number }) => ({
  x: Math.max(CANVAS_SAFE_BOUNDS.minX, Math.min(CANVAS_SAFE_BOUNDS.maxX, position.x)),
  y: Math.max(CANVAS_SAFE_BOUNDS.minY, Math.min(CANVAS_SAFE_BOUNDS.maxY, position.y)),
})

const getViewportCenter = (): { x: number; y: number } | null => {
  if (typeof window === "undefined") return null
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

export const computeVisuallyCenteredWorldPosition = (
  cameraState: CameraStateSnapshot | null | undefined,
  sequence: RapidSequenceState,
  lastInteractionPoint?: { x: number; y: number } | null,
): { x: number; y: number } | null => {
  const referencePoint = lastInteractionPoint ?? getViewportCenter()

  debugLog({
    component: 'VisualCentering',
    action: 'compute_start',
    metadata: {
      referencePoint,
      lastInteractionPoint,
      cameraState,
      sequenceCount: sequence.count
    }
  })

  if (!referencePoint) {
    debugLog({
      component: 'VisualCentering',
      action: 'compute_failed',
      metadata: { reason: 'no_reference_point' }
    })
    return null
  }

  const { translateX = 0, translateY = 0, zoom = 1 } = cameraState ?? {}
  const effectiveZoom = Number.isFinite(zoom) && zoom && zoom > 0 ? zoom : 1
  const camera = { x: translateX ?? 0, y: translateY ?? 0 }
  const baseWorld = screenToWorld(referencePoint, camera, effectiveZoom)

  debugLog({
    component: 'VisualCentering',
    action: 'screen_to_world_conversion',
    metadata: {
      referencePoint,
      camera,
      effectiveZoom,
      baseWorld
    }
  })

  // Subtract half panel size to center the panel (not just its top-left corner)
  const centeredWorld = {
    x: baseWorld.x - MAIN_PANEL_SIZE.width / 2,
    y: baseWorld.y - MAIN_PANEL_SIZE.height / 2,
  }

  debugLog({
    component: 'VisualCentering',
    action: 'centered_calculation',
    metadata: {
      baseWorld,
      panelSize: MAIN_PANEL_SIZE,
      centeredWorld
    }
  })

  const now = Date.now()
  if (now - sequence.lastTimestamp > RAPID_CENTERING_RESET_MS) {
    sequence.count = 0
  }
  const offsetIndex = sequence.count
  sequence.count += 1
  sequence.lastTimestamp = now

  const angledOffset = offsetIndex * RAPID_CENTERING_OFFSET
  const visualWorld = clampToCanvasBounds({
    x: centeredWorld.x + angledOffset,
    y: centeredWorld.y + angledOffset,
  })

  debugLog({
    component: 'VisualCentering',
    action: 'final_position',
    metadata: {
      offsetIndex,
      angledOffset,
      beforeClamp: {
        x: centeredWorld.x + angledOffset,
        y: centeredWorld.y + angledOffset
      },
      visualWorld
    }
  })

  return visualWorld
}

export const computeCenteredPositionWithDecay = (
  persistedPosition: { x: number; y: number } | null,
  centeredPosition: { x: number; y: number },
  mruPosition?: { x: number; y: number } | null,
): { x: number; y: number } => {
  if (!persistedPosition && !mruPosition) {
    return centeredPosition
  }

  const anchor = mruPosition ?? persistedPosition
  if (!anchor) {
    return centeredPosition
  }

  let next = { ...centeredPosition }
  for (let step = 0; step < DECAY_STEPS; step += 1) {
    next = {
      x: next.x * DECAY_FACTOR + anchor.x * (1 - DECAY_FACTOR),
      y: next.y * DECAY_FACTOR + anchor.y * (1 - DECAY_FACTOR),
    }
  }

  return clampToCanvasBounds(next)
}
