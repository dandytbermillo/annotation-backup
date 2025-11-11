import { useCallback } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"
import type { OrgItem } from "@/components/floating-toolbar"

type FolderCacheApi = {
  updateFolderCacheChildren: (folderId: string, children: OrgItem[] | any[]) => void
  invalidateFolderCache: (folderId: string) => void
}

type UsePopupBulkActionsOptions = {
  fetchWithKnowledgeBase: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  withKnowledgeBasePayload: (payload: Record<string, unknown>, workspaceId: string | null) => Record<string, unknown>
  knowledgeBaseWorkspaceId: string | null
  setOverlayPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  folderCacheApi: FolderCacheApi
}

export function usePopupBulkActions({
  fetchWithKnowledgeBase,
  withKnowledgeBasePayload,
  knowledgeBaseWorkspaceId,
  setOverlayPopups,
  folderCacheApi,
}: UsePopupBulkActionsOptions) {
  const handleDeleteSelected = useCallback(
    async (popupId: string, selectedIds: Set<string>) => {
      if (!selectedIds.size) return

      const deleteResults = await Promise.all(
        Array.from(selectedIds).map(async (itemId) => {
          try {
            const response = await fetchWithKnowledgeBase(`/api/items/${itemId}`, {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
              },
            })

            if (!response.ok && response.status !== 404) {
              console.error(`Failed to delete item ${itemId}:`, response.status)
              return { itemId, success: false }
            }

            return { itemId, success: true }
          } catch (error) {
            console.error(`Failed to delete item ${itemId}:`, error)
            return { itemId, success: false }
          }
        }),
      )

      const successfulDeletes = new Set(deleteResults.filter((result) => result.success).map((result) => result.itemId))

      if (successfulDeletes.size === 0) {
        console.warn("[handleDeleteSelected] No items deleted successfully")
        return
      }

      setOverlayPopups((prev) =>
        prev.map((popup) => {
          if (popup.id !== popupId || !popup.children) return popup
          const updatedChildren = popup.children.filter((child) => !successfulDeletes.has(child.id))
          folderCacheApi.updateFolderCacheChildren(popup.folderId ?? popupId, updatedChildren)
          return {
            ...popup,
            children: updatedChildren,
            folder: popup.folder ? { ...popup.folder, children: updatedChildren } : null,
          }
        }),
      )

      const failedCount = selectedIds.size - successfulDeletes.size
      if (failedCount > 0) {
        console.warn(`[handleDeleteSelected] ${failedCount} item(s) failed to delete`)
      }
    },
    [fetchWithKnowledgeBase, folderCacheApi, setOverlayPopups],
  )

  const handleBulkMove = useCallback(
    async (itemIds: string[], targetFolderId: string, sourcePopupId: string) => {
      if (!itemIds.length) return

      try {
        let sourceFolderUpdated = false
        let targetFolderUpdated = false

        const response = await fetchWithKnowledgeBase("/api/items/bulk-move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            withKnowledgeBasePayload(
              {
                itemIds,
                targetFolderId,
              },
              knowledgeBaseWorkspaceId,
            ),
          ),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || "Failed to move items")
        }

        const data = await response.json()
        const movedItems = data.movedItems || []
        const movedIds = new Set(movedItems.map((item: any) => item.id))

        setOverlayPopups((prev) =>
          prev.map((popup) => {
            if (popup.id === sourcePopupId && popup.children) {
              const updatedChildren = popup.children.filter((child) => !movedIds.has(child.id))
              folderCacheApi.updateFolderCacheChildren(popup.folderId ?? sourcePopupId, updatedChildren)
              sourceFolderUpdated = true
              return {
                ...popup,
                children: updatedChildren,
                folder: popup.folder ? { ...popup.folder, children: updatedChildren } : null,
              }
            }

            if (popup.folderId === targetFolderId && popup.children) {
              const existingIds = new Set(popup.children.map((child) => child.id))
              const newItems = movedItems.filter((item: any) => !existingIds.has(item.id))
              const updatedChildren = [...popup.children, ...newItems]
              folderCacheApi.updateFolderCacheChildren(targetFolderId, updatedChildren)
              targetFolderUpdated = true
              return {
                ...popup,
                children: updatedChildren,
                folder: popup.folder ? { ...popup.folder, children: updatedChildren } : null,
              }
            }

            return popup
          }),
        )

        if (!sourceFolderUpdated) {
          folderCacheApi.invalidateFolderCache(sourcePopupId)
        }

        if (!targetFolderUpdated) {
          folderCacheApi.invalidateFolderCache(targetFolderId)
        }

        const failedCount = itemIds.length - movedIds.size
        if (failedCount > 0) {
          console.warn(`[handleBulkMove] ${failedCount} item(s) failed to move`)
        }
      } catch (error) {
        console.error("[handleBulkMove] Error:", error)
        alert(`Failed to move items: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    },
    [fetchWithKnowledgeBase, folderCacheApi, knowledgeBaseWorkspaceId, setOverlayPopups, withKnowledgeBasePayload],
  )

  return { handleDeleteSelected, handleBulkMove }
}
