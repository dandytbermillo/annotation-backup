// @ts-nocheck
/**
 * Performance tracking for annotation decorations
 * Minimal stub for tracking tooltip metrics
 */

let tooltipShownCount = 0

export function trackTooltipShown(): void {
  tooltipShownCount++
  // Performance tracking disabled for legacy code
  // Can be re-enabled if needed for monitoring
}

export function getTooltipMetrics() {
  return {
    tooltipsShown: tooltipShownCount
  }
}

export function resetTooltipMetrics(): void {
  tooltipShownCount = 0
}
