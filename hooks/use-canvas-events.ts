"use client"

import { useEffect, type RefObject } from "react"
import { useCanvas } from "@/components/canvas/canvas-context"

export function useCanvasEvents(containerRef: RefObject<HTMLDivElement>) {
  const { state, dispatch } = useCanvas()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const startDrag = (e: MouseEvent) => {
      if (e.target && (e.target as Element).closest(".panel") && !(e.target as Element).closest(".panel-header")) return

      dispatch({
        type: "SET_CANVAS_STATE",
        payload: {
          isDragging: true,
          lastMouseX: e.clientX,
          lastMouseY: e.clientY,
        },
      })

      container.classList.add("dragging")
      document.body.classList.add("select-none")
      e.preventDefault()
    }

    const drag = (e: MouseEvent) => {
      if (!state.canvasState.isDragging) return

      e.preventDefault()

      const deltaX = e.clientX - state.canvasState.lastMouseX
      const deltaY = e.clientY - state.canvasState.lastMouseY

      dispatch({
        type: "SET_CANVAS_STATE",
        payload: {
          translateX: state.canvasState.translateX + deltaX,
          translateY: state.canvasState.translateY + deltaY,
          lastMouseX: e.clientX,
          lastMouseY: e.clientY,
        },
      })
    }

    const endDrag = () => {
      dispatch({
        type: "SET_CANVAS_STATE",
        payload: { isDragging: false },
      })

      container.classList.remove("dragging")
      document.body.classList.remove("select-none")
    }

    const handleZoom = (e: WheelEvent) => {
      e.preventDefault()

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.3, Math.min(2, state.canvasState.zoom * zoomFactor))

      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const zoomChange = newZoom / state.canvasState.zoom
      const newTranslateX = mouseX - (mouseX - state.canvasState.translateX) * zoomChange
      const newTranslateY = mouseY - (mouseY - state.canvasState.translateY) * zoomChange

      dispatch({
        type: "SET_CANVAS_STATE",
        payload: {
          zoom: newZoom,
          translateX: newTranslateX,
          translateY: newTranslateY,
        },
      })
    }

    container.addEventListener("mousedown", startDrag)
    document.addEventListener("mousemove", drag)
    document.addEventListener("mouseup", endDrag)
    container.addEventListener("wheel", handleZoom)
    container.addEventListener("contextmenu", (e) => e.preventDefault())

    return () => {
      container.removeEventListener("mousedown", startDrag)
      document.removeEventListener("mousemove", drag)
      document.removeEventListener("mouseup", endDrag)
      container.removeEventListener("wheel", handleZoom)
      container.removeEventListener("contextmenu", (e) => e.preventDefault())
    }
  }, [state.canvasState, dispatch, containerRef])
}
