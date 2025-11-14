"use client"

import { useEffect } from "react"

type UseCanvasDragListenersOptions = {
  isDragging: boolean
  onMouseMove: (event: MouseEvent) => void
  onMouseUp: (event: MouseEvent) => void
}

export function useCanvasDragListeners({
  isDragging,
  onMouseMove,
  onMouseUp,
}: UseCanvasDragListenersOptions) {
  useEffect(() => {
    if (typeof document === "undefined") return

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)

    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isDragging, onMouseMove, onMouseUp])
}
