"use client"

import { useState, useCallback } from "react"

import { useStickyOverlay } from "@/lib/hooks/annotation/use-sticky-overlay"

export function useStickyOverlayElement() {
  const [stickyOverlayEl, setStickyOverlayEl] = useState<HTMLElement | null>(null)

  const handleMount = useCallback((overlay: HTMLDivElement) => {
    setStickyOverlayEl(overlay)
  }, [])

  const handleUnmount = useCallback(() => {
    setStickyOverlayEl(null)
  }, [])

  useStickyOverlay(handleMount, handleUnmount)

  return stickyOverlayEl
}
