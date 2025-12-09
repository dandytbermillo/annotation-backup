/**
 * Pinned Entries Feature Flags
 * Part of State Preservation Feature - Phase 1
 *
 * Controls rollout of the Pinned Entries feature that allows users to keep
 * entry dashboards and workspaces mounted when switching between entries.
 */

const PINNED_ENTRIES_FLAG = (
  process.env.NEXT_PUBLIC_PINNED_ENTRIES ?? "0"
).toLowerCase()

const ENABLED_VALUES = new Set(["enabled", "true", "1", "on"])

/**
 * Check if the Pinned Entries feature is enabled.
 *
 * Can be controlled via:
 * - Environment variable: NEXT_PUBLIC_PINNED_ENTRIES=1
 * - localStorage override: NEXT_PUBLIC_PINNED_ENTRIES=1
 */
export function isPinnedEntriesFeatureEnabled(): boolean {
  let flag = PINNED_ENTRIES_FLAG

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_PINNED_ENTRIES")
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
 * Get the maximum number of pinned entries allowed.
 * Default: 3
 *
 * Can be controlled via:
 * - Environment variable: NEXT_PUBLIC_PINNED_ENTRIES_MAX=5
 * - localStorage override: NEXT_PUBLIC_PINNED_ENTRIES_MAX=5
 */
export function getPinnedEntriesMax(): number {
  let maxStr = process.env.NEXT_PUBLIC_PINNED_ENTRIES_MAX ?? "3"

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_PINNED_ENTRIES_MAX")
      if (stored) {
        maxStr = stored
      }
    } catch {
      // ignore storage access issues
    }
  }

  const parsed = parseInt(maxStr, 10)
  return isNaN(parsed) ? 3 : Math.max(1, Math.min(10, parsed)) // Clamp between 1-10
}

/**
 * Get the maximum number of pinned workspaces per entry.
 * Default: 2
 *
 * Can be controlled via:
 * - Environment variable: NEXT_PUBLIC_PINNED_WORKSPACES_PER_ENTRY_MAX=3
 * - localStorage override: NEXT_PUBLIC_PINNED_WORKSPACES_PER_ENTRY_MAX=3
 */
export function getPinnedWorkspacesPerEntryMax(): number {
  let maxStr = process.env.NEXT_PUBLIC_PINNED_WORKSPACES_PER_ENTRY_MAX ?? "2"

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_PINNED_WORKSPACES_PER_ENTRY_MAX")
      if (stored) {
        maxStr = stored
      }
    } catch {
      // ignore storage access issues
    }
  }

  const parsed = parseInt(maxStr, 10)
  return isNaN(parsed) ? 2 : Math.max(1, Math.min(10, parsed)) // Clamp between 1-10
}
