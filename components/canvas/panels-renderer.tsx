"use client"

import { memo, useEffect, useRef } from "react"

import { CanvasPanel } from "@/components/canvas/canvas-panel"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { getDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { UnifiedProvider } from "@/lib/provider-switcher"
import type { DataStore } from "@/lib/data-store"
import { isPlainModeActive } from "@/lib/collab-mode"
import { debugLog, isDebugEnabled } from "@/lib/utils/debug-logger"
import { isPanel, type CanvasItem } from "@/types/canvas-items"

interface PanelsRendererProps {
  defaultNoteId: string
  canvasItems: CanvasItem[]
  dataStore: DataStore
  onClose: (id: string, noteId?: string) => void
  resolveWorkspacePosition?: (noteId: string) => { x: number; y: number } | null
  onRestorePanelPosition?: (noteId: string, position: { x: number; y: number }) => void
  hydrationReady?: boolean
  noteTitleMap?: Map<string, string> | null
  primaryNoteId?: string // Add primary note ID to identify which note is being hydrated
}

export const PanelsRenderer = memo(function PanelsRenderer({
  defaultNoteId,
  canvasItems,
  dataStore,
  onClose,
  resolveWorkspacePosition,
  onRestorePanelPosition,
  hydrationReady = true,
  noteTitleMap = null,
  primaryNoteId,
}: PanelsRendererProps) {
  const isPlainMode = isPlainModeActive()
  const seenStoreKeys = new Set<string>()

  // DEBUG: Track hydrationReady changes
  const prevHydrationReadyRef = useRef(hydrationReady)
  const prevCanvasItemsCountRef = useRef(canvasItems.length)

  useEffect(() => {
    if (prevHydrationReadyRef.current !== hydrationReady) {
      void debugLog({
        component: "PanelsRenderer",
        action: "hydration_ready_changed",
        metadata: {
          previousValue: prevHydrationReadyRef.current,
          newValue: hydrationReady,
          canvasItemsCount: canvasItems.length,
        },
      })
      prevHydrationReadyRef.current = hydrationReady
    }

    if (prevCanvasItemsCountRef.current !== canvasItems.length) {
      const panels = canvasItems.filter(isPanel)
      void debugLog({
        component: "PanelsRenderer",
        action: "canvas_items_count_changed",
        metadata: {
          previousCount: prevCanvasItemsCountRef.current,
          newCount: canvasItems.length,
          panelsCount: panels.length,
          panelIds: panels.map(p => p.panelId),
          hydrationReady,
        },
      })
      prevCanvasItemsCountRef.current = canvasItems.length
    }
  }, [hydrationReady, canvasItems])

  const provider = UnifiedProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(defaultNoteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null

  const panels = canvasItems.filter(isPanel)

  // DEBUG: Log panels being rendered
  void debugLog({
    component: "PanelsRenderer",
    action: "rendering_panels_list",
    metadata: {
      hydrationReady,
      totalCanvasItems: canvasItems.length,
      totalPanels: panels.length,
      panelIds: panels.map(p => p.panelId),
    },
  })

  return (
    <>
      {panels.map(panel => {
        const panelId = panel.panelId!
        const panelNoteId = panel.noteId ?? defaultNoteId
        const storeKey = panel.storeKey ?? ensurePanelKey(panelNoteId, panelId)
        const branch = isPlainMode ? dataStore.get(storeKey) : branchesMap?.get(storeKey)
        if (!branch) {
          console.warn(
            `[PanelsRenderer] Branch ${panelId} (note=${panelNoteId}, storeKey=${storeKey}) not found in ${
              isPlainMode ? "plain" : "yjs"
            } store`,
          )
          return null
        }

        if (seenStoreKeys.has(storeKey)) {
          console.warn("[PanelsRenderer] Duplicate store key detected; skipping render", {
            panelId,
            panelNoteId,
            storeKey,
          })
          return null
        }
        seenStoreKeys.add(storeKey)

        if (isDebugEnabled()) {
          void debugLog({
            component: "AnnotationCanvas",
            action: "rendering_panel",
            metadata: {
              panelId,
              branchType: branch.type,
              branchDbType: branch.dbType,
              branchMetadata: branch.metadata,
              isPlainMode,
            },
          })

          console.log(`[PanelsRenderer] Rendering panel ${panelId}:`, {
            hasContent: !!branch.content,
            contentLength: typeof branch.content === "string" ? branch.content.length : "N/A",
            isNew: branch.isNew,
            isEditable: branch.isEditable,
          })
        }

        // Only hide panels if they belong to the PRIMARY note that's being hydrated
        // AND only during initial hydration (when panel doesn't exist yet in canvasItems)
        // This prevents panels from other notes from flickering when the primary note changes
        // But allows panels to show when switching back to a workspace (they already exist in state)
        const isPrimaryNote = primaryNoteId ? panelNoteId === primaryNoteId : true
        const panelExistsInState = canvasItems.some(
          item => item.itemType === "panel" && item.panelId === panelId && (item.noteId ?? '') === panelNoteId
        )
        const shouldHidePanel = !hydrationReady && panelId !== "main" && isPrimaryNote && !panelExistsInState

        if (shouldHidePanel) {
          void debugLog({
            component: "PanelsRenderer",
            action: "panel_hidden_not_hydrated",
            metadata: {
              panelId,
              panelNoteId,
              primaryNoteId,
              hydrationReady,
              isPrimaryNote,
              panelExistsInState,
              reason: "hydration_not_ready_for_primary_note_initial_load",
            },
          })
          return null
        }

        const workspacePosition =
          panelId === "main" ? resolveWorkspacePosition?.(panelNoteId) ?? null : null
        const position = workspacePosition ?? branch.position ?? getDefaultMainPosition()

        void debugLog({
          component: "AnnotationCanvas",
          action: "panel_position_resolution",
          metadata: {
            panelId,
            panelNoteId,
            branchPosition: branch.position,
            workspacePosition,
            finalPosition: position,
          },
        })

        const shouldOfferRestore =
          panelId === "main" &&
          workspacePosition &&
          (Math.round(workspacePosition.x) !== Math.round(position.x) ||
            Math.round(workspacePosition.y) !== Math.round(position.y))

        return (
          <CanvasPanel
            key={storeKey}
            panelId={panelId}
            branch={branch}
            position={position}
            noteId={panelNoteId}
            onClose={() => onClose(panelId, panelNoteId)}
            canRestorePosition={Boolean(shouldOfferRestore)}
            onRestorePosition={
              shouldOfferRestore && workspacePosition && onRestorePanelPosition
                ? () => onRestorePanelPosition(panelNoteId, workspacePosition)
                : undefined
            }
            titleOverride={panelId === "main" ? noteTitleMap?.get(panelNoteId) ?? null : null}
          />
        )
      })}
    </>
  )
})
