/**
 * Shared Auto-Scroll Configuration
 *
 * Centralizes auto-scroll parameters for consistency between
 * dashboard and workspace drag behaviors.
 *
 * Part of: workspace_autoscroll_parity implementation
 * See: docs/proposal/components/workspace/autoscroll/IMPLEMENTATION_PLAN.md
 */

/**
 * Auto-scroll configuration matching Option A (dashboard feel):
 * - Snappy 300ms activation delay
 * - Moderate 400 px/s speed
 * - No visual affordance (simple, unobtrusive)
 */
export const AUTO_SCROLL_CONFIG = {
  /** Edge proximity threshold in pixels */
  threshold: 50,

  /** Scroll speed in screen pixels per second */
  speedPxPerSec: 400,

  /** Delay before auto-scroll activates (ms) */
  activationDelay: 300,
} as const

/**
 * Container ID for workspace canvas edge detection.
 * Used by canvas-panel and component-panel.
 */
export const WORKSPACE_CONTAINER_ID = 'canvas-container'

export type AutoScrollConfig = typeof AUTO_SCROLL_CONFIG
