import { useEffect } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"

export type UseOverlayDragHandlersOptions = {
  draggingPopup: string | null
  onDragMove: (event: MouseEvent, layerContext: LayerContextValue | null) => void
  onDragEnd: () => void
  layerContext: LayerContextValue | null
}

export function useOverlayDragHandlers({
  draggingPopup,
  onDragMove,
  onDragEnd,
  layerContext,
}: UseOverlayDragHandlersOptions) {
  useEffect(() => {
    if (!draggingPopup) return

    const handleGlobalMouseMove = (event: MouseEvent) => {
      onDragMove(event, layerContext)
    }

    const handleGlobalMouseUp = () => {
      onDragEnd()
    }

    document.addEventListener("mousemove", handleGlobalMouseMove, true)
    document.addEventListener("mouseup", handleGlobalMouseUp, true)

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove, true)
      document.removeEventListener("mouseup", handleGlobalMouseUp, true)
    }
  }, [draggingPopup, onDragEnd, onDragMove, layerContext])

  return Boolean(draggingPopup)
}
