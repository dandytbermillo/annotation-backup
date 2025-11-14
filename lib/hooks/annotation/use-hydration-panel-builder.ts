"use client"

import { useCallback } from "react"
import type { MutableRefObject } from "react"

import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { worldToScreen } from "@/lib/canvas/coordinate-utils"
import { createPanelItem, type CanvasItem, type PanelType } from "@/types/canvas-items"
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
