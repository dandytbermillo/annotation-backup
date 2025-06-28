"use client"

import { useEffect, type RefObject } from "react"
import { useCanvas } from "@/components/canvas/canvas-context"

export function usePanelDragging(panelRef: RefObject<HTMLDivElement>, panelId: string) {
  const { state, dispatch, dataStore } = useCanvas()

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const header = panel.querySelector(".panel-header") as HTMLElement
    if (!header) return

    let isDragging = false
    let dragStartX = 0
    let dragStartY = 0
    let panelStartX = 0
    let panelStartY = 0

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return

      e.preventDefault()

      const deltaX = (e.clientX - dragStartX) / state.canvasState.zoom
      const deltaY = (e.clientY - dragStartY) / state.canvasState.zoom

      const newX = panelStartX + deltaX
      const newY = panelStartY + deltaY

      panel.style.left = newX + "px"
      panel.style.top = newY + "px"

      // Update position in data store
      dataStore.update(panelId, {
        position: { x: newX, y: newY },
      })
    }

    const handleMouseUp = () => {
      if (!isDragging) return

      isDragging = false
      panel.classList.remove("dragging")
      document.body.classList.remove("select-none")

      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as Element).closest(".panel-close")) return

      isDragging = true
      dragStartX = e.clientX
      dragStartY = e.clientY

      const branch = dataStore.get(panelId)
      panelStartX = branch.position.x
      panelStartY = branch.position.y

      panel.classList.add("dragging")
      document.body.classList.add("select-none")

      dispatch({
        type: "UPDATE_PANEL_Z_INDEX",
        payload: state.panelZIndex + 1,
      })

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)

      e.preventDefault()
      e.stopPropagation()
    }

    header.addEventListener("mousedown", handleMouseDown)

    return () => {
      header.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [panelId, state.canvasState.zoom, state.panelZIndex, dispatch, dataStore, panelRef])
}
