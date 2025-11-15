"use client"

import { useCallback, useMemo } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { createComponentItem, isComponent, type CanvasItem, type ComponentType } from "@/types/canvas-items"

interface UseComponentCreationHandlerOptions {
  canvasState: CanvasViewportState
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
}

export function useComponentCreationHandler({
  canvasState,
  canvasItems,
  setCanvasItems,
}: UseComponentCreationHandlerOptions) {
  const handleAddComponent = useCallback(
    (type: ComponentType | string, position?: { x: number; y: number }) => {
      if (!type) {
        return
      }

      console.log("[Canvas] handleAddComponent called with type:", type, "position:", position)

      const viewportCenter =
        typeof window === "undefined"
          ? { x: 0, y: 0 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 }

      const worldX = (-canvasState.translateX + viewportCenter.x) / canvasState.zoom
      const worldY = (-canvasState.translateY + viewportCenter.y) / canvasState.zoom

      const defaultWorldPosition = {
        x: worldX - 175,
        y: worldY - 150,
      }

      const finalPosition = position ?? defaultWorldPosition
      const stickyScreenPosition =
        position ??
        {
          x: viewportCenter.x - 175,
          y: viewportCenter.y - 150,
        }

      const componentPosition = type === "sticky-note" ? stickyScreenPosition : finalPosition

      console.log("[Canvas] Creating component at position:", componentPosition)

      const newComponent = createComponentItem(type as ComponentType, componentPosition)

      console.log("[Canvas] Created component:", newComponent)
      console.log("[Canvas] Adding to canvasItems")
      setCanvasItems(prev => [...prev, newComponent])
    },
    [canvasState.translateX, canvasState.translateY, canvasState.zoom, setCanvasItems],
  )

  const handleComponentClose = useCallback(
    (id: string) => {
      setCanvasItems(prev => prev.filter(item => item.id !== id))
    },
    [setCanvasItems],
  )

  const handleComponentPositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setCanvasItems(prev => prev.map(item => (item.id === id ? { ...item, position } : item)))
    },
    [setCanvasItems],
  )

  const componentItems = useMemo(() => canvasItems.filter(isComponent), [canvasItems])

  const stickyNoteItems = useMemo(
    () => componentItems.filter(item => item.componentType === "sticky-note"),
    [componentItems],
  )

  const floatingComponents = useMemo(
    () => componentItems.filter(item => item.componentType !== "sticky-note"),
    [componentItems],
  )

  return {
    handleAddComponent,
    handleComponentClose,
    handleComponentPositionChange,
    componentItems,
    stickyNoteItems,
    floatingComponents,
  }
}
