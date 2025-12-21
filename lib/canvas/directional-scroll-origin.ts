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
 * Capture the origin translateX for a workspace.
 * Should be called once when the workspace lifecycle transitions to "ready".
 *
 * @param workspaceId - The workspace ID
 * @param translateX - The current translateX to set as origin
 * @returns true if origin was captured, false if already captured
 */
export function captureOrigin(workspaceId: string, translateX: number): boolean {
  if (!workspaceId) return false

  // Don't recapture if already set (hot switch protection)
  if (workspaceOrigins.has(workspaceId)) {
    debugLog({
      component: "DirectionalScroll",
      action: "origin_capture_skipped",
      metadata: {
        workspaceId,
        reason: "already_captured",
        existingOrigin: workspaceOrigins.get(workspaceId)?.originTranslateX,
        attemptedOrigin: translateX,
      },
    })
    return false
  }

  workspaceOrigins.set(workspaceId, {
    originTranslateX: translateX,
    capturedAt: Date.now(),
  })

  debugLog({
    component: "DirectionalScroll",
    action: "origin_captured",
    metadata: {
      workspaceId,
      originTranslateX: translateX,
    },
  })

  return true
}

/**
 * Update the origin translateX for a workspace.
 * Used when the user explicitly resets the view or centers a note.
 *
 * @param workspaceId - The workspace ID
 * @param translateX - The new translateX to set as origin
 */
export function updateOrigin(workspaceId: string, translateX: number): void {
  if (!workspaceId) return

  const previous = workspaceOrigins.get(workspaceId)

  workspaceOrigins.set(workspaceId, {
    originTranslateX: translateX,
    capturedAt: Date.now(),
  })

  debugLog({
    component: "DirectionalScroll",
    action: "origin_updated",
    metadata: {
      workspaceId,
      previousOrigin: previous?.originTranslateX,
      newOrigin: translateX,
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
