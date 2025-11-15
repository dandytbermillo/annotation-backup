"use client"

import { memo } from "react"

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
}

export const PanelsRenderer = memo(function PanelsRenderer({
  defaultNoteId,
  canvasItems,
  dataStore,
  onClose,
  resolveWorkspacePosition,
  onRestorePanelPosition,
}: PanelsRendererProps) {
  const isPlainMode = isPlainModeActive()
  const seenStoreKeys = new Set<string>()

  const provider = UnifiedProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(defaultNoteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null

  const panels = canvasItems.filter(isPanel)

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
          />
        )
      })}
    </>
  )
})
