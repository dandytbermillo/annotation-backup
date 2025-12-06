"use client"

import { useCallback } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import type { CanvasItem } from "@/types/canvas-items"
import {
  useHydrationPanelBuilder,
  useHydrationPanelMerge,
  useHydrationDispatcher,
  useHydrationNoteTracker,
  useFreshNoteNotifier,
} from "@/lib/hooks/annotation/use-hydration-panel-builder"

type UseCanvasHydrationSyncOptions = {
  noteId: string
  hydrationStatus: HydrationStatus | null
  canvasItems: CanvasItem[]
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  resolveWorkspacePosition: (noteId: string) => { x: number; y: number } | null
  canvasStateRef: MutableRefObject<{
    translateX: number
    translateY: number
    zoom: number
  }>
  mainOnlyNoteSet: Set<string>
  dispatch: Dispatch<any>
  workspaceSeededNotesRef: MutableRefObject<Set<string>>
  initialCanvasSetupRef: MutableRefObject<boolean>
  freshNoteSet: Set<string>
  onFreshNoteHydrated?: (noteId: string) => void
}

export function useCanvasHydrationSync({
  noteId,
  hydrationStatus,
  canvasItems,
  setCanvasItems,
  getItemNoteId,
  resolveWorkspacePosition,
  canvasStateRef,
  mainOnlyNoteSet,
  dispatch,
  workspaceSeededNotesRef,
  initialCanvasSetupRef,
  freshNoteSet,
  onFreshNoteHydrated,
}: UseCanvasHydrationSyncOptions) {
  const buildHydratedPanels = useHydrationPanelBuilder({
    mainOnlyNoteSet,
    canvasStateRef,
  })

  const mergeHydratedPanels = useHydrationPanelMerge({ getItemNoteId })
  const dispatchHydratedPanels = useHydrationDispatcher({
    dispatch,
    workspaceSeededNotesRef,
    getItemNoteId,
  })
  const { evaluateHydration, markHydrated, markNoPanels, clearHydratedNotes } = useHydrationNoteTracker()
  const notifyFreshNoteHydrated = useFreshNoteNotifier({
    freshNoteSet,
    onFreshNoteHydrated,
  })

  const handleNoteHydration = useCallback(
    (targetNoteId: string, statusOverride?: HydrationStatus | null) => {
      const appliedStatus = statusOverride ?? hydrationStatus
      const workspaceMainForTarget = resolveWorkspacePosition(targetNoteId)
      const mainPanelExists = canvasItems.some(
        item => item.itemType === "panel" && item.panelId === "main" && getItemNoteId(item) === targetNoteId,
      )

      const { shouldHydrate, isInitialHydration, isSameNote, skipHydration } = evaluateHydration({
        targetNoteId,
        hydrationStatus: appliedStatus,
        mainPanelExists,
      })

      if (!shouldHydrate || !appliedStatus) {
        return
      }

      const buildResult = buildHydratedPanels({
        targetNoteId,
        hydrationStatus: appliedStatus,
        skipHydration,
        isInitialHydration,
        isSameNote,
        mainPanelExists,
      })

      if (!buildResult) {
        markNoPanels(targetNoteId, skipHydration)
        return
      }

      const { newItems } = buildResult

      setCanvasItems(prev => {
        const { itemsToAdd, nextItems } = mergeHydratedPanels({
          prevItems: prev,
          newItems,
          targetNoteId,
        })

        if (itemsToAdd.length > 0) {
          return nextItems
        }

        return prev
      })

      dispatchHydratedPanels({
        itemsToAdd: newItems,
        workspaceMainPosition: workspaceMainForTarget,
        mainPanelExists,
        targetNoteId,
        initialCanvasSetupRef,
        setCanvasItems,
      })

      markHydrated(targetNoteId)
      notifyFreshNoteHydrated(targetNoteId)
    },
    [
      buildHydratedPanels,
      canvasItems,
      dispatchHydratedPanels,
      evaluateHydration,
      mergeHydratedPanels,
      notifyFreshNoteHydrated,
      resolveWorkspacePosition,
      setCanvasItems,
      markHydrated,
      markNoPanels,
      hydrationStatus,
      getItemNoteId,
    ],
  )

  return { handleNoteHydration, clearHydratedNotes }
}
