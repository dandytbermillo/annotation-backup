/**
 * Dashboard Feature Flags
 * Part of Dashboard Implementation - Phase 5.2
 *
 * Controls rollout of the Home Dashboard (Entry + Workspace Hierarchy) feature.
 */

const NOTE_HOME_DASHBOARD_FLAG = (
  process.env.NEXT_PUBLIC_NOTE_HOME_DASHBOARD ?? "0"
).toLowerCase()

const ENABLED_VALUES = new Set(["enabled", "true", "1", "on"])

/**
 * Check if the Home Dashboard feature is enabled.
 *
 * Can be controlled via:
 * - Environment variable: NEXT_PUBLIC_NOTE_HOME_DASHBOARD=1
 * - localStorage override: NEXT_PUBLIC_NOTE_HOME_DASHBOARD=1
 */
export function isHomeDashboardEnabled(): boolean {
  let flag = NOTE_HOME_DASHBOARD_FLAG

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_NOTE_HOME_DASHBOARD")
      if (stored) {
        flag = stored.toLowerCase()
      }
    } catch {
      // ignore storage access issues
    }
  }

  return ENABLED_VALUES.has(flag)
}

/**
 * Check if dashboard telemetry is enabled.
 * Defaults to enabled when dashboard is enabled.
 */
export function isDashboardTelemetryEnabled(): boolean {
  if (!isHomeDashboardEnabled()) return false

  const telemetryFlag = (
    process.env.NEXT_PUBLIC_DASHBOARD_TELEMETRY ?? "1"
  ).toLowerCase()

  return ENABLED_VALUES.has(telemetryFlag)
}
