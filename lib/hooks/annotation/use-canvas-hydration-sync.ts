"use client"

import { useCallback, useEffect, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { worldToScreen } from "@/lib/canvas/coordinate-utils"
import { createPanelItem, isPanel, type CanvasItem, type PanelType } from "@/types/canvas-items"
import { debugLog } from "@/lib/utils/debug-logger"
import type { DataStore } from "@/lib/data-store"

type UseCanvasHydrationSyncOptions = {
  noteId: string
  primaryHydrationStatus: HydrationStatus
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  resolveWorkspacePosition: (noteId: string) => { x: number; y: number } | null
  canvasState: CanvasViewportState
  canvasStateRef: MutableRefObject<CanvasViewportState>
  mainOnlyNoteSet: Set<string>
  persistPanelCreate: (input: {
    panelId: string
    storeKey?: string
    type: "editor" | "branch" | "context" | "toolbar" | "annotation"
    position: { x: number; y: number }
    size: { width: number; height: number }
    zIndex?: number
    state?: string
    title?: string
    metadata?: Record<string, unknown>
    coordinateSpace?: "screen" | "world"
  }) => Promise<void>
  workspaceMainPosition: { x: number; y: number } | null
  updateMainPosition: (noteId: string, position: { x: number; y: number }) => Promise<void>
  workspaceSeededNotesRef: MutableRefObject<Set<string>>
  mainPanelSeededRef: MutableRefObject<boolean>
  initialCanvasSetupRef: MutableRefObject<boolean>
  freshNoteSet: Set<string>
  onFreshNoteHydrated?: (noteId: string) => void
  dataStore: DataStore
  dispatch: Dispatch<any>
  getPanelDimensions: (panelId: string) => { width: number; height: number }
  isStateLoaded: boolean
}

export function useCanvasHydrationSync({
  noteId,
  primaryHydrationStatus,
  canvasItems,
  setCanvasItems,
  getItemNoteId,
  resolveWorkspacePosition,
  canvasState,
  canvasStateRef,
  mainOnlyNoteSet,
  persistPanelCreate,
  workspaceMainPosition,
  updateMainPosition,
  workspaceSeededNotesRef,
  mainPanelSeededRef,
  initialCanvasSetupRef,
  freshNoteSet,
  onFreshNoteHydrated,
  dataStore,
  dispatch,
  getPanelDimensions,
  isStateLoaded,
}: UseCanvasHydrationSyncOptions) {
  const hydratedNotesRef = useRef<Set<string>>(new Set())
  const lastHydratedNoteRef = useRef<string | null>(null)
  const pendingHydrationsRef = useRef<Map<string, HydrationStatus>>(new Map())

  const handleNoteHydration = useCallback(
    (targetNoteId: string, hydrationStatus: HydrationStatus) => {
      if (!hydrationStatus) {
        pendingHydrationsRef.current.delete(targetNoteId)
        return
      }

      if (!isStateLoaded) {
        pendingHydrationsRef.current.set(targetNoteId, hydrationStatus)
        debugLog({
          component: "AnnotationCanvas",
          action: "defer_hydration_until_state_loaded",
          metadata: {
            noteId: targetNoteId,
            pending: hydrationStatus.panels.length,
          },
        })
        return
      }

      if (!hydrationStatus?.success || hydrationStatus.panels.length === 0) {
        pendingHydrationsRef.current.delete(targetNoteId)
        return
      }

      if (hydratedNotesRef.current.has(targetNoteId)) {
        debugLog({
          component: "AnnotationCanvas",
          action: "skip_already_hydrated_note",
          metadata: {
            noteId: targetNoteId,
            reason: "note_marked_hydrated",
          },
        })
        return
      }

      const workspaceMain = resolveWorkspacePosition(targetNoteId)
      const isInitialHydration = !hydratedNotesRef.current.has(targetNoteId)
      const isSameNote = lastHydratedNoteRef.current === targetNoteId
      const mainPanelExists = canvasItems.some(
        item =>
          item.itemType === "panel" &&
          item.panelId === "main" &&
          getItemNoteId(item) === targetNoteId,
      )
      const skipHydration = !isInitialHydration && mainPanelExists

      const currentNotePanels = hydrationStatus.panels.filter(panel => {
        const parsed = panel.id.includes("::") ? parsePanelKey(panel.id) : null
        const panelNoteId = panel.noteId || parsed?.noteId || targetNoteId
        const isCurrentNote = panelNoteId === targetNoteId
        const isActive = (panel.state ?? "active") === "active"
        return isCurrentNote && isActive
      })

      const panelsToHydrate = skipHydration
        ? []
        : isInitialHydration || !isSameNote
          ? isInitialHydration
            ? currentNotePanels
            : currentNotePanels.filter(panel => panel.id === "main")
          : currentNotePanels.filter(panel => panel.id === "main")

      debugLog({
        component: "AnnotationCanvas",
        action: "creating_canvas_items_from_hydration",
        metadata: {
          totalPanels: hydrationStatus.panels.length,
          currentNotePanels: currentNotePanels.length,
          noteId: targetNoteId,
          panelsHydrated: panelsToHydrate.map(panel => panel.id),
          mode: skipHydration
            ? "skip_existing_panel"
            : isInitialHydration
              ? "initial_restore"
              : isSameNote
                ? "same_note_refresh"
                : "note_switch",
        },
      })

      if (panelsToHydrate.length === 0) {
        debugLog({
          component: "AnnotationCanvas",
          action: "skipping_hydration_no_panels",
          metadata: {
            reason: skipHydration ? "skip_existing_panel" : "no_panels_to_hydrate",
            isInitialHydration,
            mainPanelExists,
            noteId: targetNoteId,
          },
        })
        if (!skipHydration) {
          lastHydratedNoteRef.current = targetNoteId
        }
        return
      }

      const newItems = panelsToHydrate
        .map(panel => {
          const panelType = (panel.metadata?.annotationType as PanelType) || "note"
          const parsedId = panel.id.includes("::") ? parsePanelKey(panel.id) : null
          const hydratedNoteId = panel.noteId || parsedId?.noteId || targetNoteId
          const hydratedPanelId = parsedId?.panelId || panel.id
          const storeKey = ensurePanelKey(hydratedNoteId, hydratedPanelId)
          const camera = {
            x: canvasStateRef.current.translateX,
            y: canvasStateRef.current.translateY,
          }
          const screenPosition = worldToScreen(
            panel.position,
            camera,
            canvasStateRef.current.zoom,
          )

          if (mainOnlyNoteSet.has(hydratedNoteId) && hydratedPanelId !== "main") {
            debugLog({
              component: "AnnotationCanvas",
              action: "HYDRATION_SKIPPED_BRANCH_MAIN_ONLY",
              metadata: {
                noteId: hydratedNoteId,
                panelId: hydratedPanelId,
              },
            })
            return null
          }

          debugLog({
            component: "AnnotationCanvas",
            action: "world_to_screen_conversion",
            metadata: {
              panelId: panel.id,
              worldPosition: panel.position,
              camera,
              zoom: canvasStateRef.current.zoom,
              screenPosition,
              noteId: hydratedNoteId,
            },
            content_preview: `Panel ${panel.id}: world(${panel.position.x}, ${panel.position.y}) → screen(${screenPosition.x}, ${screenPosition.y})`,
          })

          return createPanelItem(
            hydratedPanelId,
            screenPosition,
            panelType,
            hydratedNoteId,
            storeKey,
          )
        })
        .filter((panel): panel is CanvasItem => Boolean(panel))

      setCanvasItems(prev => {
        const existingStoreKeys = new Set(
          prev
            .filter(item => item.itemType === "panel")
            .map(item => {
              if (item.storeKey) {
                return item.storeKey
              }
              const resolvedNoteId = getItemNoteId(item) ?? targetNoteId
              const resolvedPanelId = item.panelId ?? "main"
              return ensurePanelKey(resolvedNoteId, resolvedPanelId)
            }),
        )

        const itemsToAdd = newItems.filter(item => {
          const key =
            item.storeKey ??
            ensurePanelKey(item.noteId ?? targetNoteId, item.panelId ?? "main")
          if (existingStoreKeys.has(key)) {
            debugLog({
              component: "AnnotationCanvas",
              action: "HYDRATION_SKIPPED_DUPLICATE",
              metadata: {
                noteId: targetNoteId,
                panelId: item.panelId,
                storeKey: key,
                reason: "panel_already_exists_in_canvas",
              },
            })
            return false
          }
          existingStoreKeys.add(key)
          return true
        })

        if (itemsToAdd.length > 0) {
          debugLog({
            component: "AnnotationCanvas",
            action: "HYDRATION_ADDING_PANELS",
            metadata: {
              noteId: targetNoteId,
              addedCount: itemsToAdd.length,
              totalItems: prev.length + itemsToAdd.length,
              addedPanels: itemsToAdd.map(p => ({
                panelId: p.panelId,
                position: p.position,
                noteId: p.noteId,
              })),
            },
          })
          return [...prev, ...itemsToAdd]
        }

        return prev
      })

      newItems.forEach(item => {
        if (isPanel(item)) {
          const panelKey =
            item.storeKey ?? ensurePanelKey(item.noteId ?? targetNoteId, item.panelId ?? "main")
          dispatch({
            type: "ADD_PANEL",
            payload: {
              id: panelKey,
              panel: { element: null, branchId: item.panelId },
            },
          })
          debugLog({
            component: "AnnotationCanvas",
            action: "added_hydrated_panel_to_state",
            metadata: {
              panelId: item.panelId,
              noteId: item.noteId,
              compositeKey: panelKey,
            },
            content_preview: `Added hydrated panel ${panelKey} to state.panels for connection lines`,
          })
        }
      })

      if (!initialCanvasSetupRef.current && workspaceMainPosition && !mainPanelExists) {
        setCanvasItems(prev =>
          prev.map(item => {
            if (item.itemType === "panel" && item.panelId === "main") {
              const itemNoteId = getItemNoteId(item)
              if (itemNoteId === targetNoteId) {
                return { ...item, position: workspaceMainPosition }
              }
            }
            return item
          }),
        )
        workspaceSeededNotesRef.current.add(targetNoteId)
        debugLog({
          component: "AnnotationCanvas",
          action: "workspace_seed_applied_during_hydration",
          metadata: {
            noteId: targetNoteId,
            seedPosition: workspaceMainPosition,
            seededNotes: Array.from(workspaceSeededNotesRef.current),
          },
        })
      }

      hydratedNotesRef.current.add(targetNoteId)
      lastHydratedNoteRef.current = targetNoteId

      debugLog({
        component: "AnnotationCanvas",
        action: "marked_note_as_hydrated",
        metadata: {
          noteId: targetNoteId,
          totalHydratedNotes: hydratedNotesRef.current.size,
          hydratedNotes: Array.from(hydratedNotesRef.current),
        },
      })

      if (freshNoteSet.has(targetNoteId)) {
        debugLog({
          component: "AnnotationCanvas",
          action: "fresh_note_hydrated",
          metadata: { noteId: targetNoteId },
        })
        queueMicrotask(() => {
          onFreshNoteHydrated?.(targetNoteId)
        })
      }

      const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1920
      const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 1080
      const panelDimensions = getPanelDimensions("main")
      const worldPanelWidth = panelDimensions.width / canvasState.zoom
      const worldPanelHeight = panelDimensions.height / canvasState.zoom
      const mainPosition = workspaceMainPosition ?? workspaceMain ?? {
        x:
          (-canvasState.translateX + viewportWidth / 2 - worldPanelWidth / 2) /
          canvasState.zoom,
        y:
          (-canvasState.translateY + viewportHeight / 2 - worldPanelHeight / 2) /
          canvasState.zoom,
      }
      const screenPosition = worldToScreen(
        mainPosition,
        { x: canvasState.translateX, y: canvasState.translateY },
        canvasState.zoom,
      )

      const mainStoreKey = ensurePanelKey(targetNoteId, "main")
      const mainBranch = dataStore.get(mainStoreKey)
      const resolvedTitle =
        (mainBranch &&
          typeof mainBranch.title === "string" &&
          mainBranch.title.trim().length > 0
          ? mainBranch.title
          : undefined)

      persistPanelCreate({
        panelId: "main",
        storeKey: mainStoreKey,
        type: "editor",
        position: screenPosition,
        size: panelDimensions,
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

      void updateMainPosition(targetNoteId, mainPosition).catch(err => {
        debugLog({
          component: "AnnotationCanvas",
          action: "workspace_main_position_update_failed",
          metadata: {
            error: err instanceof Error ? err.message : "Unknown error",
            noteId: targetNoteId,
          },
        })
      })

      mainPanelSeededRef.current = true
    },
    [
      canvasItems,
      canvasState,
      canvasStateRef,
      dataStore,
      dispatch,
      freshNoteSet,
      getItemNoteId,
      getPanelDimensions,
      mainOnlyNoteSet,
      noteId,
      onFreshNoteHydrated,
      persistPanelCreate,
      resolveWorkspacePosition,
      setCanvasItems,
      updateMainPosition,
      workspaceMainPosition,
      workspaceSeededNotesRef,
      initialCanvasSetupRef,
      mainPanelSeededRef,
      isStateLoaded,
    ],
  )

  useEffect(() => {
    if (!noteId) return
    handleNoteHydration(noteId, primaryHydrationStatus)
  }, [noteId, primaryHydrationStatus, handleNoteHydration])

  useEffect(() => {
    if (!isStateLoaded) {
      return
    }
    const pending = pendingHydrationsRef.current.get(noteId)
    if (pending) {
      handleNoteHydration(noteId, pending)
      pendingHydrationsRef.current.delete(noteId)
    }
  }, [isStateLoaded, noteId, handleNoteHydration])

  return { handleNoteHydration }
}
