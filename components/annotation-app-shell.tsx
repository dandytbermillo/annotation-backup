"use client"

import { useState, useRef, useEffect, useCallback, useMemo, useReducer } from "react"
import { CanvasAwareFloatingToolbar } from "./canvas-aware-floating-toolbar"
import type { OverlayPopup } from "./floating-toolbar"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import { createNote } from "@/lib/utils/note-creator"
import { LayerProvider, useLayer } from "@/components/canvas/layer-provider"
import {
  OverlayLayoutConflictError,
  isOverlayPersistenceEnabled,
} from "@/lib/adapters/overlay-layout-adapter"
import { debugLog, isDebugEnabled } from "@/lib/utils/debug-logger"
import { toast } from "@/hooks/use-toast"
import { CanvasWorkspaceProvider, useCanvasWorkspace, SHARED_WORKSPACE_ID } from "./canvas/canvas-workspace-context"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { useCanvasCentering } from "@/lib/hooks/annotation/use-canvas-centering"
import { ConstellationProvider } from "@/components/constellation/constellation-context"
import type { CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import { WorkspaceToggleMenu } from "@/components/workspace/workspace-toggle-menu"
import { AnnotationWorkspaceCanvas } from "@/components/workspace/annotation-workspace-canvas"
import { WorkspaceConstellationLayer } from "@/components/workspace/workspace-constellation-layer"
import type { OverlayCameraState } from "@/lib/types/overlay-layout"
import { Z_INDEX } from "@/lib/constants/z-index"
import { useNotePreviewHover } from "@/hooks/useNotePreviewHover"
import { useKnowledgeBaseWorkspace } from "@/lib/hooks/annotation/use-knowledge-base-workspace"
import { useFolderCache } from "@/lib/hooks/annotation/use-folder-cache"
import { usePopupOverlayState } from "@/lib/hooks/annotation/use-popup-overlay-state"
import { useOverlayPopupLayout } from "@/lib/hooks/annotation/use-overlay-popup-layout"
import { useOverlayLayoutPersistence } from "@/lib/hooks/annotation/use-overlay-layout-persistence"
import { useOverlayLayoutSaveQueue } from "@/lib/hooks/annotation/use-overlay-layout-save-queue"
import { useOverlayWorkspaces } from "@/lib/hooks/annotation/use-overlay-workspaces"
import type { SidebarNotePreviewContext } from "@/lib/hooks/annotation/use-sidebar-folder-popups"
import { useWorkspaceSidebarHover } from "@/lib/hooks/annotation/use-workspace-sidebar-hover"
import { useWorkspaceNotesWidget } from "@/lib/hooks/annotation/use-workspace-notes-widget"
import { useConstellationViewState } from "@/lib/hooks/annotation/use-constellation-view-state"
import { useOrganizationSidebarActions } from "@/lib/hooks/annotation/use-organization-sidebar-actions"
import { usePopupBulkActions } from "@/lib/hooks/annotation/use-popup-bulk-actions"
import { useKnowledgeBaseSidebar } from "@/lib/hooks/annotation/use-knowledge-base-sidebar"
import { useWorkspaceNoteTitleSync } from "@/lib/hooks/annotation/use-workspace-note-title-sync"
import { useWorkspaceNoteSelection } from "@/lib/hooks/annotation/use-workspace-note-selection"
import { useWorkspacePanelPositions } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import { useWorkspaceMainOnlyNotes } from "@/lib/hooks/annotation/use-workspace-main-only-notes"
import { useWorkspaceCanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import { useOverlayDragHandlers } from "@/lib/hooks/annotation/use-overlay-drag-handlers"
import { useWorkspaceOverlayPersistence } from "@/lib/hooks/annotation/use-workspace-overlay-persistence"
import { useWorkspaceOverlayInteractions } from "@/lib/hooks/annotation/use-workspace-overlay-interactions"
import { useWorkspaceSidebarState } from "@/lib/hooks/annotation/use-workspace-sidebar-state"
import { AnnotationWorkspaceView } from "@/components/annotation-workspace-view"
import type { AnnotationWorkspaceViewProps } from "@/components/annotation-workspace-view/types"
import { useOverlayPersistenceRefs } from "@/lib/hooks/annotation/use-overlay-persistence-refs"
import { useWorkspacePreviewPortal } from "@/lib/hooks/annotation/use-workspace-preview-portal"
import { useWorkspaceFloatingToolbar } from "@/lib/hooks/annotation/use-workspace-floating-toolbar"
import { useWorkspaceOverlayProps } from "@/lib/hooks/annotation/use-workspace-overlay-props"
import { useWorkspaceToolbarProps } from "@/lib/hooks/annotation/use-workspace-toolbar-props"
import { useNoteWorkspaces } from "@/lib/hooks/annotation/use-note-workspaces"
import { isOverlayOptimisticHydrationEnabled } from "@/lib/flags/overlay"

const FOLDER_CACHE_MAX_AGE_MS = 30000

// Helper to derive display name from path when folder.name is empty
function deriveFromPath(path: string | undefined | null): string | null {
  if (!path || typeof path !== 'string') return null
  const trimmed = path.trim()
  if (!trimmed) return null

  // Remove trailing slashes
  const normalized = trimmed.replace(/\/+$/, '')
  if (!normalized) return null

  // Get last segment
  const segments = normalized.split('/')
  const lastSegment = segments[segments.length - 1]
  return lastSegment && lastSegment.trim() ? lastSegment.trim() : null
}

const DEFAULT_CAMERA: OverlayCameraState = { x: 0, y: 0, scale: 1 }

const camerasEqual = (a: OverlayCameraState, b: OverlayCameraState) =>
  a.x === b.x && a.y === b.y && a.scale === b.scale

const formatOverlaySyncLabel = (date: Date) =>
  `Overlay synced at ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`

const DEFAULT_POPUP_WIDTH = 300
const DEFAULT_POPUP_HEIGHT = 400
const MIN_POPUP_WIDTH = 200
const MIN_POPUP_HEIGHT = 200
const MAX_POPUP_WIDTH = 900
const MAX_POPUP_HEIGHT = 900

type AnnotationAppContentProps = {
  useShellView?: boolean
}

function AnnotationAppContent({ useShellView = false }: AnnotationAppContentProps) {
  const {
    openNotes,
    openNote: openWorkspaceNote,
    closeNote: closeWorkspaceNote,
    isWorkspaceReady,
    isWorkspaceLoading,
    isHydrating,
    workspaceError,
    refreshWorkspace,
    getPendingPosition,
    getCachedPosition,
    getWorkspace
  } = useCanvasWorkspace()
  const sharedWorkspace = useMemo(() => getWorkspace(SHARED_WORKSPACE_ID), [getWorkspace])

  // Initialize activeNoteId from localStorage (persist which note canvas is focused)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored =
          localStorage.getItem('annotation_activeNoteId') ??
          localStorage.getItem('annotation_focusedNoteId') ??
          localStorage.getItem('annotation_selectedNoteId')
        return stored || null
      } catch (err) {
        debugLog({
          component: 'AnnotationApp',
          action: 'localStorage_focus_load_failed',
          metadata: { error: err instanceof Error ? err.message : 'Unknown error' }
        })
        return null
      }
    }
    return null
  })
  const [skipSnapshotForNote, setSkipSnapshotForNote] = useState<string | null>(null)
  const layerContext = useLayer()
  const {
    activeSidebarTab,
    showConstellationPanel,
    canvasMode,
    setCanvasMode,
    handleSidebarTabChange,
    toggleConstellationView,
  } = useConstellationViewState({ layerContext })
  const multiLayerEnabled = true
  const [shouldLoadOverlay, setShouldLoadOverlay] = useState(false)
  const overlayHydrationTriggerRef = useRef<string | null>(null)

  const ensureOverlayHydrated = useCallback((reason: string) => {
    setShouldLoadOverlay(prev => {
      if (prev) return prev
      overlayHydrationTriggerRef.current = reason
      return true
    })
  }, [])

  useEffect(() => {
    if (!shouldLoadOverlay) return
    const trigger = overlayHydrationTriggerRef.current ?? 'unknown'
    if (isDebugEnabled()) {
      debugLog({
        component: 'AnnotationApp',
        action: 'overlay_hydration_enabled',
        metadata: { trigger },
      })
    } else {
      console.log(`[AnnotationApp] Overlay hydration enabled (${trigger})`)
    }
    overlayHydrationTriggerRef.current = null
  }, [shouldLoadOverlay])

  useEffect(() => {
    if (layerContext?.activeLayer === 'popups') {
      ensureOverlayHydrated('layer-active')
    }
  }, [layerContext?.activeLayer, ensureOverlayHydrated])

  const activeNoteIdRef = useRef<string | null>(activeNoteId)
  useEffect(() => {
    activeNoteIdRef.current = activeNoteId
  }, [activeNoteId])

  const {
    canvasRef,
    freshNoteSeeds,
    freshNoteIds,
    registerFreshNote,
    consumeFreshNoteSeed,
    storeFreshNoteSeed,
    handleFreshNoteHydrated,
    handleSnapshotLoadComplete,
    centerNoteOnCanvas,
  } = useCanvasCentering({
    activeNoteIdRef,
    debugLog,
    sharedWorkspace,
  })


  const {
    canvasState,
    setCanvasState,
    handleCanvasStateChange,
    lastCanvasInteractionRef,
    reopenSequenceRef,
    newNoteSequenceRef,
  } = useWorkspaceCanvasState()
  const { mainOnlyNotes, requestMainOnlyNote, handleMainOnlyLayoutHandled } = useWorkspaceMainOnlyNotes()

  // Display settings state (backdrop style preference)
  const [backdropStyle, setBackdropStyle] = useState<string>('opaque')

  // Overlay popups state - persists independently of toolbar (like activeNoteId)
  const latestCameraRef = useRef<OverlayCameraState>(DEFAULT_CAMERA)
  const prevCameraForSaveRef = useRef<OverlayCameraState>(DEFAULT_CAMERA)
  const overlayCameraFromUserRef = useRef<{ transform: OverlayCameraState; timestamp: number }>({
    transform: DEFAULT_CAMERA,
    timestamp: 0,
  })
  const knowledgeBaseWorkspace = useKnowledgeBaseWorkspace()
  const {
    workspaceId: knowledgeBaseWorkspaceId,
    appendWorkspaceParam: appendKnowledgeBaseWorkspaceParam,
    withWorkspaceHeaders: withKnowledgeBaseHeaders,
    withWorkspacePayload: withKnowledgeBasePayload,
    fetchWithWorkspace: fetchWithKnowledgeBase,
    resolveWorkspaceId: resolveKnowledgeBaseWorkspaceId,
  } = knowledgeBaseWorkspace
  const applyWorkspacePayload = useCallback(
    (payload: Record<string, unknown>, workspaceId: string | null) =>
      withKnowledgeBasePayload(payload, workspaceId ?? undefined),
    [withKnowledgeBasePayload],
  )

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [isWorkspaceLayoutLoading, setIsWorkspaceLayoutLoading] = useState(false)
  const [overlayStatusLabel, setOverlayStatusLabel] = useState<string | null>(null)
  const [hydrationVeilActive, setHydrationVeilActive] = useState(false)
  const hydrationVeilTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasShownHydrationVeilRef = useRef(false)
  const workspacesLoadedRef = useRef(false)
  const lastDiagnosticsHashRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (hydrationVeilTimeoutRef.current) {
        clearTimeout(hydrationVeilTimeoutRef.current)
      }
    }
  }, [])
  const fetchNotePreview = useCallback(
    async (noteId: string) => {
      const response = await fetchWithKnowledgeBase(`/api/items/${noteId}`)
      if (!response.ok) throw new Error('Failed to fetch note')
      const data = await response.json()
      return {
        content: data?.item?.content,
        contentText: data?.item?.contentText,
      }
    },
    [fetchWithKnowledgeBase]
  )

  const {
    preview: notePreview,
    isLoading: isLoadingNotePreview,
    handleHover: triggerNotePreviewHover,
    handleLeave: triggerNotePreviewLeave,
    handleTooltipEnter: triggerNotePreviewTooltipEnter,
    handleTooltipLeave: triggerNotePreviewTooltipLeave,
    cancelPreview: cancelNotePreview,
  } = useNotePreviewHover<SidebarNotePreviewContext>({
    fetchNote: fetchNotePreview,
  })

  const folderCacheApi = useFolderCache({
    workspaceId: knowledgeBaseWorkspaceId,
    cacheMaxAgeMs: FOLDER_CACHE_MAX_AGE_MS,
  })
  const {
    getEntry: getFolderCacheEntry,
    updateFolderSnapshot: updateFolderCacheEntry,
    updateChildrenSnapshot: updateFolderCacheChildren,
    invalidate: invalidateFolderCache,
    fetchFolder: fetchGlobalFolder,
    fetchChildren: fetchGlobalChildren,
  } = folderCacheApi

  const sidebarLoaderDeps = useMemo(
    () => ({
      appendWorkspaceParam: appendKnowledgeBaseWorkspaceParam,
      fetchWithWorkspace: fetchWithKnowledgeBase,
      knowledgeBaseWorkspaceId,
      resolveWorkspaceId: resolveKnowledgeBaseWorkspaceId,
      updateFolderCacheEntry,
      updateFolderCacheChildren,
    }),
    [
      appendKnowledgeBaseWorkspaceParam,
      fetchWithKnowledgeBase,
      knowledgeBaseWorkspaceId,
      resolveKnowledgeBaseWorkspaceId,
      updateFolderCacheEntry,
      updateFolderCacheChildren,
    ],
  )

  const noteTitleDeps = useMemo(
    () => ({
      fetchWithKnowledgeBase,
    }),
    [fetchWithKnowledgeBase],
  )

  const {
    organizationSidebarData: sidebarState,
    knowledgeBaseId,
    noteTitleMapRef,
    forceNoteTitleUpdate,
    setTitleForNote,
    ensureTitleFromServer,
  } = useKnowledgeBaseSidebar({
    loader: sidebarLoaderDeps,
    noteTitles: noteTitleDeps,
    sharedWorkspace,
    enabled: shouldLoadOverlay,
  })

  const sortedOpenNotes = useMemo(() => {
    return [...openNotes].sort((a, b) => {
      if (a.noteId === b.noteId) return 0
      if (!a.updatedAt && b.updatedAt) return 1
      if (a.updatedAt && !b.updatedAt) return -1
      if (a.updatedAt && b.updatedAt) {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
      return a.noteId.localeCompare(b.noteId)
    })
  }, [openNotes])

  useWorkspaceNoteTitleSync({
    sharedWorkspace,
    sortedOpenNotes,
    noteTitleMapRef,
    setTitleForNote,
    ensureTitleFromServer,
    forceNoteTitleUpdate,
  })

  const {
    logWorkspaceNotePositions,
    resolveMainPanelPosition,
    hasRenderedMainPanel,
    panelSnapshotVersion,
    getPanelSnapshot,
  } = useWorkspacePanelPositions({
    sharedWorkspace,
    sortedOpenNotes,
    openNotes,
    activeNoteId,
    getPendingPosition,
    getCachedPosition,
    debugLog,
  })

  const handleNoteWorkspaceUnavailable = useCallback(() => {
    toast({
      variant: "destructive",
      title: "Note workspaces unavailable",
      description: "Saving layouts is disabled until the service is available.",
    })
  }, [])

  const noteWorkspaceState = useNoteWorkspaces({
    openNotes,
    activeNoteId,
    setActiveNoteId,
    resolveMainPanelPosition,
    openWorkspaceNote,
    closeWorkspaceNote,
    layerContext,
    isWorkspaceReady,
    getPanelSnapshot,
    panelSnapshotVersion,
    canvasState,
    setCanvasState,
    onUnavailable: handleNoteWorkspaceUnavailable,
    debugLog,
    sharedWorkspace,
  })

  const currentNoteWorkspace = useMemo(
    () => noteWorkspaceState.workspaces.find((workspace) => workspace.id === noteWorkspaceState.currentWorkspaceId) ?? null,
    [noteWorkspaceState.currentWorkspaceId, noteWorkspaceState.workspaces],
  )

  const {
    popups: overlayPopups,
    setPopups: setOverlayPopups,
    draggingPopup,
    setDraggingPopup,
    overlayPanning,
    setOverlayPanning,
    moveCascadeState,
    hoverTimeouts,
    closeTimeouts,
    setHoverTimeout,
    clearHoverTimeout,
    setCloseTimeout,
    clearCloseTimeout,
    clearAllTimeouts,
    handlePopupDragStart: startPopupDrag,
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
  } = usePopupOverlayState({
    layerContext,
    knowledgeBaseWorkspace,
    folderCache: folderCacheApi,
    fetchChildren: fetchGlobalChildren,
    ensureOverlayHydrated,
    popupWidth: DEFAULT_POPUP_WIDTH,
  })
  const {
    createOverlayPopup: handleCreateOverlayPopup,
    updatePopupPosition: handlePopupPositionChange,
    resizePopup: handleResizePopup,
  } = useOverlayPopupLayout({
    setPopups: setOverlayPopups,
    ensureOverlayHydrated,
    defaultWidth: DEFAULT_POPUP_WIDTH,
    defaultHeight: DEFAULT_POPUP_HEIGHT,
    minWidth: MIN_POPUP_WIDTH,
    maxWidth: MAX_POPUP_WIDTH,
    minHeight: MIN_POPUP_HEIGHT,
    maxHeight: MAX_POPUP_HEIGHT,
  })
  const { handleDeleteSelected, handleBulkMove } = usePopupBulkActions({
    fetchWithKnowledgeBase,
    withKnowledgeBasePayload: applyWorkspacePayload,
    knowledgeBaseWorkspaceId,
    setOverlayPopups,
    folderCacheApi: {
      updateFolderCacheChildren,
      invalidateFolderCache,
    },
  })

  const {
    showNotesWidget,
    setShowNotesWidget,
    notesWidgetPosition,
    setNotesWidgetPosition,
    activeEditorRef,
    activePanelId,
    setActivePanelId,
    toolbarActivePanel,
    setToolbarActivePanel,
    recentNotesRefreshTrigger,
    bumpRecentNotesRefresh,
    showAddComponentMenu,
    setShowAddComponentMenu,
    handleContextMenu,
  } = useWorkspaceNotesWidget({
    layerContext,
    multiLayerEnabled,
    clearAllTimeouts,
    canvasState,
    debugLog,
  })

  const organizationFolders = sidebarState.organizationFolders

  const { handleOrganizationSidebarSelect } = useOrganizationSidebarActions({
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
    defaultPopupWidth: DEFAULT_POPUP_WIDTH,
    defaultPopupHeight: DEFAULT_POPUP_HEIGHT,
    folderCacheApi: {
      updateFolderCacheEntry,
      updateFolderCacheChildren,
      invalidateFolderCache,
    },
  })

  const organizationSidebarData = useMemo(() => {
    const pinnedIds = new Set(
      overlayPopups.filter(popup => popup.isPinned).map(popup => popup.folderId || popup.id)
    )

    const items = organizationFolders.map(item => ({
      ...item,
      pinned: pinnedIds.has(item.id),
    }))

    const totalItems = items.reduce((sum, item) => sum + (item.count ?? 0), 0)

    return {
      items,
      stats: {
        openPopups: overlayPopups.length,
        totalItems,
        pinnedPopups: pinnedIds.size,
      },
    }
  }, [organizationFolders, overlayPopups])


  const isPopupLayerActive = multiLayerEnabled && layerContext?.activeLayer === 'popups'
  const canRenderOverlay =
    shouldLoadOverlay &&
    !showConstellationPanel &&
    (!multiLayerEnabled || !layerContext || layerContext.activeLayer === 'popups')
  const shouldShowSidebar = showConstellationPanel || isPopupLayerActive

  // Persistence state for overlay layout
  const overlayPersistenceEnabled = isOverlayPersistenceEnabled()
  const overlayOptimisticHydrationEnabled = isOverlayOptimisticHydrationEnabled()
  const overlayPersistenceActive = overlayPersistenceEnabled && shouldLoadOverlay
  const shouldShowWorkspaceToggle = overlayPersistenceActive && shouldShowSidebar

  useEffect(() => {
    overlayCameraFromUserRef.current = { transform: DEFAULT_CAMERA, timestamp: 0 }
    if (overlayOptimisticHydrationEnabled) {
      setOverlayStatusLabel(null)
    }
  }, [currentWorkspaceId, overlayOptimisticHydrationEnabled])

  const overlayPopupCount = overlayPopups.length

  useEffect(() => {
    if (!overlayOptimisticHydrationEnabled || !overlayPersistenceActive) {
      setOverlayStatusLabel(null)
      setHydrationVeilActive(false)
      if (hydrationVeilTimeoutRef.current) {
        clearTimeout(hydrationVeilTimeoutRef.current)
        hydrationVeilTimeoutRef.current = null
      }
      return
    }

    if (isWorkspaceLayoutLoading) {
      setOverlayStatusLabel("Hydrating overlay…")
      if (!hasShownHydrationVeilRef.current && overlayPopupCount === 0) {
        setHydrationVeilActive(true)
        if (hydrationVeilTimeoutRef.current) {
          clearTimeout(hydrationVeilTimeoutRef.current)
        }
        hydrationVeilTimeoutRef.current = setTimeout(() => {
          setHydrationVeilActive(false)
          hydrationVeilTimeoutRef.current = null
          hasShownHydrationVeilRef.current = true
        }, 200)
      }
      return
    }

    setHydrationVeilActive(false)
    if (hydrationVeilTimeoutRef.current) {
      clearTimeout(hydrationVeilTimeoutRef.current)
      hydrationVeilTimeoutRef.current = null
      hasShownHydrationVeilRef.current = true
    }

    setOverlayStatusLabel(formatOverlaySyncLabel(new Date()))
  }, [
    overlayOptimisticHydrationEnabled,
    overlayPersistenceActive,
    isWorkspaceLayoutLoading,
    overlayPopupCount,
  ])

  const {
    overlayAdapterRef,
    layoutLoadedRef,
    layoutRevisionRef,
    lastSavedLayoutHashRef,
    pendingLayoutRef,
    saveInFlightRef,
    saveTimeoutRef,
    isInitialLoadRef,
    layoutLoadStartedAtRef,
    hydrationRunIdRef,
    layoutDirtyRef,
  } = useOverlayPersistenceRefs()

  const { applyOverlayLayout } = useOverlayLayoutPersistence({
    overlayPersistenceActive,
    currentWorkspaceId,
    overlayPopups,
    overlayPopupsLength: overlayPopups.length,
    optimisticHydrationEnabled: overlayOptimisticHydrationEnabled,
    setOverlayPopups,
    fetchGlobalFolder,
    fetchGlobalChildren,
    fetchWithKnowledgeBase,
    toast,
    layerContext,
    debugLog,
    isDebugEnabled,
    overlayAdapterRef,
    layoutLoadedRef,
    layoutRevisionRef,
    lastSavedLayoutHashRef,
    pendingLayoutRef,
    saveInFlightRef,
    saveTimeoutRef,
    isInitialLoadRef,
    latestCameraRef,
    prevCameraForSaveRef,
    setIsWorkspaceLayoutLoading,
    defaultCamera: DEFAULT_CAMERA,
    overlayCameraFromUserRef,
    layoutLoadStartedAtRef,
    hydrationRunIdRef,
    layoutDirtyRef,
  })

  const hydrationUserDragLoggedRef = useRef(false)

  const handleOverlayUserCameraTransform = useCallback(
    (snapshot: { transform: OverlayCameraState; timestamp: number }) => {
      overlayCameraFromUserRef.current = snapshot
      if (!overlayOptimisticHydrationEnabled) {
        return
      }
      if (!isWorkspaceLayoutLoading) {
        return
      }
      layoutDirtyRef.current = true
      if (hydrationUserDragLoggedRef.current) {
        return
      }
      hydrationUserDragLoggedRef.current = true
      const startedAt = layoutLoadStartedAtRef.current
      const delta =
        startedAt > 0 ? Math.max(0, snapshot.timestamp - startedAt) : snapshot.timestamp
      void debugLog({
        component: "PopupOverlay",
        action: "overlay_layout_user_drag_during_hydrate",
        metadata: {
          workspaceId: currentWorkspaceId,
          firstDragMsSinceStart: delta,
        },
      })
    },
    [
      overlayOptimisticHydrationEnabled,
      isWorkspaceLayoutLoading,
      layoutDirtyRef,
      layoutLoadStartedAtRef,
      currentWorkspaceId,
      debugLog,
    ],
  )

  useEffect(() => {
    if (!isWorkspaceLayoutLoading) {
      hydrationUserDragLoggedRef.current = false
    }
  }, [isWorkspaceLayoutLoading])

  // Debug: Log persistence state on mount
  useEffect(() => {
    console.log('[AnnotationApp] overlayPersistenceEnabled =', overlayPersistenceEnabled)
  }, [overlayPersistenceEnabled])

  useEffect(() => {
    if (!isWorkspaceReady && !isWorkspaceLoading) {
      refreshWorkspace().catch(error => {
        console.error('[AnnotationApp] Workspace refresh failed:', error)
      })
    }
  }, [isWorkspaceReady, isWorkspaceLoading, refreshWorkspace])

  useEffect(() => {
    if (workspaceError) {
      console.error('[AnnotationApp] Workspace error:', workspaceError)
    }
  }, [workspaceError])

  useEffect(() => {
    if (!isWorkspaceReady) return

    const isFocusedOpen = activeNoteId ? openNotes.some(note => note.noteId === activeNoteId) : false

    if (!initialWorkspaceSyncRef.current) {
      initialWorkspaceSyncRef.current = true

      if (activeNoteId && !isFocusedOpen) {
        const pendingPosition = getPendingPosition(activeNoteId)
        const cachedPosition = getCachedPosition(activeNoteId)
        const resolvedPosition = resolveMainPanelPosition(activeNoteId)
        console.log(`[DEBUG AnnotationApp] Hydration position for ${activeNoteId}:`, {
          pendingPosition,
          cachedPosition,
          resolvedPosition
        })
        void openWorkspaceNote(activeNoteId, {
          persist: true,
          mainPosition: resolvedPosition ?? undefined,
        }).catch(error => {
          console.error('[AnnotationApp] Failed to ensure focused note is open:', error)
        })
      } else if (!activeNoteId && openNotes.length > 0) {
        setActiveNoteId(openNotes[0].noteId)
      }
    } else if (activeNoteId && !isFocusedOpen) {
      const fallback = openNotes[0]?.noteId ?? null
      setActiveNoteId(fallback ?? null)
    }
  }, [isWorkspaceReady, openNotes, activeNoteId, openWorkspaceNote, getPendingPosition, getCachedPosition, resolveMainPanelPosition])

  // Persist activeNoteId to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (activeNoteId) {
          localStorage.setItem('annotation_activeNoteId', activeNoteId)
          localStorage.setItem('annotation_focusedNoteId', activeNoteId)
        } else {
          localStorage.removeItem('annotation_activeNoteId')
          localStorage.removeItem('annotation_focusedNoteId')
        }
      } catch (err) {
        debugLog({
          component: 'AnnotationApp',
          action: 'localStorage_focus_save_failed',
          metadata: {
            error: err instanceof Error ? err.message : 'Unknown error',
            operation: activeNoteId ? 'setItem' : 'removeItem'
          }
        })
      }
    }
  }, [activeNoteId, logWorkspaceNotePositions])

const initialWorkspaceSyncRef = useRef(false)

  // Determine collaboration mode from environment
  const collabMode = process.env.NEXT_PUBLIC_COLLAB_MODE || 'plain'
  const isPlainMode = collabMode === 'plain'
  // Adapt overlay popups for PopupOverlay component
  // Only show popups when popups layer is active, otherwise pass empty Map
  const adaptedPopups = useMemo(() => {
    const adapt = () => {
      const adapted = new Map()
      overlayPopups.forEach((popup) => {
        const adaptedPopup = {
          ...popup,
          width: popup.width ?? DEFAULT_POPUP_WIDTH,
          height: popup.height,
          sizeMode: popup.sizeMode ?? 'default',
          folder: popup.folder || {
            id: popup.folderId,
            name: popup.folderName,
            type: 'folder' as const,
            children: popup.children
          },
          canvasPosition: popup.canvasPosition,
          parentId: popup.parentPopupId // Map parentPopupId to parentId for PopupOverlay
        }
        adapted.set(popup.id, adaptedPopup)
      })
      return adapted
    }

    if (!multiLayerEnabled) {
      return adapt()
    }

    // When no layer context is available, still render popups using raw state
    if (!layerContext) {
      return adapt()
    }

    return adapt()
  }, [overlayPopups, multiLayerEnabled, layerContext, layerContext?.activeLayer])

  // Track previous popup count to detect when NEW popups are added
  const prevPopupCountRef = useRef(0)

  // Auto-switch to popups layer ONLY when NEW popups are created
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return

    const currentCount = overlayPopups.length
    const previousCount = prevPopupCountRef.current

    // Skip auto-switch while layout is still loading from database (initial hydration)
    // This prevents auto-switch when restoring saved popups on app load
    if (!layoutLoadedRef.current) {
      prevPopupCountRef.current = currentCount
      return
    }

    // Only auto-switch when a new popup is ADDED (count increases) AFTER layout loaded
    if (currentCount > previousCount && currentCount > 0) {
      if (layerContext.activeLayer !== 'popups') {
        console.log('[AnnotationApp] New popup created, auto-switching to popups layer')
        layerContext.setActiveLayer('popups')
      }
    }

    // Update the ref for next comparison
    prevPopupCountRef.current = currentCount
  }, [overlayPopups.length, multiLayerEnabled, layerContext])

  // Clear pending hover timeouts when switching TO notes layer (prevent new popups)
  // But keep existing popups in state so they can be restored when switching back
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return

    // When user switches to notes layer, clear pending timeouts but keep popup state
    if (layerContext.activeLayer === 'notes') {
      console.log('[AnnotationApp] Switched to notes layer, clearing pending hover timeouts')

      // Clear all pending timeouts to prevent new popups from appearing
      clearAllTimeouts()
    }
  }, [layerContext?.activeLayer, multiLayerEnabled, layerContext])

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear all hover timeouts
      clearAllTimeouts()
    }
  }, [])

  // Handle global mouse events for dragging popup
  const draggingActive = useOverlayDragHandlers({
    draggingPopup,
    onDragMove: handlePopupDragMove,
    onDragEnd: handlePopupDragEnd,
    layerContext,
  })


  const {
    buildLayoutPayload,
    flushLayoutSave,
    scheduleLayoutSave,
  } = useOverlayLayoutSaveQueue({
    overlayPopups,
    layerTransform: layerContext?.transforms.popups || DEFAULT_CAMERA,
    overlayPersistenceActive,
    overlayAdapterRef,
    layoutRevisionRef,
    lastSavedLayoutHashRef,
    pendingLayoutRef,
    saveTimeoutRef,
    saveInFlightRef,
    applyOverlayLayout,
    draggingPopup,
    defaultCamera: DEFAULT_CAMERA,
    defaultWidth: DEFAULT_POPUP_WIDTH,
    defaultHeight: DEFAULT_POPUP_HEIGHT,
    debugLog,
    isDebugEnabled,
  })

  useWorkspaceOverlayPersistence({
    overlayPopups,
    overlayPersistenceActive,
    overlayPersistenceEnabled,
    overlayPanning,
    draggingActive,
    layerTransform: layerContext?.transforms.popups || DEFAULT_CAMERA,
    latestCameraRef,
    prevCameraForSaveRef,
    layoutLoadedRef,
    scheduleLayoutSave,
    saveTimeoutRef,
    pendingLayoutRef,
    layoutDirtyRef,
  })

  const {
    workspaces,
    isWorkspaceListLoading,
    isWorkspaceSaving,
    workspaceDeletionId,
    workspaceMenuOpen,
    workspaceToggleRef,
    setWorkspaceMenuOpen,
    handleWorkspaceSelect,
    handleCreateWorkspace,
    handleDeleteWorkspace,
  } = useOverlayWorkspaces({
    overlayPersistenceActive,
    shouldShowWorkspaceToggle,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    setCanvasMode,
    ensureOverlayHydrated,
    buildLayoutPayload,
    flushLayoutSave,
    lastSavedLayoutHashRef,
    pendingLayoutRef,
    saveTimeoutRef,
    overlayAdapterRef,
    layoutRevisionRef,
    layoutLoadedRef,
    setOverlayPopups,
    toast,
    workspacesLoadedRef,
    defaultCamera: DEFAULT_CAMERA,
  })

  const [noteWorkspaceMenuOpen, setNoteWorkspaceMenuOpen] = useState(false)

  const currentWorkspace = useMemo(
    () => workspaces.find(ws => ws.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId]
  )
  const currentWorkspaceName = currentWorkspace?.name ?? 'Workspace'
  const workspaceStatusLabel = workspaceDeletionId
    ? 'Deleting...'
    : isWorkspaceSaving
    ? 'Saving...'
    : isWorkspaceLayoutLoading
    ? 'Hydrating...'
    : isWorkspaceListLoading
    ? 'Loading...'
    : currentWorkspaceName
  const workspaceDisplayLabel =
    overlayOptimisticHydrationEnabled && overlayStatusLabel ? currentWorkspaceName : workspaceStatusLabel

  const fallbackNoteWorkspaceName = useMemo(() => {
    const defaultWorkspace = noteWorkspaceState.workspaces.find((workspace) => workspace.isDefault)
    if (defaultWorkspace?.name) {
      return defaultWorkspace.name
    }
    const firstWorkspace = noteWorkspaceState.workspaces[0]
    return firstWorkspace?.name ?? null
  }, [noteWorkspaceState.workspaces])

  const noteWorkspaceStatusLabel = currentNoteWorkspace?.name ?? fallbackNoteWorkspaceName ?? "Note Workspace"

  useEffect(() => {
    if (!overlayPersistenceActive) {
      prevCameraForSaveRef.current = latestCameraRef.current
      return
    }
    if (!layoutLoadedRef.current) {
      prevCameraForSaveRef.current = latestCameraRef.current
      return
    }
    const prev = prevCameraForSaveRef.current
    const current = latestCameraRef.current
    if (!camerasEqual(prev, current)) {
      prevCameraForSaveRef.current = current
      scheduleLayoutSave(false)
    }
  }, [overlayPersistenceActive, scheduleLayoutSave, layerContext?.transforms.popups])

  // Load layout from database on mount
  // Save layout when overlayPopups changes
  // Use a ref to track if we need to save, to avoid infinite loops

  // Handle note selection with force re-center support
  const formatNoteLabel = useCallback((noteId: string) => {
    if (!noteId) return "Untitled"
    const stored = noteTitleMapRef.current.get(noteId)
    if (stored && stored.trim()) {
      return stored.trim()
    }
    if (noteId.length <= 8) return noteId
    return `${noteId.slice(0, 4)}…${noteId.slice(-3)}`
  }, [])

  const { handleNoteSelect, handleCloseNote, handleCenterNote } = useWorkspaceNoteSelection({
    activeNoteId,
    openNotes,
    openWorkspaceNote,
    closeWorkspaceNote,
    requestMainOnlyNote,
    centerNoteOnCanvas,
    logWorkspaceNotePositions,
    resolveMainPanelPosition,
    hasRenderedMainPanel,
    setActiveNoteId,
    setSkipSnapshotForNote,
    registerFreshNote,
    storeFreshNoteSeed,
    bumpRecentNotesRefresh,
    isHydrating,
    sharedWorkspace,
    canvasRef,
    canvasState,
    reopenSequenceRef,
    lastCanvasInteractionRef,
    debugLog,
  })

  const handleSnapshotSettled = useCallback((noteId: string) => {
    setSkipSnapshotForNote(current => (current === noteId ? null : current))
  }, [])
  
  // Center panel when note selection changes

  // Handle right-click to show notes widget
  const handleCloseNotesWidget = useCallback(() => {
    setShowNotesWidget(false)
  }, [])

  // Handle registering active editor (called by panels when they gain focus)
  const handleRegisterActiveEditor = useCallback((editorRef: any, panelId: string) => {
    console.log('[AnnotationApp] Registering active editor for panel:', panelId)
    activeEditorRef.current = editorRef
    setActivePanelId(panelId)
  }, [])

  // Handle adding component (callback from FloatingToolbar)
  const handleAddComponentFromToolbar = useCallback((type: string, position?: { x: number; y: number }) => {
    // Call the canvas's addComponent method directly
    if (canvasRef.current?.addComponent) {
      canvasRef.current.addComponent(type, position)
    }
  }, [])

  // Handle backdrop style change (callback from FloatingToolbar)
  const handleBackdropStyleChange = useCallback((style: string) => {
    setBackdropStyle(style)
  }, [])

  const openNoteFromSidebar = useCallback(
    (noteId: string) => {
      layerContext?.setActiveLayer('notes')
      handleNoteSelect(noteId, { source: 'popup' })
    },
    [handleNoteSelect, layerContext]
  )

  const getPreviewSourceFolderId = useCallback(() => notePreview?.context?.sourceFolderId, [notePreview])

  const { hoverHandlers, sidebarPreviewProps } = useWorkspaceSidebarHover({
    ensureOverlayHydrated,
    fetchGlobalChildren,
    handleOrganizationSidebarSelect,
    openNoteFromSidebar,
    triggerNotePreviewHover,
    triggerNotePreviewLeave,
    triggerNotePreviewTooltipEnter,
    triggerNotePreviewTooltipLeave,
    cancelNotePreview,
    getPreviewSourceFolderId,
  })

  const {
    sidebarFolderPopups,
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
  } = hoverHandlers

  const handleToggleMoveCascade = toggleMoveCascade

  // Handle closing overlay popup with cascade (closes all children recursively)
  // Used for immediate close without interactive mode
  const handleCloseOverlayPopup = closePopupCascade

  // Handle toggle pin (prevent cascade-close)
  // Cascades pin state to all descendants automatically
  const handleTogglePin = togglePinCascade

  // Handle initiate close (enter interactive close mode)
  const handleInitiateClose = initiateCloseMode

  // Handle confirm close (user clicked Done - close parent and unpinned children)
  const handleConfirmClose = confirmCloseMode

  // Handle cancel close (user cancelled - revert to normal mode)
  const handleCancelClose = cancelCloseMode

  // Handle bulk move of items to target folder (drag-drop)
  // Navigation control functions
  const handleZoomIn = () => {
    setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.1, 2) }))
    if (canvasRef.current?.zoomIn) {
      canvasRef.current.zoomIn()
    }
  }

  const handleZoomOut = () => {
    setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.9, 0.3) }))
    if (canvasRef.current?.zoomOut) {
      canvasRef.current.zoomOut()
    }
  }

  const handleResetView = () => {
    setCanvasState(prev => ({ ...prev, zoom: 1 }))
    if (canvasRef.current?.resetView) {
      canvasRef.current.resetView()
    }
  }

  const handleToggleConnections = () => {
    setCanvasState(prev => ({ ...prev, showConnections: !prev.showConnections }))
    if (canvasRef.current?.toggleConnections) {
      canvasRef.current.toggleConnections()
    }
  }

  // Track note creation state to prevent double-clicks
  const [isCreatingNoteFromToolbar, setIsCreatingNoteFromToolbar] = useState(false)
  const [pendingNoteCreation, setPendingNoteCreation] = useState(false)

  const noteWorkspaceReady =
    !noteWorkspaceState.featureEnabled || Boolean(noteWorkspaceState.currentWorkspaceId)
  const noteWorkspaceBusy =
    noteWorkspaceState.featureEnabled && (!noteWorkspaceReady || noteWorkspaceState.isLoading)

  // Handler for creating new note from workspace toolbar
  // Reuses the same logic as floating toolbar's "+ Note" button
  const executeToolbarNoteCreation = useCallback(async () => {
    if (isCreatingNoteFromToolbar) return
    setIsCreatingNoteFromToolbar(true)
    try {
      const result = await createNote({
        workspaceId: currentWorkspaceId ?? undefined
      })

      if (result.success && result.noteId) {
        // Open the newly created note
        handleNoteSelect(result.noteId, {
          source: 'toolbar-create'
        })
      } else {
        console.error('[AnnotationApp] Failed to create note:', result.error)
      }
    } catch (error) {
      console.error('[AnnotationApp] Error creating note:', error)
    } finally {
      setIsCreatingNoteFromToolbar(false)
    }
  }, [currentWorkspaceId, handleNoteSelect, isCreatingNoteFromToolbar])

  const handleNewNoteFromToolbar = useCallback(() => {
    if (isCreatingNoteFromToolbar) return
    if (noteWorkspaceBusy) {
      setPendingNoteCreation(true)
      toast({
        title: "Workspace still loading",
        description: "The note will be created as soon as the workspace is ready.",
      })
      return
    }
    void executeToolbarNoteCreation()
  }, [executeToolbarNoteCreation, isCreatingNoteFromToolbar, noteWorkspaceBusy])

  useEffect(() => {
    if (!noteWorkspaceBusy && pendingNoteCreation) {
      setPendingNoteCreation(false)
      void executeToolbarNoteCreation()
    }
  }, [noteWorkspaceBusy, pendingNoteCreation, executeToolbarNoteCreation])

  // Handler for opening settings from workspace toolbar
  const handleSettingsFromToolbar = useCallback(() => {
    // TODO: Implement settings panel
    console.log('[AnnotationApp] Settings clicked')
  }, [])

  const {
    handleFolderCreated,
    handlePopupDragStart,
    handlePopupHover,
    handleFolderRenamed,
  } = useWorkspaceOverlayInteractions({
    setOverlayPopups,
    updateFolderCacheChildren,
    invalidateFolderCache,
    startPopupDrag,
    layerContext,
    closeTimeouts,
    clearCloseTimeout,
  })

  const { workspaceSidebarProps } = useWorkspaceSidebarState({
    shouldShowSidebar,
    showConstellationPanel,
    activeSidebarTab,
    handleSidebarTabChange,
    sidebarState: {
      organizationFolders: sidebarState.organizationFolders,
      items: organizationSidebarData.items,
      stats: organizationSidebarData.stats,
    },
    overlayPopups,
    setOverlayPopups,
    layerContext,
    setCanvasMode,
    ensureOverlayHydrated,
    appendWorkspaceParam: appendKnowledgeBaseWorkspaceParam,
    knowledgeBaseWorkspaceId,
    fetchWithKnowledgeBase,
    fetchGlobalChildren,
    folderCacheApi: {
      updateFolderCacheEntry,
      updateFolderCacheChildren,
      invalidateFolderCache,
    },
    knowledgeBaseId,
    hoverHandlers,
  })

  const workspaceToolbarProps = useWorkspaceToolbarProps({
    notes: sortedOpenNotes,
    activeNoteId,
    isWorkspaceLoading: isWorkspaceLoading || noteWorkspaceBusy,
    isCreatingNote: isCreatingNoteFromToolbar,
    formatNoteLabel,
    onActivateNote: handleNoteSelect,
    onCenterNote: handleCenterNote,
    onCloseNote: handleCloseNote,
    onNewNote: handleNewNoteFromToolbar,
    onSettings: handleSettingsFromToolbar,
  })

  const workspaceToolbarStripProps = useMemo(
    () => ({
      isVisible: !showConstellationPanel && !isPopupLayerActive,
      ...workspaceToolbarProps,
    }),
    [workspaceToolbarProps, showConstellationPanel, isPopupLayerActive],
  )

  const noteWorkspaceToggleNode = noteWorkspaceState.featureEnabled ? (
    <div
      className="absolute left-4 top-4 flex justify-start"
      style={{ zIndex: Z_INDEX.DROPDOWN + 11, pointerEvents: 'none' }}
    >
      <WorkspaceToggleMenu
        className="pointer-events-auto"
        labelTitle="Note Workspace"
        statusLabel={noteWorkspaceStatusLabel}
        statusHelperText={noteWorkspaceState.statusHelperText}
        isOpen={noteWorkspaceMenuOpen}
        onToggleMenu={() => setNoteWorkspaceMenuOpen(prev => !prev)}
        onCreateWorkspace={noteWorkspaceState.createWorkspace}
        disableCreate={noteWorkspaceState.isLoading}
        isListLoading={noteWorkspaceState.isLoading}
        workspaces={noteWorkspaceState.workspaces}
        currentWorkspaceId={noteWorkspaceState.currentWorkspaceId}
        deletingWorkspaceId={null}
        onSelectWorkspace={noteWorkspaceState.selectWorkspace}
        onDeleteWorkspace={noteWorkspaceState.deleteWorkspace}
        onRenameWorkspace={noteWorkspaceState.renameWorkspace}
      />
    </div>
  ) : null

  const workspaceToggleNode = shouldShowWorkspaceToggle ? (
    <div
      className="absolute inset-x-0 top-4 flex justify-center"
      style={{ zIndex: Z_INDEX.DROPDOWN + 10, pointerEvents: 'none' }}
    >
      <WorkspaceToggleMenu
        ref={workspaceToggleRef}
        className="pointer-events-auto"
        statusLabel={workspaceDisplayLabel}
        statusHelperText={overlayOptimisticHydrationEnabled ? overlayStatusLabel : null}
        isOpen={workspaceMenuOpen}
        onToggleMenu={() => setWorkspaceMenuOpen(prev => !prev)}
        onCreateWorkspace={handleCreateWorkspace}
        disableCreate={isWorkspaceSaving || isWorkspaceLayoutLoading}
        isListLoading={isWorkspaceListLoading}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        deletingWorkspaceId={workspaceDeletionId}
        onSelectWorkspace={handleWorkspaceSelect}
        onDeleteWorkspace={handleDeleteWorkspace}
      />
    </div>
  ) : null

  const workspaceCanvas = openNotes.length > 0 ? (
    <AnnotationWorkspaceCanvas
      key="workspace"
      ref={canvasRef}
      noteIds={openNotes.map(note => note.noteId)}
      primaryNoteId={activeNoteId ?? openNotes[0].noteId}
      freshNoteSeeds={freshNoteSeeds}
      onConsumeFreshNoteSeed={consumeFreshNoteSeed}
      isNotesExplorerOpen={false}
      freshNoteIds={freshNoteIds}
      onFreshNoteHydrated={handleFreshNoteHydrated}
      onCanvasStateChange={handleCanvasStateChange}
      mainOnlyNoteIds={mainOnlyNotes}
      onMainOnlyLayoutHandled={handleMainOnlyLayoutHandled}
      showAddComponentMenu={showAddComponentMenu}
      onToggleAddComponentMenu={() => setShowAddComponentMenu(!showAddComponentMenu)}
      onRegisterActiveEditor={handleRegisterActiveEditor}
      onSnapshotLoadComplete={handleSnapshotLoadComplete}
      skipSnapshotForNote={skipSnapshotForNote}
      onSnapshotSettled={handleSnapshotSettled}
      noteTitleMap={noteTitleMapRef.current}
      workspaceSnapshotRevision={noteWorkspaceState.snapshotRevision}
    >
      {showNotesWidget && (
        <CanvasAwareFloatingToolbar
          x={notesWidgetPosition.x}
          y={notesWidgetPosition.y}
          onClose={handleCloseNotesWidget}
          onSelectNote={handleNoteSelect}
          onCreateOverlayPopup={handleCreateOverlayPopup}
          onAddComponent={handleAddComponentFromToolbar}
          editorRef={activeEditorRef}
          activePanelId={activePanelId}
          onBackdropStyleChange={handleBackdropStyleChange}
          onFolderRenamed={handleFolderRenamed}
          activePanel={toolbarActivePanel}
          onActivePanelChange={setToolbarActivePanel}
          refreshRecentNotes={recentNotesRefreshTrigger}
          onToggleConstellationPanel={toggleConstellationView}
          showConstellationPanel={showConstellationPanel}
          knowledgeBaseWorkspace={knowledgeBaseWorkspace}
          workspaceReady={noteWorkspaceReady}
          workspaceName={
            noteWorkspaceState.workspaces.find(
              (entry) => entry.id === noteWorkspaceState.currentWorkspaceId,
            )?.name ?? null
          }
        />
      )}
    </AnnotationWorkspaceCanvas>
  ) : null

  const workspaceCanvasProps = {
    showConstellationPanel,
    isPopupLayerActive,
    hasOpenNotes: openNotes.length > 0,
    canvas: workspaceCanvas,
  }

  const workspaceOverlayProps = useWorkspaceOverlayProps({
    canRenderOverlay,
    adaptedPopups,
    draggingPopup,
    onClosePopup: handleCloseOverlayPopup,
    onInitiateClose: handleInitiateClose,
    onConfirmClose: handleConfirmClose,
    onCancelClose: handleCancelClose,
    onTogglePin: handleTogglePin,
    onDragStart: handlePopupDragStart,
    onHoverFolder: handleFolderHover,
    onLeaveFolder: handleFolderHoverLeave,
    onPopupHover: handlePopupHover,
    onSelectNote: handleNoteSelect,
    onDeleteSelected: handleDeleteSelected,
    onBulkMove: handleBulkMove,
    onFolderCreated: handleFolderCreated,
    onFolderRenamed: handleFolderRenamed,
    onPopupCardClick: handleCloseNotesWidget,
    onContextMenu: handleContextMenu,
    onPopupPositionChange: handlePopupPositionChange,
    onResizePopup: handleResizePopup,
    isWorkspaceLayoutLoading,
    isPopupLayerActive,
    backdropStyle,
    currentWorkspaceId,
    optimisticHydrationEnabled: overlayOptimisticHydrationEnabled,
    hydrationStatusLabel: overlayStatusLabel,
    hydrationVeilActive,
    onUserCameraTransform: handleOverlayUserCameraTransform,
    knowledgeBaseWorkspace,
    moveCascadeState,
    onToggleMoveCascade: handleToggleMoveCascade,
    onClearMoveCascadeState: clearMoveCascadeState,
  })

  const { floatingToolbarProps, floatingToolbarVisible } = useWorkspaceFloatingToolbar({
    notesWidgetPosition,
    showNotesWidget,
    activeNoteId,
    showConstellationPanel,
    onClose: handleCloseNotesWidget,
    onSelectNote: handleNoteSelect,
    onCreateOverlayPopup: handleCreateOverlayPopup,
    onAddComponent: handleAddComponentFromToolbar,
    activeEditorRef,
    activePanelId,
    onBackdropStyleChange: handleBackdropStyleChange,
    onFolderRenamed: handleFolderRenamed,
    toolbarActivePanel,
    setToolbarActivePanel,
    recentNotesRefreshTrigger,
    toggleConstellationView,
    knowledgeBaseWorkspace,
  })

  const workspaceFloatingToolbarProps = useMemo(
    () => ({
      visible: floatingToolbarVisible,
      ...floatingToolbarProps,
    }),
    [floatingToolbarProps, floatingToolbarVisible],
  )

  const workspacePreviewPortalProps = useWorkspacePreviewPortal({
    preview: notePreview,
    isLoading: isLoadingNotePreview,
    onOpenNote: handleSidebarNoteOpen,
    onDismiss: cancelNotePreview,
    onMouseEnter: handleSidebarPreviewTooltipEnter,
    onMouseLeave: handleSidebarPreviewTooltipLeave,
  })

  const sidebarPreviewPopupsProps = shouldLoadOverlay ? sidebarPreviewProps : undefined

  const constellationPanelProps = useMemo(
    () => ({
      visible: showConstellationPanel,
    }),
    [showConstellationPanel],
  )

  const workspaceViewProps: AnnotationWorkspaceViewProps = {
    sidebarProps: workspaceSidebarProps,
    toolbarProps: workspaceToolbarStripProps,
    workspaceToggle: (
      <>
        {noteWorkspaceToggleNode}
        {workspaceToggleNode}
      </>
    ),
    canvasProps: workspaceCanvasProps,
    workspaceOverlayProps: workspaceOverlayProps,
    sidebarPreviewProps: sidebarPreviewPopupsProps,
    floatingToolbarProps: workspaceFloatingToolbarProps,
    previewPortalProps: workspacePreviewPortalProps,
    constellationPanelProps: constellationPanelProps,
    onMainAreaContextMenu: handleContextMenu,
  }

  if (process.env.NODE_ENV === "test" && typeof globalThis !== "undefined") {
    ;(globalThis as any).__annotationWorkspaceViewProps = workspaceViewProps
  }

  const workspaceView = <AnnotationWorkspaceView {...workspaceViewProps} />

  if (useShellView) {
    return (
      <ConstellationProvider>
        {workspaceView}
      </ConstellationProvider>
    )
  }

  return (
    <ConstellationProvider>
      {workspaceView}
    </ConstellationProvider>
  )
}

export function AnnotationAppShell() {
  return (
    <LayerProvider initialPopupCount={0}>
      <CanvasWorkspaceProvider>
        <AnnotationAppContent useShellView />
      </CanvasWorkspaceProvider>
    </LayerProvider>
  )
}
