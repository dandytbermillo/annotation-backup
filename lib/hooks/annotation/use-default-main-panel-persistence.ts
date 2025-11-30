"use client"

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react"

import type { CanvasItem } from "@/types/canvas-items"
import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import type { DataStore } from "@/lib/data-store"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { worldToScreen } from "@/lib/canvas/coordinate-utils"
import { getDefaultMainPosition, isDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { debugLog } from "@/lib/utils/debug-logger"

type Point = { x: number; y: number }

type PersistPanelCreateArgs = {
  panelId: string
  storeKey?: string
  type: "editor" | "branch" | "context" | "toolbar" | "annotation"
  position: Point
  size: { width: number; height: number }
  zIndex?: number
  state?: string
  title?: string
  metadata?: Record<string, any>
}

type UseDefaultMainPanelPersistenceOptions = {
  noteId: string
  hydrationStatus: HydrationStatus
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  workspaceMainPosition: Point | null
  canvasStateRef: MutableRefObject<{ translateX: number; translateY: number; zoom: number }>
  getPanelDimensions: (panelId: string) => { width: number; height: number }
  persistPanelCreate: (panel: PersistPanelCreateArgs) => Promise<void>
  dataStore: DataStore
  updateMainPosition: (noteId: string, position: Point) => Promise<void>
  mainPanelSeededRef: MutableRefObject<boolean>
}

function isDefaultOffscreenPosition(position: Point | null | undefined) {
  if (!position) return true
  return isDefaultMainPosition(position)
}

export function useDefaultMainPanelPersistence({
  noteId,
  hydrationStatus,
  canvasItems,
  setCanvasItems,
  getItemNoteId,
  workspaceMainPosition,
  canvasStateRef,
  getPanelDimensions,
  persistPanelCreate,
  dataStore,
  updateMainPosition,
  mainPanelSeededRef,
}: UseDefaultMainPanelPersistenceOptions) {
  useEffect(() => {
    // FIX: Guard against empty noteId during transitional states
    // (cold start, workspace switches when primaryNoteId is null and noteIds is empty)
    // Without this guard, persistPanelCreate is called with noteId:"" which causes
    // API 400 errors and queues bad operations to IndexedDB that retry forever.
    if (!noteId) {
      return
    }

    if (!hydrationStatus.success) return

    const hasMainPanel = hydrationStatus.panels.some(panel => panel.id === "main")
    if (hasMainPanel || mainPanelSeededRef.current) {
      return
    }

    debugLog({
      component: "AnnotationCanvas",
      action: "persisting_default_main_panel",
      metadata: { noteId },
    })

    const viewportWidth =
      typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1920
    const viewportHeight =
      typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 1080
    const cameraState = canvasStateRef.current

    const mainPanelItem = canvasItems.find(item => {
      if (item.itemType === "panel" && item.panelId === "main") {
        const itemNoteId = getItemNoteId(item)
        return itemNoteId === noteId
      }
      return false
    })

    const screenDimensions = getPanelDimensions("main")
    const worldPanelWidth = screenDimensions.width / cameraState.zoom
    const worldPanelHeight = screenDimensions.height / cameraState.zoom

    const screenCenterX = viewportWidth / 2
    const screenCenterY = viewportHeight / 2
    const worldCenterX = screenCenterX / cameraState.zoom - cameraState.translateX
    const worldCenterY = screenCenterY / cameraState.zoom - cameraState.translateY

    const centeredPosition = {
      x: worldCenterX - worldPanelWidth / 2,
      y: worldCenterY - worldPanelHeight / 2,
    }

    const existingMainPanelPosition =
      mainPanelItem?.position && !isDefaultOffscreenPosition(mainPanelItem.position)
        ? mainPanelItem.position
        : null
    const workspacePosition =
      workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)
        ? workspaceMainPosition
        : null

    const mainPosition = existingMainPanelPosition || workspacePosition || centeredPosition
    const defaultMainPosition = getDefaultMainPosition()

    debugLog({
      component: "AnnotationCanvas",
      action: "NEW_NOTE_MAIN_POSITION_DETERMINED",
      metadata: {
        noteId,
        mainPanelItem_position: mainPanelItem?.position,
        workspaceMainPosition,
        defaultMainPosition,
        centeredPosition,
        currentViewport: {
          x: cameraState.translateX,
          y: cameraState.translateY,
          zoom: cameraState.zoom,
        },
        finalMainPosition: mainPosition,
      },
    })

    console.log("[NEW NOTE] Main panel position determined:", {
      "from canvasItems": mainPanelItem?.position,
      "from workspace": workspaceMainPosition,
      "default (offscreen)": defaultMainPosition,
      "calculated centered": centeredPosition,
      "current viewport": { x: cameraState.translateX, y: cameraState.translateY },
      "FINAL POSITION USED": mainPosition,
    })

    if (!mainPanelItem?.position || isDefaultOffscreenPosition(mainPanelItem.position)) {
      const currentPosition = mainPanelItem?.position
      if (!currentPosition || currentPosition.x !== mainPosition.x || currentPosition.y !== mainPosition.y) {
        setCanvasItems(prev =>
          prev.map(item => {
            const itemNoteId = getItemNoteId(item)
            if (item.itemType === "panel" && item.panelId === "main" && itemNoteId === noteId) {
              return { ...item, position: mainPosition }
            }
            return item
          }),
        )
        debugLog({
          component: "AnnotationCanvas",
          action: "NEW_NOTE_CANVAS_POSITION_UPDATED",
          metadata: { noteId, mainPosition },
        })
      }
    }

    const cameraForConversion = {
      x: cameraState.translateX,
      y: cameraState.translateY,
    }
    const screenPosition = worldToScreen(mainPosition, cameraForConversion, cameraState.zoom)

    const mainStoreKey = ensurePanelKey(noteId, "main")
    const mainBranch = dataStore.get(mainStoreKey)
    const resolvedTitle =
      (mainBranch && typeof mainBranch.title === "string" && mainBranch.title.trim().length > 0
        ? mainBranch.title
        : mainPanelItem?.title) ?? undefined

    const seedReason = existingMainPanelPosition
      ? "existing_position"
      : workspacePosition
        ? "workspace_position"
        : "centered_position"

    debugLog({
      component: "AnnotationCanvas",
      action: "workspace_main_panel_seeded",
      metadata: {
        noteId,
        seedReason,
        screenDimensions,
        worldPanelSize: { width: worldPanelWidth, height: worldPanelHeight },
        mainPosition,
        viewport: {
          translateX: cameraState.translateX,
          translateY: cameraState.translateY,
          zoom: cameraState.zoom,
        },
      },
    })

    persistPanelCreate({
      panelId: "main",
      storeKey: ensurePanelKey(noteId, "main"),
      type: "editor",
      position: screenPosition,
      size: { width: screenDimensions.width, height: screenDimensions.height },
      zIndex: 0,
      title: resolvedTitle,
      metadata: { annotationType: "main" },
    }).catch(err => {
      debugLog({
        component: "AnnotationCanvas",
        action: "main_panel_persist_failed",
        metadata: { error: err instanceof Error ? err.message : "Unknown error" },
      })
    })

    void updateMainPosition(noteId, mainPosition).catch(err => {
      debugLog({
        component: "AnnotationCanvas",
        action: "workspace_main_position_update_failed",
        metadata: { error: err instanceof Error ? err.message : "Unknown error", noteId },
      })
    })

    mainPanelSeededRef.current = true
  }, [
    canvasItems,
    canvasStateRef,
    dataStore,
    getItemNoteId,
    getPanelDimensions,
    hydrationStatus.panels,
    hydrationStatus.success,
    mainPanelSeededRef,
    noteId,
    persistPanelCreate,
    setCanvasItems,
    updateMainPosition,
    workspaceMainPosition,
  ])
}
