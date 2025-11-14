"use client"

import { useCallback } from "react"

import { debugLog } from "@/lib/utils/debug-logger"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { isPanel } from "@/types/canvas-items"

type UsePanelCloseHandlerOptions = {
  noteId: string
  setCanvasItems: React.Dispatch<React.SetStateAction<any[]>>
  getItemNoteId: (item: any) => string | null
  dataStore: { get: (key: string) => any; update: (key: string, payload: any) => void }
  branchesMap?: Map<string, any>
  layerManager: { getNode: (id: string) => any; removeNode: (id: string) => void }
  dispatch: (action: { type: string; payload?: any }) => void
  persistPanelUpdate: (payload: { panelId: string; storeKey: string; state: string; expectedRevision?: string }) => Promise<void>
  closeNote: (noteId: string, options?: { persist?: boolean }) => Promise<void>
}

export function usePanelCloseHandler({
  noteId,
  setCanvasItems,
  getItemNoteId,
  dataStore,
  branchesMap,
  layerManager,
  dispatch,
  persistPanelUpdate,
  closeNote,
}: UsePanelCloseHandlerOptions) {
  return useCallback(
    (panelId: string, panelNoteId?: string) => {
      let storeKeyToDelete: string | undefined
      const closedAt = new Date().toISOString()

      debugLog({
        component: "AnnotationCanvas",
        action: "panel_close_start",
        metadata: {
          panelId,
          panelNoteId,
          currentNoteId: noteId,
        },
      })

      setCanvasItems(prev => {
        const filtered = prev.filter(item => {
          if (isPanel(item) && item.panelId === panelId) {
            const itemNoteId = getItemNoteId(item) || panelNoteId
            if (!panelNoteId || itemNoteId === panelNoteId) {
              storeKeyToDelete = item.storeKey ?? (itemNoteId ? ensurePanelKey(itemNoteId, panelId) : undefined)
              debugLog({
                component: "AnnotationCanvas",
                action: "panel_removed_from_items",
                metadata: { panelId, itemNoteId, storeKey: item.storeKey, storeKeyToDelete, position: item.position },
              })
              return false
            }
          }
          return true
        })

        debugLog({
          component: "AnnotationCanvas",
          action: "panel_close_items_updated",
          metadata: {
            panelId,
            beforeCount: prev.length,
            afterCount: filtered.length,
            removedCount: prev.length - filtered.length,
          },
        })

        return filtered
      })

      const targetNoteId = panelNoteId || noteId
      if (!targetNoteId) {
        console.warn("[AnnotationCanvas] Cannot close panel without note id", panelId)
        return
      }

      const storeKey = storeKeyToDelete ?? ensurePanelKey(targetNoteId, panelId)
      const existingPanelData = dataStore.get(storeKey)
      const existingRevision = existingPanelData?.revisionToken
      const parentId = existingPanelData?.parentId

      if (existingPanelData) {
        dataStore.update(storeKey, { state: "closed", closedAt })
        debugLog({
          component: "AnnotationCanvas",
          action: "panel_state_marked_closed",
          metadata: { panelId, noteId: targetNoteId, storeKey, parentId, revisionToken: existingRevision },
        })
      }

      if (branchesMap?.has(storeKey)) {
        const branchData = branchesMap.get(storeKey)
        branchesMap.set(storeKey, { ...branchData, state: "closed", closedAt })
      }

      const removeBranchReference = (ownerNoteId: string, ownerPanelId: string) => {
        const ownerKey = ensurePanelKey(ownerNoteId, ownerPanelId)
        const ownerData = dataStore.get(ownerKey)
        if (ownerData?.branches?.length) {
          const filtered = ownerData.branches.filter((childId: string) => childId !== panelId)
          if (filtered.length !== ownerData.branches.length) {
            dataStore.update(ownerKey, { branches: filtered })
          }
        }

        if (branchesMap?.has(ownerKey)) {
          const ownerBranch = branchesMap.get(ownerKey)
          const ownerBranches = ownerBranch?.branches
          if (Array.isArray(ownerBranches)) {
            const filtered = ownerBranches.filter((childId: string) => childId !== panelId)
            if (filtered.length !== ownerBranches.length) {
              branchesMap.set(ownerKey, { ...ownerBranch, branches: filtered })
            }
          }
        }
      }

      if (panelId !== "main") {
        removeBranchReference(targetNoteId, "main")
        if (parentId && parentId !== "main") {
          removeBranchReference(targetNoteId, parentId)
        }
      }

      if (layerManager.getNode(storeKey)) {
        layerManager.removeNode(storeKey)
      }

      dispatch({
        type: "REMOVE_PANEL",
        payload: { id: storeKey },
      })

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(`note-data-${targetNoteId}:invalidated`, Date.now().toString())
        } catch (error) {
          console.warn("[AnnotationCanvas] Failed to mark snapshot tombstone", error)
        }
      }

      if (panelId === "main") {
        closeNote(targetNoteId, { persist: true }).catch(error => {
          console.warn("[AnnotationCanvas] Failed to persist workspace close", error)
        })
      }

      persistPanelUpdate({
        panelId,
        storeKey,
        state: "closed",
        expectedRevision: existingRevision,
      }).catch(err => {
        debugLog({
          component: "AnnotationCanvas",
          action: "panel_close_state_persist_failed",
          metadata: {
            panelId,
            noteId: targetNoteId,
            error: err instanceof Error ? err.message : "Unknown error",
          },
        })
      })
    },
    [noteId, setCanvasItems, getItemNoteId, dataStore, branchesMap, layerManager, dispatch, persistPanelUpdate, closeNote],
  )
}
