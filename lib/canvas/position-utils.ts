/**
 * Position Utilities for Canvas Panel Positioning
 *
 * Helpers for detecting default/fallback positions and validating coordinates
 */

import { DEFAULT_PANEL_DIMENSIONS } from './panel-metrics'

/**
 * Legacy default position used before viewport-centered positioning
 */
export const LEGACY_DEFAULT_MAIN_POSITION = { x: 2000, y: 1500 }

/**
 * Get the current default main panel position (viewport-centered)
 */
export function getDefaultMainPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }
  const { width, height } = DEFAULT_PANEL_DIMENSIONS
  const centeredX = Math.round(window.innerWidth / 2 - width / 2)
  const centeredY = Math.round(window.innerHeight / 2 - height / 2)
  return { x: centeredX, y: centeredY }
}

/**
 * Check if a position is the default fallback position
 *
 * Detects both:
 * - Current viewport-centered default
 * - Legacy hardcoded default (2000, 1500)
 *
 * Used to determine if a position came from a real user action
 * or was just a system-generated fallback
 */
export function isDefaultMainPosition(
  position: { x: number; y: number } | null | undefined
): boolean {
  if (!position) return false

  const defaultPosition = getDefaultMainPosition()
  const matchesCurrent =
    Math.round(position.x) === defaultPosition.x &&
    Math.round(position.y) === defaultPosition.y

  const matchesLegacy =
    position.x === LEGACY_DEFAULT_MAIN_POSITION.x &&
    position.y === LEGACY_DEFAULT_MAIN_POSITION.y

  return matchesCurrent || matchesLegacy
}
