/**
 * Directional Scroll Origin Manager
 *
 * Manages the baseline translateX (origin) for the directional scroll feature.
 * The origin is captured once per workspace when the workspace lifecycle becomes "ready".
 * This prevents users from panning left beyond the origin position.
 *
 * @see docs/proposal/components/entry_workspace/2025-12-21-directional-transform-scroll-plan.md
 */

import { debugLog } from "@/lib/utils/debug-logger"

// =============================================================================
// Types
// =============================================================================

interface OriginState {
  /** The baseline translateX value captured when workspace became ready */
  originTranslateX: number
  /** The baseline translateY value captured when workspace became ready */
  originTranslateY: number
  /** Timestamp when origin was captured */
  capturedAt: number
}

// =============================================================================
// State Storage (Module-level, keyed by workspaceId)
// =============================================================================

const workspaceOrigins = new Map<string, OriginState>()

// =============================================================================
// Origin Capture
// =============================================================================

/**
 * Capture the origin translateX and translateY for a workspace.
 * Should be called once when the workspace lifecycle transitions to "ready".
 *
 * @param workspaceId - The workspace ID
 * @param translateX - The current translateX to set as origin
 * @param translateY - The current translateY to set as origin
 * @returns true if origin was captured, false if already captured
 */
export function captureOrigin(workspaceId: string, translateX: number, translateY: number): boolean {
  if (!workspaceId) return false

  // Don't recapture if already set (hot switch protection)
  if (workspaceOrigins.has(workspaceId)) {
    debugLog({
      component: "DirectionalScroll",
      action: "origin_capture_skipped",
      metadata: {
        workspaceId,
        reason: "already_captured",
        existingOriginX: workspaceOrigins.get(workspaceId)?.originTranslateX,
        existingOriginY: workspaceOrigins.get(workspaceId)?.originTranslateY,
        attemptedOriginX: translateX,
        attemptedOriginY: translateY,
      },
    })
    return false
  }

  workspaceOrigins.set(workspaceId, {
    originTranslateX: translateX,
    originTranslateY: translateY,
    capturedAt: Date.now(),
  })

  debugLog({
    component: "DirectionalScroll",
    action: "origin_captured",
    metadata: {
      workspaceId,
      originTranslateX: translateX,
      originTranslateY: translateY,
    },
  })

  return true
}

/**
 * Update the origin translateX and translateY for a workspace.
 * Used when the user explicitly resets the view or centers a note.
 *
 * @param workspaceId - The workspace ID
 * @param translateX - The new translateX to set as origin
 * @param translateY - The new translateY to set as origin
 */
export function updateOrigin(workspaceId: string, translateX: number, translateY: number): void {
  if (!workspaceId) return

  const previous = workspaceOrigins.get(workspaceId)

  workspaceOrigins.set(workspaceId, {
    originTranslateX: translateX,
    originTranslateY: translateY,
    capturedAt: Date.now(),
  })

  debugLog({
    component: "DirectionalScroll",
    action: "origin_updated",
    metadata: {
      workspaceId,
      previousOriginX: previous?.originTranslateX,
      previousOriginY: previous?.originTranslateY,
      newOriginX: translateX,
      newOriginY: translateY,
      reason: "programmatic_update",
    },
  })
}

/**
 * Clear the origin for a workspace.
 * Called when workspace is unmounted or evicted.
 *
 * @param workspaceId - The workspace ID
 */
export function clearOrigin(workspaceId: string): void {
  if (!workspaceId) return

  const had = workspaceOrigins.has(workspaceId)
  workspaceOrigins.delete(workspaceId)

  if (had) {
    debugLog({
      component: "DirectionalScroll",
      action: "origin_cleared",
      metadata: { workspaceId },
    })
  }
}

// =============================================================================
// Origin Access
// =============================================================================

/**
 * Get the origin translateX for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @returns The origin translateX, or null if not captured
 */
export function getOrigin(workspaceId: string): number | null {
  if (!workspaceId) return null
  return workspaceOrigins.get(workspaceId)?.originTranslateX ?? null
}

/**
 * Get the origin translateY for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @returns The origin translateY, or null if not captured
 */
export function getOriginY(workspaceId: string): number | null {
  if (!workspaceId) return null
  return workspaceOrigins.get(workspaceId)?.originTranslateY ?? null
}

/**
 * Check if origin has been captured for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @returns true if origin exists
 */
export function hasOrigin(workspaceId: string): boolean {
  return workspaceOrigins.has(workspaceId)
}

// =============================================================================
// Directional Clamp
// =============================================================================

/**
 * Clamp translateX to enforce the directional scroll rule:
 * - Can move right freely (translateX decreases)
 * - Can move left only until origin is reached (translateX cannot exceed origin)
 *
 * @param workspaceId - The workspace ID
 * @param translateX - The proposed translateX value
 * @returns The clamped translateX value
 */
export function clampTranslateX(workspaceId: string, translateX: number): number {
  const origin = getOrigin(workspaceId)

  // If no origin captured yet, allow all movement
  if (origin === null) {
    return translateX
  }

  // Clamp: translateX cannot be greater than origin (blocks left movement past origin)
  // Since moving left = translateX increases, and moving right = translateX decreases:
  // - translateX > origin means we've moved left of origin → clamp to origin
  // - translateX <= origin means we're at or right of origin → allowed
  if (translateX > origin) {
    debugLog({
      component: "DirectionalScroll",
      action: "clamp_applied",
      metadata: {
        workspaceId,
        proposedTranslateX: translateX,
        origin,
        clampedTo: origin,
      },
    })
    return origin
  }

  return translateX
}

/**
 * Clamp translateY to enforce the directional scroll rule:
 * - Can move down freely (translateY decreases)
 * - Can move up only until origin is reached (translateY cannot exceed origin)
 *
 * @param workspaceId - The workspace ID
 * @param translateY - The proposed translateY value
 * @returns The clamped translateY value
 */
export function clampTranslateY(workspaceId: string, translateY: number): number {
  const origin = getOriginY(workspaceId)

  // If no origin captured yet, allow all movement
  if (origin === null) {
    return translateY
  }

  // Clamp: translateY cannot be greater than origin (blocks up movement past origin)
  // Since moving up = translateY increases, and moving down = translateY decreases:
  // - translateY > origin means we've moved up past origin → clamp to origin
  // - translateY <= origin means we're at or below origin → allowed
  if (translateY > origin) {
    debugLog({
      component: "DirectionalScroll",
      action: "clamp_y_applied",
      metadata: {
        workspaceId,
        proposedTranslateY: translateY,
        origin,
        clampedTo: origin,
      },
    })
    return origin
  }

  return translateY
}

/**
 * Check if a proposed translateX would be clamped.
 *
 * @param workspaceId - The workspace ID
 * @param translateX - The proposed translateX value
 * @returns true if the value would be clamped
 */
export function wouldClamp(workspaceId: string, translateX: number): boolean {
  const origin = getOrigin(workspaceId)
  if (origin === null) return false
  return translateX > origin
}
