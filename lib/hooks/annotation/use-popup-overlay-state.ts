import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import type { OverlayPopup, OrgItem } from "@/components/floating-toolbar"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import type { KnowledgeBaseWorkspaceApi } from "./use-knowledge-base-workspace"
import type { FolderCacheApi } from "./use-folder-cache"

type MoveCascadeState = {
  parentId: string | null
  childIds: string[]
}

type TimeoutHandle = number

export type PopupOverlayState = {
  popups: OverlayPopup[]
  setPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  draggingPopup: string | null
  setDraggingPopup: React.Dispatch<React.SetStateAction<string | null>>
  overlayPanning: boolean
  setOverlayPanning: (active: boolean) => void
  moveCascadeState: MoveCascadeState
  setMoveCascadeState: React.Dispatch<React.SetStateAction<MoveCascadeState>>
  hoverTimeouts: React.MutableRefObject<Map<string, TimeoutHandle>>
  closeTimeouts: React.MutableRefObject<Map<string, TimeoutHandle>>
  setHoverTimeout: (key: string, handle: TimeoutHandle) => void
  clearHoverTimeout: (key: string) => void
  setCloseTimeout: (key: string, handle: TimeoutHandle) => void
  clearCloseTimeout: (key: string) => void
  clearAllTimeouts: () => void
  handlePopupDragStart: (popupId: string, event: MouseEvent, layerContext: LayerContextValue | null) => void
  handlePopupDragMove: (event: MouseEvent, layerContext: LayerContextValue | null) => void
  handlePopupDragEnd: () => void
  getAllDescendants: (popupId: string) => string[]
  toggleMoveCascade: (popupId: string) => void
  clearMoveCascadeState: () => void
  closePopupCascade: (popupId: string) => void
  initiateCloseMode: (popupId: string) => void
  confirmCloseMode: (popupId: string) => void
  cancelCloseMode: (popupId: string) => void
  togglePinCascade: (popupId: string) => void
  handleFolderHover: (folder: OrgItem, event: React.MouseEvent, parentPopupId: string, isPersistent?: boolean) => Promise<void> | void
  handleFolderHoverLeave: (folderId?: string, parentPopupId?: string) => void
}

type UsePopupOverlayStateOptions = {
  initialPopups?: OverlayPopup[]
  initialMoveCascade?: MoveCascadeState
  layerContext?: LayerContextValue | null
  knowledgeBaseWorkspace?: KnowledgeBaseWorkspaceApi
  folderCache?: FolderCacheApi
  fetchChildren?: (folderId: string, options?: { forceRefresh?: boolean }) => Promise<any[] | null>
  ensureOverlayHydrated?: (reason: string) => void
  popupWidth?: number
}

const DEFAULT_MOVE_CASCADE: MoveCascadeState = { parentId: null, childIds: [] }

const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1 }

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

export function usePopupOverlayState({
  initialPopups = [],
  initialMoveCascade = DEFAULT_MOVE_CASCADE,
  layerContext,
  knowledgeBaseWorkspace,
  folderCache,
  fetchChildren,
  ensureOverlayHydrated,
  popupWidth = 300,
}: UsePopupOverlayStateOptions = {}): PopupOverlayState {
  const [popups, setPopups] = useState<OverlayPopup[]>(initialPopups)
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const [overlayPanning, setOverlayPanning] = useState(false)
  const [moveCascadeState, setMoveCascadeState] = useState<MoveCascadeState>(initialMoveCascade)
  const hoverTimeouts = useRef<Map<string, TimeoutHandle>>(new Map())
  const closeTimeouts = useRef<Map<string, TimeoutHandle>>(new Map())
  const popupsRef = useRef(popups)

  useEffect(() => {
    popupsRef.current = popups
  }, [popups])

  const setHoverTimeout = useCallback((key: string, handle: TimeoutHandle) => {
    const timeout = hoverTimeouts.current.get(key)
    if (timeout) clearTimeout(timeout)
    hoverTimeouts.current.set(key, handle)
  }, [])

  const clearHoverTimeout = useCallback((key: string) => {
    const timeout = hoverTimeouts.current.get(key)
    if (timeout) clearTimeout(timeout)
    hoverTimeouts.current.delete(key)
  }, [])

  const setCloseTimeout = useCallback((key: string, handle: TimeoutHandle) => {
    const timeout = closeTimeouts.current.get(key)
    if (timeout) clearTimeout(timeout)
    closeTimeouts.current.set(key, handle)
  }, [])

  const clearCloseTimeout = useCallback((key: string) => {
    const timeout = closeTimeouts.current.get(key)
    if (timeout) clearTimeout(timeout)
    closeTimeouts.current.delete(key)
  }, [])

  const clearAllTimeouts = useCallback(() => {
    hoverTimeouts.current.forEach(clearTimeout)
    hoverTimeouts.current.clear()
    closeTimeouts.current.forEach(clearTimeout)
    closeTimeouts.current.clear()
  }, [])

  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragScreenPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const draggingPopupRef = useRef<string | null>(null)

  const handlePopupDragStart = useCallback(
    (popupId: string, event: MouseEvent, layerContext: LayerContextValue | null) => {
      const popup = popups.find((p) => p.id === popupId)
      if (!popup) return

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }
      const screenPosition = CoordinateBridge.canvasToScreen(popup.canvasPosition, sharedTransform)
      dragOffsetRef.current = {
        x: event.clientX - screenPosition.x,
        y: event.clientY - screenPosition.y,
      }
      dragScreenPosRef.current = screenPosition
      draggingPopupRef.current = popupId
      setDraggingPopup(popupId)
      setOverlayPanning(true)
      setPopups((prev) => prev.map((p) => (p.id === popupId ? { ...p, isDragging: true } : p)))
      document.body.style.cursor = "grabbing"
      document.body.style.userSelect = "none"
    },
    [popups],
  )

  const handlePopupDragMove = useCallback(
    (event: MouseEvent, layerContext: LayerContextValue | null) => {
      const activeId = draggingPopupRef.current
      if (!activeId) return

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }
      const newScreenPosition = {
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y,
      }
      const newCanvasPosition = CoordinateBridge.screenToCanvas(newScreenPosition, sharedTransform)

      setPopups((prev) =>
        prev.map((popup) =>
          popup.id === activeId
            ? { ...popup, canvasPosition: newCanvasPosition, position: newScreenPosition, isDragging: true }
            : popup,
        ),
      )

      dragScreenPosRef.current = newScreenPosition
    },
    [setPopups],
  )

  const handlePopupDragEnd = useCallback(() => {
    const activeId = draggingPopupRef.current
    if (!activeId) return

    setPopups((prev) => prev.map((p) => (p.id === activeId ? { ...p, isDragging: false } : p)))
    draggingPopupRef.current = null
    setDraggingPopup(null)
    setOverlayPanning(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [setPopups])

  const getAllDescendants = useCallback(
    (popupId: string): string[] => {
      const descendants: string[] = []
      const findChildren = (parentId: string) => {
        popups.forEach((popup) => {
          if (popup.parentPopupId === parentId) {
            descendants.push(popup.id)
            findChildren(popup.id)
          }
        })
      }
      findChildren(popupId)
      return descendants
    },
    [popups],
  )

  const applyMoveCascadeState = useCallback((parentId: string | null, childIds: string[]) => {
    const childSet = new Set(childIds)
    setPopups((prev) =>
      prev.map((popup) => {
        if (parentId && popup.id === parentId) {
          return popup.moveMode === "parent" ? popup : { ...popup, moveMode: "parent" }
        }
        if (childSet.has(popup.id)) {
          return popup.moveMode === "child" ? popup : { ...popup, moveMode: "child" }
        }
        if (!parentId && childSet.size === 0 && !popup.moveMode) {
          return popup
        }
        if (popup.moveMode) {
          return { ...popup, moveMode: undefined }
        }
        return popup
      }),
    )
  }, [])

  const clearMoveCascadeState = useCallback(() => {
    setMoveCascadeState(DEFAULT_MOVE_CASCADE)
    applyMoveCascadeState(null, [])
  }, [applyMoveCascadeState])

  const toggleMoveCascade = useCallback(
    (popupId: string) => {
      setMoveCascadeState((prev) => {
        if (prev.parentId === popupId) {
          applyMoveCascadeState(null, [])
          return DEFAULT_MOVE_CASCADE
        }
        const descendants = getAllDescendants(popupId)
        applyMoveCascadeState(popupId, descendants)
        return { parentId: popupId, childIds: descendants }
      })
    },
    [applyMoveCascadeState, getAllDescendants],
  )

  const closePopupCascade = useCallback(
    (popupId: string) => {
      const toClose = new Set<string>([popupId])
      const collect = (parentId: string) => {
        popups.forEach((popup) => {
          if (popup.parentPopupId === parentId && !toClose.has(popup.id)) {
            toClose.add(popup.id)
            collect(popup.id)
          }
        })
      }
      collect(popupId)

      if (
        (moveCascadeState.parentId && toClose.has(moveCascadeState.parentId)) ||
        moveCascadeState.childIds.some((id) => toClose.has(id))
      ) {
        clearMoveCascadeState()
      }

      toClose.forEach((id) => {
        const popup = popups.find((p) => p.id === id)
        if (!popup) return
        const timeoutKey = popup.parentPopupId ? `${popup.parentPopupId}-${popup.folderId}` : popup.folderId
        clearHoverTimeout(timeoutKey)
        clearCloseTimeout(timeoutKey)
      })

      setPopups((prev) => prev.filter((popup) => !toClose.has(popup.id)))
    },
    [clearCloseTimeout, clearHoverTimeout, clearMoveCascadeState, moveCascadeState.childIds, moveCascadeState.parentId, popups],
  )

  const initiateCloseMode = useCallback(
    (popupId: string) => {
      const descendants = getAllDescendants(popupId)
      if (descendants.length === 0) {
        closePopupCascade(popupId)
        return
      }
      setPopups((prev) =>
        prev.map((popup) => {
          if (popup.id === popupId) {
            return { ...popup, closeMode: "closing" as const }
          }
          if (descendants.includes(popup.id)) {
            return { ...popup, isHighlighted: true }
          }
          return popup
        }),
      )
    },
    [closePopupCascade, getAllDescendants],
  )

  const confirmCloseMode = useCallback(
    (parentId: string) => {
      const descendants = getAllDescendants(parentId)
      const toClose = new Set<string>([parentId])
      descendants.forEach((id) => {
        const popup = popups.find((p) => p.id === id)
        if (popup && !popup.isPinned) {
          toClose.add(id)
        }
      })

      if (
        (moveCascadeState.parentId && toClose.has(moveCascadeState.parentId)) ||
        moveCascadeState.childIds.some((id) => toClose.has(id))
      ) {
        clearMoveCascadeState()
      }

      toClose.forEach((id) => {
        const popup = popups.find((p) => p.id === id)
        if (!popup) return
        const timeoutKey = popup.parentPopupId ? `${popup.parentPopupId}-${popup.folderId}` : popup.folderId
        clearHoverTimeout(timeoutKey)
        clearCloseTimeout(timeoutKey)
      })

      setPopups((prev) =>
        prev
          .filter((popup) => !toClose.has(popup.id))
          .map((popup) => ({
            ...popup,
            isHighlighted: false,
            closeMode: undefined,
          })),
      )
    },
    [clearCloseTimeout, clearHoverTimeout, clearMoveCascadeState, getAllDescendants, moveCascadeState.childIds, moveCascadeState.parentId, popups],
  )

  const cancelCloseMode = useCallback(
    (parentId: string) => {
      const descendants = getAllDescendants(parentId)
      setPopups((prev) =>
        prev.map((popup) => {
          if (popup.id === parentId) {
            return { ...popup, closeMode: undefined }
          }
          if (descendants.includes(popup.id)) {
            return { ...popup, isHighlighted: false }
          }
          return popup
        }),
      )
    },
    [getAllDescendants],
  )

  const togglePinCascade = useCallback(
    (popupId: string) => {
      setPopups((prev) => {
        const target = prev.find((p) => p.id === popupId)
        if (!target) {
          return prev
        }
        const descendants = getAllDescendants(popupId)
        const newPin = !target.isPinned
        return prev.map((popup) => {
          if (popup.id === popupId) {
            return { ...popup, isPinned: newPin }
          }
          if (descendants.includes(popup.id)) {
            return { ...popup, isPinned: newPin }
          }
          return popup
        })
      })
    },
    [getAllDescendants],
  )

  const handleFolderHover = useCallback(
    async (folder: OrgItem, event: ReactMouseEvent, parentPopupId: string, isPersistent = false) => {
      ensureOverlayHydrated?.("sidebar-hover")

      const existingPopup = popupsRef.current.find((p) => p.folderId === folder.id)
      if (existingPopup) {
        if (isPersistent) {
          const alreadyPersistent = existingPopup.isPersistent
          setPopups((prev) =>
            prev.map((popup) =>
              popup.folderId === folder.id
                ? {
                    ...popup,
                    isPersistent: true,
                    isHighlighted: alreadyPersistent,
                  }
                : popup,
            ),
          )
          if (alreadyPersistent) {
            window.setTimeout(() => {
              setPopups((prev) =>
                prev.map((popup) =>
                  popup.folderId === folder.id ? { ...popup, isHighlighted: false } : popup,
                ),
              )
            }, 2000)
          }
        }
        return
      }

      const rect = event.currentTarget?.getBoundingClientRect()
      if (!rect) return

      const timeoutKey = parentPopupId ? `${parentPopupId}-${folder.id}` : folder.id

      const createPopup = async () => {
        const currentPopups = popupsRef.current
        if (currentPopups.some((p) => p.folderId === folder.id)) return

        const sharedTransform = layerContext?.transforms.popups || DEFAULT_TRANSFORM
        const spaceRight = window.innerWidth - rect.right
        let popupPosition = { x: rect.right + 10, y: rect.top }
        if (spaceRight < 320) {
          popupPosition = { x: rect.left - 320, y: rect.top }
        }

        const canvasPosition = CoordinateBridge.screenToCanvas(popupPosition, sharedTransform)
        const screenPosition = CoordinateBridge.canvasToScreen(canvasPosition, sharedTransform)

        const parentLevel = currentPopups.find((p) => p.id === parentPopupId)?.level || 0

        let inheritedColor = folder.color
        if (!inheritedColor && parentPopupId) {
          const parentPopup = currentPopups.find((p) => p.id === parentPopupId)
          if (parentPopup?.folder?.color) {
            inheritedColor = parentPopup.folder.color
          } else if (!parentPopup?.isLoading && knowledgeBaseWorkspace?.appendWorkspaceParam) {
            const appendParam = knowledgeBaseWorkspace.appendWorkspaceParam
            const workspaceId = knowledgeBaseWorkspace.workspaceId ?? null
            let currentParentId = folder.parentId ?? (folder as any).parent_id
            let depth = 0
            const maxDepth = 10
            while (currentParentId && !inheritedColor && depth < maxDepth) {
              try {
                const response = await fetch(appendParam(`/api/items/${currentParentId}`, workspaceId))
                if (!response.ok) break
                const parentData = await response.json()
                const parentFolder = parentData.item || parentData
                if (parentFolder.color) {
                  inheritedColor = parentFolder.color
                  break
                }
                currentParentId = parentFolder.parentId ?? parentFolder.parent_id
                depth += 1
              } catch (error) {
                console.warn("[handleFolderHover] Failed to fetch ancestor color", error)
                break
              }
            }
          }
        }

        const cachedEntry = folderCache?.getEntry(folder.id)
        const normalizeChild = (item: any): OrgItem => {
          if (item && typeof item === "object" && "hasChildren" in item) {
            return { ...(item as OrgItem) }
          }
          return {
            id: item.id,
            name: item.name ?? deriveFromPath(item.path) ?? "Untitled",
            type: item.type === "note" ? "note" : "folder",
            icon: item.icon || (item.type === "folder" ? "📁" : "📄"),
            color: item.color,
            path: item.path,
            hasChildren: item.type === "folder",
            level: (folder.level ?? 0) + 1,
            children: [],
            parentId: item.parentId ?? item.parent_id,
          }
        }

        let initialChildren: OrgItem[] | null = null
        if (Array.isArray(cachedEntry?.children) && cachedEntry.children.length > 0) {
          initialChildren = (cachedEntry.children as any[]).map(normalizeChild)
        }

        const popupId = `overlay-popup-${Date.now()}-${folder.id}`
        const newPopup: OverlayPopup = {
          id: popupId,
          folderId: folder.id,
          folderName: folder.name,
          folder: {
            id: folder.id,
            name: folder.name,
            type: "folder" as const,
            level: parentLevel + 1,
            color: inheritedColor,
            path: (folder as any).path,
            children: initialChildren ?? [],
          },
          position: screenPosition,
          canvasPosition,
          width: popupWidth,
          sizeMode: "default",
          children: initialChildren ?? [],
          isLoading: !initialChildren,
          isPersistent,
          isHighlighted: false,
          level: parentLevel + 1,
          parentId: parentPopupId || null,
          parentPopupId: parentPopupId || undefined,
        }

        setPopups((prev) => [...prev, newPopup])

        try {
          const children = fetchChildren ? await fetchChildren(folder.id, { forceRefresh: isPersistent }) : null
          if (children && Array.isArray(children)) {
            const formattedChildren: OrgItem[] = children.map((item: any) => ({
              id: item.id,
              name: item.name,
              type: item.type,
              icon: item.icon || (item.type === "folder" ? "📁" : "📄"),
              color: item.color,
              path: item.path,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              hasChildren: item.type === "folder",
              level: folder.level + 1,
              children: [],
              parentId: item.parentId,
            }))

            setPopups((prev) =>
              prev.map((popup) =>
                popup.id === popupId
                  ? {
                      ...popup,
                      children: formattedChildren,
                      isLoading: false,
                      folder: popup.folder ? { ...popup.folder, children: formattedChildren } : null,
                    }
                  : popup,
              ),
            )
            folderCache?.updateFolderSnapshot(folder.id, folder)
            folderCache?.updateChildrenSnapshot(folder.id, children)
          }
        } catch (error) {
          console.error("[handleFolderHover] Failed to load folder contents", error)
          setPopups((prev) => prev.filter((popup) => popup.id !== popupId))
        }
      }

      if (!isPersistent) {
        const timeout = window.setTimeout(() => {
          hoverTimeouts.current.delete(timeoutKey)
          void createPopup()
        }, 300)
        setHoverTimeout(timeoutKey, timeout)
        return
      }

      await createPopup()
    },
    [
      ensureOverlayHydrated,
      fetchChildren,
      folderCache,
      layerContext,
      popupWidth,
      setHoverTimeout,
      setPopups,
      knowledgeBaseWorkspace,
    ],
  )

  const handleFolderHoverLeave = useCallback(
    (folderId?: string, parentPopupId?: string) => {
      if (!folderId) return
      const timeoutKey = parentPopupId ? `${parentPopupId}-${folderId}` : folderId
      clearHoverTimeout(timeoutKey)

      const closeTimeout = window.setTimeout(() => {
        closeTimeouts.current.delete(timeoutKey)
        setPopups((prev) =>
          prev.filter((popup) => {
            if (popup.isPersistent) return true
            return popup.folderId !== folderId
          }),
        )
      }, 300)

      setCloseTimeout(timeoutKey, closeTimeout)
    },
    [clearHoverTimeout, setCloseTimeout, setPopups],
  )

  return useMemo(
    () => ({
      popups,
      setPopups,
      draggingPopup,
      setDraggingPopup,
      overlayPanning,
      setOverlayPanning,
      moveCascadeState,
      setMoveCascadeState,
      hoverTimeouts,
      closeTimeouts,
      setHoverTimeout,
      clearHoverTimeout,
      setCloseTimeout,
      clearCloseTimeout,
      clearAllTimeouts,
      handlePopupDragStart,
      handlePopupDragMove,
      handlePopupDragEnd,
      getAllDescendants,
      toggleMoveCascade,
      clearMoveCascadeState,
      closePopupCascade,
      initiateCloseMode,
      confirmCloseMode,
      cancelCloseMode,
      togglePinCascade,
      handleFolderHover,
      handleFolderHoverLeave,
    }),
    [
      popups,
      draggingPopup,
      overlayPanning,
      moveCascadeState,
      setMoveCascadeState,
      setHoverTimeout,
      clearHoverTimeout,
      setCloseTimeout,
      clearCloseTimeout,
      clearAllTimeouts,
      handlePopupDragStart,
      handlePopupDragMove,
      handlePopupDragEnd,
      getAllDescendants,
      toggleMoveCascade,
      clearMoveCascadeState,
      closePopupCascade,
      initiateCloseMode,
      confirmCloseMode,
      cancelCloseMode,
      togglePinCascade,
      handleFolderHover,
      handleFolderHoverLeave,
    ],
  )
}
