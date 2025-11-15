"use client"

import { useEffect } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasItem } from "@/types/canvas-items"

interface UseMainOnlyPanelFilterOptions {
  mainOnlyNoteIds?: string[] | null
  mainOnlyNoteSet: Set<string>
  setCanvasItems: Dispatch<SetStateAction<CanvasItem[]>>
  getItemNoteId: (item: CanvasItem) => string | null
}

export function useMainOnlyPanelFilter({
  mainOnlyNoteIds,
  mainOnlyNoteSet,
  setCanvasItems,
  getItemNoteId,
}: UseMainOnlyPanelFilterOptions) {
  useEffect(() => {
    if (!mainOnlyNoteIds || mainOnlyNoteIds.length === 0) {
      return
    }

    setCanvasItems(prev => {
      let changed = false
      const filtered = prev.filter(item => {
        if (item.itemType !== "panel" || item.panelId === "main") {
          return true
        }

        const itemNoteId = getItemNoteId(item)
        if (itemNoteId && mainOnlyNoteSet.has(itemNoteId)) {
          changed = true
          return false
        }

        return true
      })

      return changed ? filtered : prev
    })
  }, [mainOnlyNoteIds, mainOnlyNoteSet, setCanvasItems, getItemNoteId])
}
