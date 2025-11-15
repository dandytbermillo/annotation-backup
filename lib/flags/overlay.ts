const OVERLAY_OPTIMISTIC_FLAG = (process.env.NEXT_PUBLIC_OVERLAY_OPTIMISTIC_HYDRATE ?? "disabled").toLowerCase()

const ENABLED_VALUES = new Set(["enabled", "true", "1", "on"])

export function isOverlayOptimisticHydrationEnabled(): boolean {
  let flag = OVERLAY_OPTIMISTIC_FLAG

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_OVERLAY_OPTIMISTIC_HYDRATE")
      if (stored) {
        flag = stored.toLowerCase()
      }
    } catch {
      // Ignore storage access issues; fall back to env flag.
    }
  }

  return ENABLED_VALUES.has(flag)
}
