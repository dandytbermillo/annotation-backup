import { useCallback } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import type { OverlayPopup, OrgItem } from "@/components/floating-toolbar"
import type { PopupChildNode } from "@/components/canvas/popup-overlay/types"

export type UseWorkspaceOverlayInteractionsOptions = {
  setOverlayPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  updateFolderCacheChildren: (folderId: string, children: OrgItem[]) => void
  invalidateFolderCache: (folderId?: string | null) => void
  startPopupDrag: (popupId: string, event: MouseEvent, layerContext: LayerContextValue | null) => void
  layerContext: LayerContextValue | null
  closeTimeouts: React.MutableRefObject<Map<string, number>>
  clearCloseTimeout: (key: string) => void
}

export function useWorkspaceOverlayInteractions({
  setOverlayPopups,
  updateFolderCacheChildren,
  invalidateFolderCache,
  startPopupDrag,
  layerContext,
  closeTimeouts,
  clearCloseTimeout,
}: UseWorkspaceOverlayInteractionsOptions) {
  const handleFolderCreated = useCallback(
    (popupId: string, newFolder: PopupChildNode) => {
      const mappedFolder: OrgItem = {
        id: newFolder.id ?? "",
        name: newFolder.name ?? "Untitled",
        type: newFolder.type === "note" ? "note" : "folder",
        icon: newFolder.icon ?? undefined,
        color: newFolder.color ?? undefined,
        path: undefined,
        hasChildren: Array.isArray(newFolder.children) && newFolder.children.length > 0,
        level: 0,
        children: [],
        parentId: newFolder.parentId ?? undefined,
      }

      let updatedParentFolderId: string | null = null
      let updatedChildrenSnapshot: OrgItem[] | null = null

      setOverlayPopups(prev =>
        prev.map(popup => {
          if (popup.id === popupId && popup.folder) {
            const updatedChildren: OrgItem[] = [mappedFolder, ...popup.children]
            const nextSizeMode = popup.sizeMode === "user" ? "user" : "default"

            updatedParentFolderId = popup.folderId
            updatedChildrenSnapshot = updatedChildren

            return {
              ...popup,
              children: updatedChildren,
              folder: { ...popup.folder, children: updatedChildren },
              sizeMode: nextSizeMode,
              height: nextSizeMode === "default" ? undefined : popup.height,
            }
          }
          return popup
        }),
      )

      if (updatedParentFolderId && updatedChildrenSnapshot) {
        updateFolderCacheChildren(updatedParentFolderId, updatedChildrenSnapshot)
      }
      const folderId = newFolder?.id ?? undefined
      invalidateFolderCache(folderId)
    },
    [invalidateFolderCache, setOverlayPopups, updateFolderCacheChildren],
  )

  const handlePopupDragStart = useCallback(
    (popupId: string, event: ReactMouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      startPopupDrag(popupId, event.nativeEvent, layerContext ?? null)
    },
    [layerContext, startPopupDrag],
  )

  const handlePopupHover = useCallback(
    (folderId: string, parentPopupId?: string) => {
      const possibleKeys = [folderId, parentPopupId ? `${parentPopupId}-${folderId}` : null]
        .filter(Boolean) as string[]

      closeTimeouts.current.forEach((timeout, key) => {
        if (key.endsWith(folderId) && !possibleKeys.includes(key)) {
          possibleKeys.push(key)
        }
      })

      for (const key of possibleKeys) {
        if (closeTimeouts.current.has(key)) {
          clearCloseTimeout(key)
          break
        }
      }
    },
    [clearCloseTimeout, closeTimeouts],
  )

  const handleFolderRenamed = useCallback(
    (folderId: string, newName: string) => {
      setOverlayPopups(prev =>
        prev.map(popup => {
          if (popup.folderId === folderId) {
            return {
              ...popup,
              folderName: newName,
              folder: popup.folder ? { ...popup.folder, name: newName } : null,
            }
          }

          if (popup.folder?.children) {
            const hasMatchingChild = popup.folder.children.some(child => child.id === folderId)
            if (hasMatchingChild) {
              return {
                ...popup,
                folder: {
                  ...popup.folder,
                  children: popup.folder.children.map(child =>
                    child.id === folderId ? { ...child, name: newName } : child,
                  ),
                },
              }
            }
          }

          return popup
        }),
      )
    },
    [setOverlayPopups],
  )

  return {
    handleFolderCreated,
    handlePopupDragStart,
    handlePopupHover,
    handleFolderRenamed,
  }
}
