"use client"

import { useEffect, useCallback, useRef } from "react"

import { createPanelItem } from "@/types/canvas-items"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { getDefaultMainPosition, isDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { debugLog } from "@/lib/utils/debug-logger"
import type { DataStore } from "@/lib/data-store"

import type { CanvasItem } from "@/types/canvas-items"

export function getStoredPanelPosition(
  dataStore: DataStore | null,
  branchesMap: Map<string, any> | null,
  targetNoteId: string | null | undefined,
  panelId: string | null | undefined,
) {
  if (!targetNoteId || !panelId) {
    return null
  }

  const storeKey = ensurePanelKey(targetNoteId, panelId)
  const stored = dataStore?.get(storeKey) ?? branchesMap?.get(storeKey)
  if (!stored) {
    return null
  }

  const worldPosition = stored.worldPosition ?? stored.position
  if (
    worldPosition &&
    typeof worldPosition.x === "number" &&
    typeof worldPosition.y === "number" &&
    Number.isFinite(worldPosition.x) &&
    Number.isFinite(worldPosition.y)
  ) {
    return { x: worldPosition.x, y: worldPosition.y }
  }

  return null
}

type UseCanvasNoteSyncOptions = {
  hasNotes: boolean
  noteIds: string[]
  noteId: string
  canvasItemsLength: number
  mainOnlyNoteSet: Set<string>
  freshNoteSeeds: Record<string, { x: number; y: number }>
  onConsumeFreshNoteSeed?: (noteId: string) => void
  setCanvasItems: React.Dispatch<React.SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
  resolveWorkspacePosition: (noteId: string) => { x: number; y: number } | null
  dataStore: DataStore | null
  branchesMap: Map<string, any> | null
  hydrationStateKey: number | string | boolean
  workspaceSnapshotRevision?: number
}

export function useCanvasNoteSync({
  hasNotes,
  noteIds,
  noteId,
  canvasItemsLength,
  mainOnlyNoteSet,
  freshNoteSeeds,
  onConsumeFreshNoteSeed,
  setCanvasItems,
  getItemNoteId,
  resolveWorkspacePosition,
  dataStore,
  branchesMap,
  hydrationStateKey,
  workspaceSnapshotRevision = 0,
}: UseCanvasNoteSyncOptions) {
  const lastSnapshotRevisionRef = useRef(workspaceSnapshotRevision)
  const resolveStoredPanelPosition = useCallback(
    (targetNoteId: string | null | undefined, panelId: string | null | undefined) =>
      getStoredPanelPosition(dataStore, branchesMap, targetNoteId, panelId),
    [dataStore, branchesMap],
  )
  useEffect(() => {
    const revisionChanged = lastSnapshotRevisionRef.current !== workspaceSnapshotRevision
    lastSnapshotRevisionRef.current = workspaceSnapshotRevision
    debugLog({
      component: "AnnotationCanvas",
      action: "noteIds_sync_effect_triggered",
      metadata: {
        hasNotes,
        noteIds,
        currentItemsCount: canvasItemsLength,
        currentNoteIdProp: noteId,
      },
    })

    if (!hasNotes) {
      setCanvasItems([])
      return
    }

    setCanvasItems(prev => {
      const allowedNoteIds = new Set(noteIds)
      if (revisionChanged) {
        prev.forEach(item => {
          const existingNoteId = getItemNoteId(item)
          if (existingNoteId) {
            allowedNoteIds.add(existingNoteId)
          }
        })
      }
      let changed = revisionChanged

      const mainByNote = new Map<string, CanvasItem>()
      const otherItems: CanvasItem[] = []

      const prevMainPanels = prev
        .filter(item => item.itemType === "panel" && item.panelId === "main")
        .map(item => ({
          noteId: getItemNoteId(item),
          position: item.position,
        }))

      prev.forEach(item => {
        if (item.itemType === "panel" && item.panelId === "main") {
          const itemNoteId = getItemNoteId(item)
          if (itemNoteId && allowedNoteIds.has(itemNoteId)) {
            mainByNote.set(itemNoteId, item)
          } else {
            changed = true
          }
          return
        }

        const itemNoteId = getItemNoteId(item)
        if (
          item.itemType === "panel" &&
          item.panelId !== "main" &&
          itemNoteId &&
          mainOnlyNoteSet.has(itemNoteId)
        ) {
          changed = true
          return
        }
        if (itemNoteId && !allowedNoteIds.has(itemNoteId)) {
          changed = true
          return
        }

        if (item.itemType === "panel" && item.panelId && itemNoteId) {
          const storedPosition = resolveStoredPanelPosition(itemNoteId, item.panelId)
          if (storedPosition) {
            const samePosition =
              item.position?.x === storedPosition.x && item.position?.y === storedPosition.y
            otherItems.push(
              samePosition
                ? item
                : {
                    ...item,
                    position: storedPosition,
                  },
            )
            if (!samePosition) {
              changed = true
            }
            return
          }
        }

        otherItems.push(item)
      })

      const nextMainItems: CanvasItem[] = []
      noteIds.forEach(id => {
        const existing = mainByNote.get(id)
        const targetStoreKey = ensurePanelKey(id, "main")

        if (existing) {
          const storedPosition = resolveStoredPanelPosition(id, "main")
          const nextPosition = storedPosition ?? existing.position
          const needsMetaUpdate =
            existing.noteId !== id ||
            existing.storeKey !== targetStoreKey ||
            (storedPosition !== null &&
              (existing.position?.x !== nextPosition?.x || existing.position?.y !== nextPosition?.y))

          if (needsMetaUpdate) {
            debugLog({
              component: "AnnotationCanvas",
              action: "noteIds_sync_updating_metadata_only",
              metadata: {
                noteId: id,
                existingNoteId: existing.noteId,
                existingPosition: existing.position,
                keepingPosition: storedPosition === null,
              },
            })

            nextMainItems.push({
              ...existing,
              position: nextPosition,
              noteId: id,
              storeKey: targetStoreKey,
            })
            changed = true
          } else {
            nextMainItems.push(existing)
          }
        } else {
          const seedPosition = freshNoteSeeds[id] ?? null
          const storedPosition = resolveStoredPanelPosition(id, "main")
          const targetPosition =
            seedPosition ??
            resolveWorkspacePosition(id) ??
            storedPosition ??
            getDefaultMainPosition()

          debugLog({
            component: "AnnotationCanvas",
            action: "noteIds_sync_creating_new_panel",
            metadata: {
              noteId: id,
              targetPosition,
              source: seedPosition
                ? "fresh_seed"
                : isDefaultMainPosition(targetPosition)
                  ? "default"
                  : "workspace",
            },
          })

          nextMainItems.push(
            createPanelItem("main", targetPosition, "main", id, targetStoreKey),
          )
          if (seedPosition && onConsumeFreshNoteSeed) {
            queueMicrotask(() => onConsumeFreshNoteSeed(id))
          }
          changed = true
        }
      })

      const newItems = [...nextMainItems, ...otherItems]

      if (!changed && newItems.length === prev.length) {
        debugLog({
          component: "AnnotationCanvas",
          action: "noteIds_sync_NO_CHANGE",
          metadata: {
            noteIds,
            itemCount: prev.length,
            reason: "items_unchanged_returning_prev",
          },
        })
        return prev
      }

      const nextMainPanels = nextMainItems.map(item => ({
        noteId: getItemNoteId(item),
        position: item.position,
      }))

      debugLog({
        component: "AnnotationCanvas",
        action: "noteIds_sync_updated_items",
        metadata: {
          prevCount: prev.length,
          newCount: newItems.length,
          changed,
          noteIdsInput: noteIds,
          currentNoteIdProp: noteId,
          prevMainPanels,
          nextMainPanels,
          mainByNoteKeys: Array.from(mainByNote.keys()),
        },
      })

      return newItems
    })
  }, [
    hasNotes,
    noteIds,
    noteId,
    canvasItemsLength,
    mainOnlyNoteSet,
    freshNoteSeeds,
    onConsumeFreshNoteSeed,
    setCanvasItems,
    getItemNoteId,
    resolveWorkspacePosition,
    resolveStoredPanelPosition,
    hydrationStateKey,
    workspaceSnapshotRevision,
  ])
}
