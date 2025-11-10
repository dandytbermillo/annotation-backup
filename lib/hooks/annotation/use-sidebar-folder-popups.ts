import { useCallback, useEffect, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import type { OrgItem } from "@/components/floating-toolbar"

export type SidebarFolderPopup = {
  id: string
  folderId: string
  folderName: string
  position: { x: number; y: number }
  children: OrgItem[]
  isLoading: boolean
  parentFolderId?: string
  folderColor?: string
}

export type SidebarNotePreviewContext = {
  sourceFolderId?: string
}

type TimeoutHandle = ReturnType<typeof setTimeout>

type UseSidebarFolderPopupsOptions = {
  ensureOverlayHydrated: (reason: string) => void
  fetchChildren: (folderId: string) => Promise<any[] | null>
  onSelectFolder: (folderId: string, rect: DOMRect) => Promise<void> | void
  onOpenNote: (noteId: string) => void
  triggerNotePreviewHover: (
    noteId: string,
    getPosition: () => { x: number; y: number },
    context?: SidebarNotePreviewContext,
  ) => void
  triggerNotePreviewLeave: () => void
  triggerNotePreviewTooltipEnter: () => void
  triggerNotePreviewTooltipLeave: () => void
  cancelNotePreview: () => void
  getPreviewSourceFolderId: () => string | undefined
}

export type SidebarFolderPopupsApi = {
  sidebarFolderPopups: SidebarFolderPopup[]
  closeSidebarFolderPopups: () => void
  dismissSidebarPopup: (popupId: string) => void
  handleSidebarPopupHover: (folderId: string) => void
  handleSidebarEyeHoverLeave: (folderId: string) => void
  handleSidebarOrgEyeHover: (folder: OrgItem, event: ReactMouseEvent<HTMLElement>, parentFolderId?: string) => Promise<void>
  handleSidebarNotePreviewHover: (noteId: string, event: ReactMouseEvent<HTMLElement>, sourceFolderId?: string) => void
  handleSidebarNotePreviewLeave: () => void
  handleSidebarPreviewTooltipEnter: () => void
  handleSidebarPreviewTooltipLeave: () => void
  handleSidebarPopupFolderClick: (folder: OrgItem, event: ReactMouseEvent<HTMLElement>) => void
  handleSidebarNoteOpen: (noteId: string) => void
}

const deriveFromPath = (path?: string | null): string | null => {
  if (!path || typeof path !== "string") return null
  const trimmed = path.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/\/+$/, "")
  if (!normalized) return null
  const segments = normalized.split("/")
  const lastSegment = segments[segments.length - 1]
  return lastSegment && lastSegment.trim() ? lastSegment.trim() : null
}

export function useSidebarFolderPopups({
  ensureOverlayHydrated,
  fetchChildren,
  onSelectFolder,
  onOpenNote,
  triggerNotePreviewHover,
  triggerNotePreviewLeave,
  triggerNotePreviewTooltipEnter,
  triggerNotePreviewTooltipLeave,
  cancelNotePreview,
  getPreviewSourceFolderId,
}: UseSidebarFolderPopupsOptions): SidebarFolderPopupsApi {
  const [sidebarFolderPopups, setSidebarFolderPopups] = useState<SidebarFolderPopup[]>([])
  const sidebarFolderPopupsRef = useRef(sidebarFolderPopups)
  const sidebarHoverTimeoutRef = useRef<Map<string, TimeoutHandle>>(new Map())
  const sidebarPopupIdCounter = useRef(0)

  useEffect(() => {
    sidebarFolderPopupsRef.current = sidebarFolderPopups
  }, [sidebarFolderPopups])

  const closeSidebarFolderPopups = useCallback(() => {
    sidebarHoverTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
    sidebarHoverTimeoutRef.current.clear()
    setSidebarFolderPopups([])
    cancelNotePreview()
  }, [cancelNotePreview])

  const dismissSidebarPopup = useCallback((popupId: string) => {
    setSidebarFolderPopups((prev) => {
      const target = prev.find((popup) => popup.id === popupId)
      if (!target) return prev
      const timeout = sidebarHoverTimeoutRef.current.get(target.folderId)
      if (timeout) {
        clearTimeout(timeout)
        sidebarHoverTimeoutRef.current.delete(target.folderId)
      }
      return prev.filter((popup) => popup.id !== popupId)
    })
  }, [])

  const handleSidebarPopupHover = useCallback((folderId: string) => {
    const timeout = sidebarHoverTimeoutRef.current.get(folderId)
    if (timeout) {
      clearTimeout(timeout)
      sidebarHoverTimeoutRef.current.delete(folderId)
    }

    const currentPopup = sidebarFolderPopupsRef.current.find((popup) => popup.folderId === folderId)
    if (currentPopup?.parentFolderId) {
      let parentId: string | undefined = currentPopup.parentFolderId
      while (parentId) {
        const parentTimeout = sidebarHoverTimeoutRef.current.get(parentId)
        if (parentTimeout) {
          clearTimeout(parentTimeout)
          sidebarHoverTimeoutRef.current.delete(parentId)
        }
        parentId = sidebarFolderPopupsRef.current.find((popup) => popup.folderId === parentId)?.parentFolderId
      }
    }
  }, [])

  const handleSidebarEyeHoverLeave = useCallback((folderId: string) => {
    const existingTimeout = sidebarHoverTimeoutRef.current.get(folderId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    const timeout = setTimeout(() => {
      setSidebarFolderPopups((prev) =>
        prev.filter((popup) => popup.folderId !== folderId && popup.parentFolderId !== folderId),
      )
      sidebarHoverTimeoutRef.current.delete(folderId)
    }, 200)
    sidebarHoverTimeoutRef.current.set(folderId, timeout)
  }, [])

  const handleSidebarOrgEyeHover = useCallback(
    async (folder: OrgItem, event: ReactMouseEvent<HTMLElement>, parentFolderId?: string) => {
      event.stopPropagation()
      ensureOverlayHydrated("sidebar-hover")

      if (sidebarFolderPopupsRef.current.some((popup) => popup.folderId === folder.id)) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const spaceRight = typeof window !== "undefined" ? window.innerWidth - rect.right : 0
      const popupPosition =
        spaceRight > 320
          ? { x: rect.right + 10, y: Math.max(16, rect.top) }
          : { x: Math.max(16, rect.left), y: Math.min(rect.bottom + 10, window.innerHeight - 320) }

      const popupId = `sidebar-folder-popup-${++sidebarPopupIdCounter.current}`
      const newPopup: SidebarFolderPopup = {
        id: popupId,
        folderId: folder.id,
        folderName: folder.name ?? deriveFromPath(folder.path) ?? "Untitled",
        position: popupPosition,
        children: [],
        isLoading: true,
        parentFolderId,
        folderColor: folder.color,
      }

      setSidebarFolderPopups((prev) => [...prev, newPopup])

      try {
        const children = await fetchChildren(folder.id)
        if (!children) {
          setSidebarFolderPopups((prev) =>
            prev.map((popup) => (popup.id === popupId ? { ...popup, isLoading: false } : popup)),
          )
          return
        }

        const formattedChildren: OrgItem[] = children.map((item: any) => ({
          id: item.id,
          name: item.name ?? deriveFromPath(item.path) ?? "Untitled",
          type: item.type === "note" ? "note" : "folder",
          icon: item.icon || (item.type === "folder" ? "📁" : "📄"),
          color: item.color || (item.type === "folder" ? folder.color : undefined),
          path: item.path,
          hasChildren: item.type === "folder",
          level: (folder.level ?? 0) + 1,
          children: [],
          parentId: item.parentId,
        }))

        setSidebarFolderPopups((prev) =>
          prev.map((popup) =>
            popup.id === popupId
              ? {
                  ...popup,
                  children: formattedChildren,
                  isLoading: false,
                }
              : popup,
          ),
        )
      } catch (error) {
        console.error("[useSidebarFolderPopups] Failed to load sidebar hover children:", error)
        setSidebarFolderPopups((prev) =>
          prev.map((popup) => (popup.id === popupId ? { ...popup, isLoading: false } : popup)),
        )
      }
    },
    [ensureOverlayHydrated, fetchChildren],
  )

  const handleSidebarNotePreviewHover = useCallback(
    (noteId: string, event: ReactMouseEvent<HTMLElement>, sourceFolderId?: string) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const position = {
        x: rect.right + 10,
        y: Math.max(16, rect.top),
      }
      triggerNotePreviewHover(noteId, () => position, { sourceFolderId })
    },
    [triggerNotePreviewHover],
  )

  const handleSidebarNotePreviewLeave = useCallback(() => {
    triggerNotePreviewLeave()
  }, [triggerNotePreviewLeave])

  const handleSidebarPreviewTooltipEnter = useCallback(() => {
    triggerNotePreviewTooltipEnter()
    const sourceFolderId = getPreviewSourceFolderId()
    if (sourceFolderId) {
      handleSidebarPopupHover(sourceFolderId)
    }
  }, [getPreviewSourceFolderId, handleSidebarPopupHover, triggerNotePreviewTooltipEnter])

  const handleSidebarPreviewTooltipLeave = useCallback(() => {
    triggerNotePreviewTooltipLeave()
  }, [triggerNotePreviewTooltipLeave])

  const handleSidebarPopupFolderClick = useCallback(
    (folder: OrgItem, event: ReactMouseEvent<HTMLElement>) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      onSelectFolder(folder.id, rect)
      closeSidebarFolderPopups()
    },
    [closeSidebarFolderPopups, onSelectFolder],
  )

  const handleSidebarNoteOpen = useCallback(
    (noteId: string) => {
      onOpenNote(noteId)
      closeSidebarFolderPopups()
    },
    [closeSidebarFolderPopups, onOpenNote],
  )

  return {
    sidebarFolderPopups,
    closeSidebarFolderPopups,
    dismissSidebarPopup,
    handleSidebarPopupHover,
    handleSidebarEyeHoverLeave,
    handleSidebarOrgEyeHover,
    handleSidebarNotePreviewHover,
    handleSidebarNotePreviewLeave,
    handleSidebarPreviewTooltipEnter,
    handleSidebarPreviewTooltipLeave,
    handleSidebarPopupFolderClick,
    handleSidebarNoteOpen,
  }
}
