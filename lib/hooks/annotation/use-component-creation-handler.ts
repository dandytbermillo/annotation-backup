"use client"

import { useCallback, useMemo } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { createComponentItem, isComponent, type CanvasItem, type ComponentType } from "@/types/canvas-items"
import type { LayerManager } from "@/lib/canvas/layer-manager"
import { markComponentPersistencePending, markComponentPersistenceReady } from "@/lib/note-workspaces/state"
import { debugLog } from "@/lib/utils/debug-logger"
import { removeRuntimeComponent, markComponentDeleted } from "@/lib/workspace/runtime-manager"

interface UseComponentCreationHandlerOptions {
  canvasState: CanvasViewportState
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  layerManager?: LayerManager | null
  onComponentChange?: () => void
  workspaceId?: string | null
  /** Callback when a component is deleted - use to clear caches */
  onComponentDeleted?: (workspaceId: string, componentId: string) => void
}

export function useComponentCreationHandler({
  canvasState,
  canvasItems,
  setCanvasItems,
  layerManager,
  onComponentChange,
  workspaceId,
  onComponentDeleted,
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

      // FIX 17 DEBUG: Log component addition with workspace context
      debugLog({
        component: "ComponentCreation",
        action: "CREATING_COMPONENT",
        metadata: {
          workspaceId: workspaceKey ?? "unknown",
          componentId: newComponent.id,
          componentType: type,
          position: componentPosition,
        },
      })

      if (workspaceKey) {
        markComponentPersistencePending(workspaceKey, newComponent.id)
      }
      setCanvasItems(prev => {
        // FIX 17 DEBUG: Log the actual state before and after
        debugLog({
          component: "ComponentCreation",
          action: "ADDING_TO_CANVAS_ITEMS",
          metadata: {
            workspaceId: workspaceKey ?? "unknown",
            componentId: newComponent.id,
            prevItemCount: prev.length,
            prevComponentCount: prev.filter(i => i.itemType === "component").length,
            prevComponentIds: prev.filter(i => i.itemType === "component").map(c => c.id),
          },
        })
        return [...prev, newComponent]
      })
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
      // Phase 4: Mark as deleted FIRST to prevent fallback resurrection
      // This must happen before any other cleanup
      if (workspaceKey) {
        markComponentDeleted(workspaceKey, id)
        // Clear from caches to prevent hydration loop trying to restore deleted components
        onComponentDeleted?.(workspaceKey, id)
      }

      // Phase 4: Remove from runtime ledger
      if (workspaceKey) {
        removeRuntimeComponent(workspaceKey, id)
      }

      // Phase 4: Remove from LayerManager to prevent canvas fallback from re-rendering
      if (layerMgr) {
        try {
          layerMgr.removeNode(id)
        } catch {
          // Ignore - node may not exist
        }
      }

      // Log the removal
      debugLog({
        component: "ComponentCreation",
        action: "REMOVING_COMPONENT",
        metadata: {
          workspaceId: workspaceKey ?? "unknown",
          componentId: id,
          removedFromLayerManager: !!layerMgr,
        },
      })

      // Remove from canvas items
      setCanvasItems(prev => prev.filter(item => item.id !== id))
      onComponentChange?.()
    },
    [setCanvasItems, onComponentChange, workspaceKey, layerMgr, onComponentDeleted],
  )

  const handleComponentPositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setCanvasItems(prev => prev.map(item => (item.id === id ? { ...item, position } : item)))
      onComponentChange?.()
    },
    [setCanvasItems, onComponentChange],
  )

  const handleComponentStateChange = useCallback(
    (id: string, componentState: any) => {
      setCanvasItems(prev => prev.map(item => (item.id === id ? { ...item, componentState } : item)))
      // Note: We don't call onComponentChange here to avoid excessive saves during state updates
      // State is persisted in canvasItems and will be saved with the next position change or workspace save
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
    handleComponentStateChange,
    componentItems,
    stickyNoteItems,
    floatingComponents,
  }
}
