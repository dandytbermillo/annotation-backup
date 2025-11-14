"use client"

import { useEffect } from "react"

export function useStickyOverlay(onMount?: (element: HTMLDivElement) => void, onUnmount?: () => void) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const overlay = document.createElement("div")
    overlay.id = "sticky-note-overlay-root"
    overlay.style.position = "fixed"
    overlay.style.inset = "0"
    overlay.style.pointerEvents = "none"
    overlay.style.zIndex = "12000"
    overlay.style.display = "block"

    document.body.appendChild(overlay)
    onMount?.(overlay)

    return () => {
      document.body.removeChild(overlay)
      onUnmount?.()
    }
  }, [onMount, onUnmount])
}
