"use client"

import { useMemo, useCallback } from "react"

import type { CanvasDedupeWarning } from "@/lib/canvas/dedupe-canvas-items"

interface UseDedupeWarningBannerOptions {
  dedupeWarnings: CanvasDedupeWarning[]
  updateDedupeWarnings: (incoming: CanvasDedupeWarning[], options?: { append?: boolean }) => void
}

export function useDedupeWarningBanner({
  dedupeWarnings,
  updateDedupeWarnings,
}: UseDedupeWarningBannerOptions) {
  const dismissWarnings = useCallback(() => {
    updateDedupeWarnings([], { append: false })
  }, [updateDedupeWarnings])

  const visibleWarnings = useMemo(() => dedupeWarnings.slice(0, 5), [dedupeWarnings])
  const extraCount = Math.max(0, dedupeWarnings.length - visibleWarnings.length)

  return {
    hasWarnings: dedupeWarnings.length > 0,
    visibleWarnings,
    extraCount,
    dismissWarnings,
  }
}
