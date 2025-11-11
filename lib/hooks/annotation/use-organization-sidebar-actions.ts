import { useCallback } from "react"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import type { OrgItem } from "@/components/floating-toolbar"
import type { OverlayPopup } from "@/components/floating-toolbar"
import type { OrganizationSidebarItem } from "@/components/sidebar/organization-sidebar-content"

type FolderCacheApi = {
  updateFolderCacheEntry: (folderId: string, data: any) => void
  updateFolderCacheChildren: (folderId: string, children: OrgItem[] | any[]) => void
  invalidateFolderCache: (folderId: string) => void
}

type UseOrganizationSidebarActionsOptions = {
  knowledgeBaseId: string | null
  organizationFolders: OrganizationSidebarItem[]
  overlayPopups: OverlayPopup[]
  setOverlayPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  layerContext: LayerContextValue | null
  setCanvasMode: (mode: "overlay" | "constellation") => void
  ensureOverlayHydrated: (reason: string) => void
  appendKnowledgeBaseWorkspaceParam: (url: string, workspaceId: string | null) => string
  knowledgeBaseWorkspaceId: string | null
  fetchWithKnowledgeBase: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  fetchGlobalChildren: (folderId: string) => Promise<any[] | null>
  defaultPopupWidth: number
  defaultPopupHeight: number
  folderCacheApi: FolderCacheApi
}

export function useOrganizationSidebarActions({
  knowledgeBaseId,
  organizationFolders,
  overlayPopups,
  setOverlayPopups,
  layerContext,
  setCanvasMode,
  ensureOverlayHydrated,
  appendKnowledgeBaseWorkspaceParam,
  knowledgeBaseWorkspaceId,
  fetchWithKnowledgeBase,
  fetchGlobalChildren,
  defaultPopupWidth,
  defaultPopupHeight,
  folderCacheApi,
}: UseOrganizationSidebarActionsOptions) {
  const handleOrganizationSidebarSelect = useCallback(
    async (folderId: string, rect?: DOMRect) => {
      if (knowledgeBaseId && folderId === knowledgeBaseId) return
      ensureOverlayHydrated("sidebar-select")

      const existingIndex = overlayPopups.findIndex((p: any) => p.folderId === folderId)
      if (existingIndex >= 0) {
        const existingPopup = overlayPopups[existingIndex]
        setOverlayPopups((prev) => {
          const without = prev.filter((p) => p.id !== existingPopup.id).map((p) => ({ ...p, isHighlighted: false }))
          const highlighted = { ...existingPopup, isHighlighted: true }
          return [...without, highlighted]
        })
        layerContext?.setActiveLayer?.("popups")
        setCanvasMode("overlay")
        return
      }

      try {
        const detailResponse = await fetch(
          appendKnowledgeBaseWorkspaceParam(`/api/items/${folderId}`, knowledgeBaseWorkspaceId),
        )
        if (!detailResponse.ok) throw new Error("Failed to load folder metadata")
        const detailData = await detailResponse.json()
        const detail = detailData.item || detailData

        const folderName = detail?.name ?? organizationFolders.find((item) => item.id === folderId)?.name ?? "Untitled"
        const folderColor = detail?.color ?? null
        const folderPath = detail?.path ?? null
        const folderLevel = typeof detail?.level === "number" ? detail.level : 0

        const targetRect = rect || new DOMRect(0, 80, defaultPopupWidth, 40)

        let popupX = targetRect.right + 16
        if (popupX + defaultPopupWidth > window.innerWidth) {
          popupX = Math.max(16, targetRect.left - defaultPopupWidth - 16)
        }
        const popupY = Math.min(Math.max(16, targetRect.top), window.innerHeight - defaultPopupHeight)

        const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }
        const screenPosition = { x: popupX, y: popupY }
        const canvasPosition = CoordinateBridge.screenToCanvas(screenPosition, sharedTransform)

        const popupId = `overlay-sidebar-${Date.now()}-${folderId}`

        layerContext?.setActiveLayer?.("popups")
        setCanvasMode("overlay")

        setOverlayPopups((prev) => [
          ...prev.map((p) => ({ ...p, isHighlighted: false })),
          {
            id: popupId,
            folderId,
            folderName,
            folder: {
              id: folderId,
              name: folderName,
              type: "folder",
              level: folderLevel,
              color: folderColor,
              path: folderPath,
              children: [],
            },
            position: screenPosition,
            canvasPosition,
            children: [],
            isLoading: true,
            isPersistent: true,
            isHighlighted: true,
            level: folderLevel,
          },
        ])

        try {
          const childResponse = await fetch(
            appendKnowledgeBaseWorkspaceParam(`/api/items?parentId=${folderId}`, knowledgeBaseWorkspaceId),
          )
          if (!childResponse.ok) throw new Error("Failed to load folder contents")

          const childData = await childResponse.json()
          const childItems: any[] = Array.isArray(childData?.items) ? childData.items : []
          const formattedChildren: OrgItem[] = childItems.map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            icon: item.icon || (item.type === "folder" ? "📁" : "📄"),
            color: item.color,
            path: item.path,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            hasChildren: item.type === "folder",
            level: (detail?.level ?? 0) + 1,
            children: [],
            parentId: item.parentId,
          }))

          setOverlayPopups((prev) =>
            prev.map((p) =>
              p.id === popupId
                ? {
                    ...p,
                    children: formattedChildren,
                    isLoading: false,
                    folder: p.folder ? { ...p.folder, children: formattedChildren } : null,
                  }
                : p,
            ),
          )
          folderCacheApi.updateFolderCacheEntry(folderId, detail)
          folderCacheApi.updateFolderCacheChildren(folderId, childItems)
        } catch (childError) {
          console.error("[AnnotationApp] Failed to load folder children:", childError)
          setOverlayPopups((prev) => prev.map((p) => (p.id === popupId ? { ...p, isLoading: false } : p)))
        }
      } catch (error) {
        console.error("[AnnotationApp] Failed to open folder popup from sidebar:", error)
      }
    },
    [
      knowledgeBaseId,
      ensureOverlayHydrated,
      overlayPopups,
      setOverlayPopups,
      layerContext,
      setCanvasMode,
      appendKnowledgeBaseWorkspaceParam,
      knowledgeBaseWorkspaceId,
      fetchWithKnowledgeBase,
      organizationFolders,
      defaultPopupWidth,
      defaultPopupHeight,
      folderCacheApi,
    ],
  )

  return { handleOrganizationSidebarSelect }
}
