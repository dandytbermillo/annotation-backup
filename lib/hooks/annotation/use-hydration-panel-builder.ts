"use client"

import { useCallback, useRef } from "react"
import type { MutableRefObject, Dispatch, SetStateAction } from "react"

import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { worldToScreen } from "@/lib/canvas/coordinate-utils"
import { createPanelItem, type CanvasItem, type PanelType, isPanel } from "@/types/canvas-items"
import { debugLog } from "@/lib/utils/debug-logger"

export type HydrationPanelBuildRequest = {
  targetNoteId: string
  hydrationStatus: HydrationStatus
  skipHydration: boolean
  isInitialHydration: boolean
  isSameNote: boolean
  mainPanelExists: boolean
}

export type HydrationPanelBuildResult = {
  newItems: CanvasItem[]
  hydratedPanelIds: string[]
  totalPanels: number
  currentNotePanels: number
  mode: "skip_existing_panel" | "initial_restore" | "same_note_refresh" | "note_switch"
}

type UseHydrationPanelBuilderOptions = {
  mainOnlyNoteSet: Set<string>
  canvasStateRef: MutableRefObject<{ translateX: number; translateY: number; zoom: number }>
}

export function useHydrationPanelBuilder({
  mainOnlyNoteSet,
  canvasStateRef,
}: UseHydrationPanelBuilderOptions) {
  return useCallback(
    ({
      targetNoteId,
      hydrationStatus,
      skipHydration,
      isInitialHydration,
      isSameNote,
      mainPanelExists,
    }: HydrationPanelBuildRequest): HydrationPanelBuildResult | null => {
      const currentNotePanels = hydrationStatus.panels.filter(panel => {
        const parsed = panel.id.includes("::") ? parsePanelKey(panel.id) : null
        const panelNoteId = panel.noteId || parsed?.noteId || targetNoteId
        const isCurrentNote = panelNoteId === targetNoteId
        const isActive = (panel.state ?? "active") === "active"
        return isCurrentNote && isActive
      })

      const mode: HydrationPanelBuildResult["mode"] = skipHydration
        ? "skip_existing_panel"
        : isInitialHydration
          ? "initial_restore"
          : isSameNote
            ? "same_note_refresh"
            : "note_switch"

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
          mode,
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
        return null
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
          const screenPosition = worldToScreen(panel.position, camera, canvasStateRef.current.zoom)

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

      return {
        newItems,
        hydratedPanelIds: panelsToHydrate.map(panel => panel.id),
        totalPanels: hydrationStatus.panels.length,
        currentNotePanels: currentNotePanels.length,
        mode,
      }
    },
    [mainOnlyNoteSet, canvasStateRef],
  )
}

function getNoteIdFromStoreKey(storeKey?: string): string | null {
  if (!storeKey) return null
  const parsed = parsePanelKey(storeKey)
  return parsed?.noteId ?? null
}

type UseHydrationPanelMergeOptions = {
  getItemNoteId: (item: CanvasItem) => string | null
}

type HydrationPanelMergeInput = {
  prevItems: CanvasItem[]
  newItems: CanvasItem[]
  targetNoteId: string
}

type HydrationPanelMergeResult = {
  itemsToAdd: CanvasItem[]
  nextItems: CanvasItem[]
}

export function useHydrationPanelMerge({ getItemNoteId }: UseHydrationPanelMergeOptions) {
  return useCallback(
    ({ prevItems, newItems, targetNoteId }: HydrationPanelMergeInput): HydrationPanelMergeResult => {
      if (newItems.length === 0) {
        return { itemsToAdd: [], nextItems: prevItems }
      }

      const existingStoreKeys = new Set(
        prevItems
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

      const itemsToAdd: CanvasItem[] = []

      newItems.forEach(item => {
        const key =
          item.storeKey ?? ensurePanelKey(item.noteId ?? targetNoteId, item.panelId ?? "main")

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
          return
        }

        existingStoreKeys.add(key)
        itemsToAdd.push(item)
      })

      const nextItems = itemsToAdd.length > 0 ? [...prevItems, ...itemsToAdd] : prevItems
      return { itemsToAdd, nextItems }
    },
    [getItemNoteId],
  )
}

type UseHydrationDispatchOptions = {
  dispatch: Dispatch<any>
  workspaceSeededNotesRef: MutableRefObject<Set<string>>
  getItemNoteId: (item: CanvasItem) => string | null
}

type HydrationDispatchInput = {
  itemsToAdd: CanvasItem[]
  workspaceMainPosition: { x: number; y: number } | null
  mainPanelExists: boolean
  targetNoteId: string
  initialCanvasSetupRef: MutableRefObject<boolean>
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
}

export function useHydrationDispatcher({
  dispatch,
  workspaceSeededNotesRef,
  getItemNoteId,
}: UseHydrationDispatchOptions) {
  return useCallback(
    ({
      itemsToAdd,
      workspaceMainPosition,
      mainPanelExists,
      targetNoteId,
      initialCanvasSetupRef,
      setCanvasItems,
    }: HydrationDispatchInput) => {
      itemsToAdd.forEach(item => {
        if (isPanel(item)) {
          const panelKey = item.storeKey ?? ensurePanelKey(item.noteId ?? targetNoteId, item.panelId ?? "main")
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
              const itemNoteId = item.noteId || getNoteIdFromStoreKey(item.storeKey) || getItemNoteId(item)
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
    },
    [dispatch, workspaceSeededNotesRef, getItemNoteId],
  )
}

type HydrationGateInput = {
  targetNoteId: string
  hydrationStatus: HydrationStatus | null
  mainPanelExists: boolean
}

type HydrationGateResult = {
  shouldHydrate: boolean
  isInitialHydration: boolean
  isSameNote: boolean
  skipHydration: boolean
}

export function useHydrationNoteTracker() {
  const hydratedNotesRef = useRef<Set<string>>(new Set())
  const lastHydratedNoteRef = useRef<string | null>(null)

  const evaluateHydration = useCallback(
    ({ targetNoteId, hydrationStatus, mainPanelExists }: HydrationGateInput): HydrationGateResult => {
      if (!hydrationStatus?.success || hydrationStatus.panels.length === 0) {
        return {
          shouldHydrate: false,
          isInitialHydration: true,
          isSameNote: false,
          skipHydration: false,
        }
      }

      const isInitialHydration = !hydratedNotesRef.current.has(targetNoteId)
      const isSameNote = lastHydratedNoteRef.current === targetNoteId
      const skipHydration = !isInitialHydration && mainPanelExists

      if (!isInitialHydration) {
        debugLog({
          component: "AnnotationCanvas",
          action: "skip_already_hydrated_note",
          metadata: {
            noteId: targetNoteId,
            reason: "note_marked_hydrated",
          },
        })
        return {
          shouldHydrate: false,
          isInitialHydration,
          isSameNote,
          skipHydration,
        }
      }

      return {
        shouldHydrate: true,
        isInitialHydration,
        isSameNote,
        skipHydration,
      }
    },
    [],
  )

  const markHydrated = useCallback((targetNoteId: string) => {
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
  }, [])

  const markNoPanels = useCallback((targetNoteId: string, skipHydration: boolean) => {
    if (!skipHydration) {
      lastHydratedNoteRef.current = targetNoteId
    }
  }, [])

  // Clear hydrated notes when workspace changes - allows re-hydration with new workspace positions
  const clearHydratedNotes = useCallback(() => {
    debugLog({
      component: "AnnotationCanvas",
      action: "clearing_hydrated_notes",
      metadata: {
        previousCount: hydratedNotesRef.current.size,
        previousNotes: Array.from(hydratedNotesRef.current),
      },
    })
    hydratedNotesRef.current.clear()
    lastHydratedNoteRef.current = null
  }, [])

  return {
    evaluateHydration,
    markHydrated,
    markNoPanels,
    clearHydratedNotes,
  }
}

type FreshNoteNotifierOptions = {
  freshNoteSet: Set<string>
  onFreshNoteHydrated?: (noteId: string) => void
}

export function useFreshNoteNotifier({ freshNoteSet, onFreshNoteHydrated }: FreshNoteNotifierOptions) {
  return useCallback(
    (noteId: string) => {
      if (!freshNoteSet.has(noteId)) {
        return
      }

      debugLog({
        component: "AnnotationCanvas",
        action: "fresh_note_hydrated",
        metadata: { noteId },
      })

      queueMicrotask(() => {
        onFreshNoteHydrated?.(noteId)
      })
    },
    [freshNoteSet, onFreshNoteHydrated],
  )
}
