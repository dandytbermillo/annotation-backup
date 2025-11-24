"use client"

import { useCallback, useMemo } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { createComponentItem, isComponent, type CanvasItem, type ComponentType } from "@/types/canvas-items"
import type { LayerManager } from "@/lib/canvas/layer-manager"
import { markComponentPersistencePending, markComponentPersistenceReady } from "@/lib/note-workspaces/state"

interface UseComponentCreationHandlerOptions {
  canvasState: CanvasViewportState
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  layerManager?: LayerManager | null
  onComponentChange?: () => void
  workspaceId?: string | null
}

export function useComponentCreationHandler({
  canvasState,
  canvasItems,
  setCanvasItems,
  layerManager,
  onComponentChange,
  workspaceId,
}: UseComponentCreationHandlerOptions) {
  const layerMgr = layerManager ?? null
  const workspaceKey = workspaceId ?? null

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
      if (workspaceKey) {
        markComponentPersistencePending(workspaceKey, newComponent.id)
      }
      setCanvasItems(prev => [...prev, newComponent])
      if (layerMgr) {
        try {
          layerMgr.registerNode({
            id: newComponent.id,
            type: "component",
            position: newComponent.position ?? undefined,
            zIndex: typeof newComponent.zIndex === "number" ? newComponent.zIndex : undefined,
            metadata: {
              ...(newComponent as any).metadata,
              componentType: newComponent.componentType ?? (newComponent as any).type ?? "component",
            },
            dimensions: (newComponent as any).size ?? undefined,
          } as any)
        } catch {
          // ignore layer registration errors
        }
      }
      onComponentChange?.()
      if (workspaceKey) {
        const complete = () => markComponentPersistenceReady(workspaceKey, newComponent.id)
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(complete)
        } else {
          setTimeout(complete, 0)
        }
      }
    },
    [
      canvasState.translateX,
      canvasState.translateY,
      canvasState.zoom,
      layerMgr,
      setCanvasItems,
      onComponentChange,
      workspaceKey,
    ],
  )

  const handleComponentClose = useCallback(
    (id: string) => {
      setCanvasItems(prev => prev.filter(item => item.id !== id))
      onComponentChange?.()
    },
    [setCanvasItems, onComponentChange],
  )

  const handleComponentPositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setCanvasItems(prev => prev.map(item => (item.id === id ? { ...item, position } : item)))
      onComponentChange?.()
    },
    [setCanvasItems, onComponentChange],
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
