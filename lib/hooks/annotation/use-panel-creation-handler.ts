"use client"

import { useCallback } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { screenToWorld } from "@/lib/canvas/coordinate-utils"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import type { DataStore } from "@/lib/data-store"
import { isPlainModeActive } from "@/lib/collab-mode"
import { debugLog, isDebugEnabled } from "@/lib/utils/debug-logger"
import { createPanelItem, isPanel, type CanvasItem, type PanelType } from "@/types/canvas-items"
import type { PanelUpdateData } from "@/lib/hooks/use-panel-persistence"
import { markPanelPersistencePending, markPanelPersistenceReady } from "@/lib/note-workspaces/state"

type PersistPanelCreateArgs = {
  panelId: string
  storeKey?: string
  type: "editor" | "branch" | "context" | "toolbar" | "annotation"
  position: { x: number; y: number }
  size: { width: number; height: number }
  zIndex?: number
  state?: string
  title?: string
  metadata?: Record<string, any>
  coordinateSpace?: "screen" | "world"
}

type PersistPanelCreate = (panelData: PersistPanelCreateArgs) => Promise<void>
type PersistPanelUpdate = (update: PanelUpdateData) => Promise<void>

interface UsePanelCreationHandlerOptions {
  noteId: string
  canvasState: CanvasViewportState
  getItemNoteId: (item: CanvasItem) => string | null
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  dataStore: DataStore
  branchesMap: Map<string, any> | null
  provider: {
    setCurrentNote: (noteId: string) => void
    getBranchesMap: () => Map<string, any>
  } | null
  persistPanelCreate: PersistPanelCreate
  persistPanelUpdate: PersistPanelUpdate
}

export function usePanelCreationHandler({
  noteId,
  canvasState,
  getItemNoteId,
  setCanvasItems,
  dataStore,
  branchesMap,
  provider,
  persistPanelCreate,
  persistPanelUpdate,
}: UsePanelCreationHandlerOptions) {
  const emitPanelDebug = useCallback(
    (
      panelId: string,
      targetNoteId: string,
      action: string,
      metadata: Record<string, unknown> = {},
    ) => {
      void debugLog({
        component: "AnnotationCanvas",
        action,
        metadata: {
          panelId,
          noteId: targetNoteId,
          ...metadata,
        },
      })
    },
    [],
  )

  const handleCreatePanel = useCallback(
    (
      panelId: string,
      parentPanelId?: string,
      parentPosition?: { x: number; y: number },
      sourceNoteId?: string,
      isPreview?: boolean,
      coordinateSpace?: "screen" | "world",
    ) => {
      const targetNoteId = sourceNoteId || noteId
      if (!targetNoteId) {
        console.warn("[AnnotationCanvas] Cannot create panel without target note id", panelId)
        return
      }

      if (isDebugEnabled()) {
        void debugLog({
          component: "AnnotationCanvas",
          action: "handle_create_panel",
          metadata: {
            panelId,
            parentPanelId,
            parentPosition,
            isPlainMode: isPlainModeActive(),
            noteId: targetNoteId,
          },
          content_preview: `Creating panel ${panelId} at x=${parentPosition?.x}, y=${parentPosition?.y}`,
          note_id: targetNoteId,
        }).catch(() => {})
      }

      const isPlainMode = isPlainModeActive()

      setCanvasItems(prevItems => {
        const newPanelStoreKey = ensurePanelKey(targetNoteId, panelId)

        if (isDebugEnabled()) {
          void debugLog({
            component: "AnnotationCanvas",
            action: "create_panel_check_existing",
            metadata: {
              panelId,
              targetNoteId,
              newPanelStoreKey,
              currentCanvasItemsCount: prevItems.length,
              panelIdsInItems: prevItems.filter(isPanel).map(item => ({ panelId: item.panelId, noteId: getItemNoteId(item) })),
            },
            content_preview: `Checking if panel ${panelId} already exists in ${prevItems.length} items`,
          }).catch(() => {})
        }

        const existingPanel = prevItems.some(
          item => isPanel(item) && item.panelId === panelId && getItemNoteId(item) === targetNoteId,
        )

        if (existingPanel) {
          void debugLog({
            component: "AnnotationCanvas",
            action: "create_panel_early_return",
            metadata: {
              panelId,
              targetNoteId,
              reason: "Panel already exists in canvasItems",
            },
            content_preview: `EARLY RETURN: Panel ${panelId} already exists, not creating`,
          })
          return prevItems
        }

        void debugLog({
          component: "AnnotationCanvas",
          action: "create_panel_proceeding",
          metadata: {
            panelId,
            targetNoteId,
            isPlainMode: isPlainModeActive(),
          },
          content_preview: `Proceeding to create panel ${panelId}`,
        })

        if (isPlainMode) {
          if (typeof window !== "undefined" && parentPosition) {
            const globalStore = (window as typeof window & { canvasDataStore?: DataStore }).canvasDataStore
            if (globalStore) {
              const existingPanelData = globalStore.get(newPanelStoreKey)
              if (!existingPanelData?.worldPosition) {
                const worldPosition =
                  coordinateSpace === "world"
                    ? parentPosition
                    : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)

                globalStore.update(newPanelStoreKey, {
                  id: panelId,
                  position: worldPosition,
                  worldPosition,
                })
              }
            }
          }
        } else if (provider) {
          provider.setCurrentNote(targetNoteId)
          const yjsBranches = provider.getBranchesMap()
          const panelData = yjsBranches.get(newPanelStoreKey)

          if (!panelData) {
            console.warn(`No data found for panel ${panelId} (note ${targetNoteId})`)
            return prevItems
          }

          if (parentPosition) {
            const worldPosition =
              coordinateSpace === "world"
                ? parentPosition
                : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)

            panelData.position = worldPosition
            yjsBranches.set(newPanelStoreKey, panelData)
          }
        }

        const hydratedStoreKey = newPanelStoreKey
        let branchData = dataStore?.get(hydratedStoreKey)
        if (!branchData && branchesMap) {
          branchData = branchesMap.get(hydratedStoreKey)
        }

        let panelType: PanelType
        if (panelId === "main") {
          panelType = "main"
        } else if (branchData?.type) {
          panelType = branchData.type as PanelType
        } else {
          panelType = panelId.includes("explore") ? "explore" : panelId.includes("promote") ? "promote" : "note"
        }

        const dbPanelType: "editor" | "branch" | "context" | "toolbar" | "annotation" =
          panelId === "main"
            ? "editor"
            : panelType === "explore"
              ? "context"
              : panelType === "promote"
                ? "annotation"
                : "branch"

        const position =
          isPreview && parentPosition
            ? parentPosition
            : branchData?.position || branchData?.worldPosition
              ? branchData.position || branchData.worldPosition
              : parentPosition
                ? coordinateSpace === "world"
                  ? parentPosition
                  : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)
                : { x: 2000, y: 1500 }

        let panelTitle: string | undefined
        if (panelType !== "main") {
          if (branchData?.preview) {
            panelTitle = branchData.preview
          } else if (branchData?.title) {
            panelTitle = branchData.title
          }
        } else {
          const mainStoreKey = ensurePanelKey(targetNoteId, "main")
          const mainBranch = dataStore.get(mainStoreKey)
          panelTitle =
            (mainBranch && typeof mainBranch.title === "string" && mainBranch.title.trim().length > 0
              ? mainBranch.title
              : undefined) ?? "Main"
        }

        const effectiveCoordinateSpace = coordinateSpace ?? (isPreview && parentPosition ? "screen" : "world")
        const persistencePosition =
          effectiveCoordinateSpace === "screen" && parentPosition ? parentPosition : position

        if (isPreview) {
          emitPanelDebug(panelId, targetNoteId, "panel_preview_event", {
            parentPanelId,
            hasParentPosition: Boolean(parentPosition),
          })
        }

        const defaultDimensions = { width: 500, height: 400 }
        const resolvedWorldPosition =
          effectiveCoordinateSpace === "world"
            ? persistencePosition
            : screenToWorld(
                persistencePosition,
                { x: canvasState.translateX, y: canvasState.translateY },
                canvasState.zoom,
              )

        if (!isPreview) {
          markPanelPersistencePending(targetNoteId, panelId)
        }

        const normalizedPanelRecord = {
          id: panelId,
          type: panelType,
          position: resolvedWorldPosition,
          worldPosition: resolvedWorldPosition,
          dimensions: defaultDimensions,
          worldSize: defaultDimensions,
          zIndex: 1,
          title: panelTitle,
          metadata: { annotationType: panelType },
        }

        if (dataStore) {
          const existing = dataStore.get(hydratedStoreKey)
          dataStore.set(hydratedStoreKey, existing ? { ...existing, ...normalizedPanelRecord } : normalizedPanelRecord)
        }
        if (branchesMap) {
          const existing = branchesMap.get(hydratedStoreKey)
          branchesMap.set(
            hydratedStoreKey,
            existing ? { ...existing, ...normalizedPanelRecord } : normalizedPanelRecord,
          )
        }
        if (!isPreview) {
          markPanelPersistenceReady(targetNoteId, panelId)
        }

        if (!isPreview) {
          emitPanelDebug(panelId, targetNoteId, "panel_persist_create_start")
          void persistPanelCreate({
            panelId,
            storeKey: hydratedStoreKey,
            type: dbPanelType,
            position: persistencePosition,
            size: { width: 500, height: 400 },
            zIndex: 1,
            title: panelTitle,
            metadata: { annotationType: panelType },
            coordinateSpace: effectiveCoordinateSpace,
          })
            .then(() => {
              emitPanelDebug(panelId, targetNoteId, "panel_persist_create_success")
            })
            .catch((error) => {
              debugLog({
                component: "AnnotationCanvas",
                action: "panel_create_persist_failed",
                metadata: {
                  panelId,
                  noteId: targetNoteId,
                  error: error instanceof Error ? error.message : "Unknown error",
                },
              })
            })

          emitPanelDebug(panelId, targetNoteId, "panel_persist_activate_start")
          void persistPanelUpdate({
            panelId,
            storeKey: hydratedStoreKey,
            position: persistencePosition,
            coordinateSpace: effectiveCoordinateSpace,
            state: "active",
          })
            .then(() => {
              emitPanelDebug(panelId, targetNoteId, "panel_persist_activate_success")
            })
            .catch((error) => {
              debugLog({
                component: "AnnotationCanvas",
                action: "panel_state_active_persist_failed",
                metadata: {
                  panelId,
                  noteId: targetNoteId,
                  error: error instanceof Error ? error.message : "Unknown error",
                },
              })
            })
        }

        const alreadyExists = prevItems.find(
          item => item.itemType === "panel" && item.panelId === panelId && getItemNoteId(item) === targetNoteId,
        )
        if (alreadyExists) {
          void debugLog({
            component: "AnnotationCanvas",
            action: "panel_already_exists",
            metadata: {
              panelId,
              noteId: targetNoteId,
              existingPosition: alreadyExists.position,
              requestedPosition: position,
            },
          })
          return prevItems
        }

        return [...prevItems, createPanelItem(panelId, position, panelType, targetNoteId, hydratedStoreKey)]
      })
    },
    [
      branchesMap,
      canvasState.translateX,
      canvasState.translateY,
      canvasState.zoom,
      dataStore,
      emitPanelDebug,
      getItemNoteId,
      noteId,
      persistPanelCreate,
      persistPanelUpdate,
      provider,
      setCanvasItems,
    ],
  )

  return { handleCreatePanel }
}
