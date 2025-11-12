import { useCallback, useMemo } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"

import type { CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import type { OrganizationSidebarItem } from "@/components/sidebar/organization-sidebar-content"
import { ConstellationSidebarShared } from "@/components/sidebar/constellation-sidebar-shared"
import type { OrgItem } from "@/components/floating-toolbar"
import { useOrganizationSidebarActions } from "@/lib/hooks/annotation/use-organization-sidebar-actions"

const DEFAULT_POPUP_WIDTH = 300
const DEFAULT_POPUP_HEIGHT = 400

type FolderCacheApi = {
  updateFolderCacheEntry: (...args: any[]) => void
  updateFolderCacheChildren: (...args: any[]) => void
  invalidateFolderCache: (...args: any[]) => void
}

type HoverHandlers = {
  handleSidebarOrgEyeHover: (folder: OrgItem, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleSidebarEyeHoverLeave: (folderId: string) => void
  handleSidebarNotePreviewHover: (noteId: string, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleSidebarNotePreviewLeave: () => void
}

type SidebarDerivedState = {
  organizationFolders: Array<Omit<OrganizationSidebarItem, "pinned">>
  items: OrganizationSidebarItem[]
  stats: { openPopups: number; totalItems: number; pinnedPopups: number }
}

type WorkspaceSidebarStateOptions = {
  shouldShowSidebar: boolean
  showConstellationPanel: boolean
  activeSidebarTab: CanvasSidebarTab
  handleSidebarTabChange: (tab: CanvasSidebarTab) => void
  sidebarState: SidebarDerivedState
  overlayPopups: any[]
  setOverlayPopups: (update: any) => void
  layerContext: any
  setCanvasMode: (mode: "overlay" | "constellation") => void
  ensureOverlayHydrated: (reason: string) => void
  appendWorkspaceParam: (value: string) => string
  knowledgeBaseWorkspaceId: string | null
  fetchWithKnowledgeBase: (...args: any[]) => Promise<Response>
  fetchGlobalChildren: (id: string) => Promise<any[] | null>
  folderCacheApi: FolderCacheApi
  knowledgeBaseId: string | null
  hoverHandlers: HoverHandlers
}

const sidebarItemToOrgItem = (item: OrganizationSidebarItem): OrgItem => ({
  id: item.id,
  name: item.name,
  type: item.type === "note" ? "note" : "folder",
  icon: item.icon,
  color: item.color ?? undefined,
  path: item.path ?? undefined,
  hasChildren: item.hasChildren ?? (item.count ?? 0) > 0,
  level: typeof item.level === "number" ? item.level : 0,
  children: [],
  parentId: item.parentId ?? undefined,
})

export function useWorkspaceSidebarState({
  shouldShowSidebar,
  showConstellationPanel,
  activeSidebarTab,
  handleSidebarTabChange,
  sidebarState,
  overlayPopups,
  setOverlayPopups,
  layerContext,
  setCanvasMode,
  ensureOverlayHydrated,
  appendWorkspaceParam,
  knowledgeBaseWorkspaceId,
  fetchWithKnowledgeBase,
  fetchGlobalChildren,
  folderCacheApi,
  knowledgeBaseId,
  hoverHandlers,
}: WorkspaceSidebarStateOptions) {
  const { handleOrganizationSidebarSelect } = useOrganizationSidebarActions({
    knowledgeBaseId,
    organizationFolders: sidebarState.organizationFolders,
    overlayPopups,
    setOverlayPopups,
    layerContext,
    setCanvasMode,
    ensureOverlayHydrated,
    appendKnowledgeBaseWorkspaceParam: appendWorkspaceParam,
    knowledgeBaseWorkspaceId,
    fetchWithKnowledgeBase,
    fetchGlobalChildren,
    defaultPopupWidth: DEFAULT_POPUP_WIDTH,
    defaultPopupHeight: DEFAULT_POPUP_HEIGHT,
    folderCacheApi,
  })

  const handleOrganizationSidebarEyeHover = useCallback(
    (item: OrganizationSidebarItem, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (item.interactive === false) return
      const folder = sidebarItemToOrgItem(item)
      hoverHandlers.handleSidebarOrgEyeHover(folder, event)
    },
    [hoverHandlers],
  )

  const handleOrganizationSidebarEyeLeave = useCallback(
    (id: string) => {
      hoverHandlers.handleSidebarEyeHoverLeave(id)
    },
    [hoverHandlers],
  )

  const handleOrganizationSidebarNoteHover = useCallback(
    (item: OrganizationSidebarItem, event: ReactMouseEvent<HTMLButtonElement>) => {
      hoverHandlers.handleSidebarNotePreviewHover(item.id, event)
    },
    [hoverHandlers],
  )

  const handleOrganizationSidebarNoteLeave = useCallback(() => {
    hoverHandlers.handleSidebarNotePreviewLeave()
  }, [hoverHandlers])

  const workspaceSidebarProps = useMemo(
    () => ({
      visible: shouldShowSidebar,
      showConstellationPanel,
      activeTab: activeSidebarTab,
      onTabChange: handleSidebarTabChange,
      organizationItems: sidebarState.items,
      organizationStats: sidebarState.stats,
      onOrganizationSelect: handleOrganizationSidebarSelect,
      onOrganizationEyeHover: handleOrganizationSidebarEyeHover,
      onOrganizationEyeLeave: handleOrganizationSidebarEyeLeave,
      onOrganizationNoteHover: handleOrganizationSidebarNoteHover,
      onOrganizationNoteLeave: handleOrganizationSidebarNoteLeave,
      constellationContent: <ConstellationSidebarShared />,
    }),
    [
      shouldShowSidebar,
      showConstellationPanel,
      activeSidebarTab,
      handleSidebarTabChange,
      sidebarState,
      handleOrganizationSidebarSelect,
      handleOrganizationSidebarEyeHover,
      handleOrganizationSidebarEyeLeave,
      handleOrganizationSidebarNoteHover,
      handleOrganizationSidebarNoteLeave,
    ],
  )

  return { workspaceSidebarProps }
}
