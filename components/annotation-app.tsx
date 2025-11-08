"use client"

import { useState, useRef, useEffect, useCallback, useMemo, useReducer } from "react"
import { createPortal } from "react-dom"
import dynamic from 'next/dynamic'
import { CanvasAwareFloatingToolbar } from "./canvas-aware-floating-toolbar"
import { FloatingToolbar, getFolderColorTheme, type OverlayPopup, type OrgItem } from "./floating-toolbar"
import { PopupOverlay } from "@/components/canvas/popup-overlay"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import { trackNoteAccess, createNote } from "@/lib/utils/note-creator"
import { LayerProvider, useLayer } from "@/components/canvas/layer-provider"
import { Trash2, Eye } from 'lucide-react'
import {
  OverlayLayoutAdapter,
  OverlayLayoutConflictError,
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  type OverlayLayoutPayload,
  type OverlayPopupDescriptor,
  type OverlayWorkspaceSummary,
  isOverlayPersistenceEnabled,
} from "@/lib/adapters/overlay-layout-adapter"
import { debugLog, isDebugEnabled } from "@/lib/utils/debug-logger"
import { useCanvasMode, type CanvasMode } from "@/lib/canvas/use-canvas-mode"
import { toast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { CanvasWorkspaceProvider, useCanvasWorkspace, SHARED_WORKSPACE_ID } from "./canvas/canvas-workspace-context"
import { centerOnNotePanel, type CenterOnNoteOptions } from "@/lib/canvas/center-on-note"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { isDefaultMainPosition } from "@/lib/canvas/position-utils"
import { WorkspaceToolbar } from "./canvas/workspace-toolbar"
import { AutoHideToolbar } from "./canvas/auto-hide-toolbar"
import {
  computeVisuallyCenteredWorldPosition,
  type RapidSequenceState,
} from "@/lib/canvas/visual-centering"
import { ConstellationPanel } from "@/components/constellation/constellation-panel"
import { ConstellationProvider } from "@/components/constellation/constellation-context"
import { CanvasSidebar, type CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import { OrganizationSidebarContent, type OrganizationSidebarItem } from "@/components/sidebar/organization-sidebar-content"
import { ConstellationSidebarShared } from "@/components/sidebar/constellation-sidebar-shared"
import { PreviewPopover } from "@/components/shared/preview-popover"
import { buildHydratedOverlayLayout } from "@/lib/workspaces/overlay-hydration"
import type { OverlayLayoutDiagnostics, OverlayCameraState } from "@/lib/types/overlay-layout"
import { Z_INDEX } from "@/lib/constants/z-index"
import { useNotePreviewHover } from "@/hooks/useNotePreviewHover"

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

function sidebarItemToOrgItem(item: OrganizationSidebarItem): OrgItem {
  return {
    id: item.id,
    name: item.name,
    type: item.type === 'note' ? 'note' : 'folder',
    icon: item.icon,
    color: item.color ?? undefined,
    path: item.path ?? undefined,
    hasChildren: item.hasChildren ?? (item.count ?? 0) > 0,
    level: typeof item.level === 'number' ? item.level : 0,
    children: [],
    parentId: item.parentId ?? undefined,
  }
}

function computeNextWorkspaceName(workspaceSummaries: OverlayWorkspaceSummary[]): string {
  const pattern = /^Workspace (\d+)$/i
  const highest = workspaceSummaries.reduce((max, workspace) => {
    const match = pattern.exec(workspace.name)
    if (!match) return max
    const value = Number.parseInt(match[1], 10)
    return Number.isNaN(value) ? max : Math.max(max, value)
  }, 0)
  return `Workspace ${highest + 1}`
}

const DEFAULT_CAMERA: OverlayCameraState = { x: 0, y: 0, scale: 1 }

const camerasEqual = (a: OverlayCameraState, b: OverlayCameraState) =>
  a.x === b.x && a.y === b.y && a.scale === b.scale

type NotePreviewContext = {
  sourceFolderId?: string
}

const ModernAnnotationCanvas = dynamic(
  () => import('./annotation-canvas-modern'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
        <div className="text-white text-2xl font-semibold animate-pulse">Loading canvas...</div>
      </div>
    )
  }
)

const CENTER_RETRY_ATTEMPTS = 2
const CENTER_RETRY_DELAY_MS = 160
const POST_LOAD_CENTER_ATTEMPTS = 6
const POST_LOAD_CENTER_DELAY_MS = 180
const POST_LOAD_SECOND_PASS_DELAY_MS = 420
const POST_LOAD_PENDING_CLEAR_DELAY_MS = 2200
const CENTER_EXISTING_NOTES_ENABLED = process.env.NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES !== "disabled"
const DEFAULT_POPUP_WIDTH = 300
const DEFAULT_POPUP_HEIGHT = 400
const MIN_POPUP_WIDTH = 200
const MIN_POPUP_HEIGHT = 200
const MAX_POPUP_WIDTH = 900
const MAX_POPUP_HEIGHT = 900

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function AnnotationAppContent() {
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
  const [activeSidebarTab, setActiveSidebarTab] = useState<CanvasSidebarTab>('organization')
  const layerContext = useLayer()
  const { mode: canvasMode, setMode: setCanvasMode } = useCanvasMode({
    layerContext,
    onModeChange: useCallback(
      (nextMode: CanvasMode) => {
        if (nextMode === 'constellation') {
          setActiveSidebarTab('constellation')
        } else if (activeSidebarTab === 'constellation') {
          setActiveSidebarTab('organization')
        }
      },
      [activeSidebarTab]
    ),
  })
  const showConstellationPanel = canvasMode === 'constellation'
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

  const handleSidebarTabChange = useCallback(
    (tab: CanvasSidebarTab) => {
      setActiveSidebarTab(tab)
      if (tab === 'constellation') {
        setCanvasMode('constellation')
        return
      }
      setCanvasMode('overlay')
    },
    [setCanvasMode]
  )

  const toggleConstellationView = useCallback(() => {
    setCanvasMode(canvasMode === 'constellation' ? 'overlay' : 'constellation')
  }, [canvasMode, setCanvasMode])

  const activeNoteIdRef = useRef<string | null>(activeNoteId)
  useEffect(() => {
    activeNoteIdRef.current = activeNoteId
  }, [activeNoteId])
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

  const noteTitleMapRef = useRef<Map<string, string>>(new Map())
  const [, forceNoteTitleUpdate] = useReducer((count: number) => count + 1, 0)
  const pendingTitleFetchesRef = useRef<Map<string, Promise<string | null>>>(new Map())


  const setTitleForNote = useCallback(
    (noteId: string, title: string | null) => {
      if (!noteId) return
      const map = noteTitleMapRef.current
      if (title && title.trim()) {
        const normalized = title.trim()
        if (map.get(noteId) !== normalized) {
          map.set(noteId, normalized)
          forceNoteTitleUpdate()
        }
        return
      }

      if (map.has(noteId)) {
        map.delete(noteId)
        forceNoteTitleUpdate()
      }
    },
    [forceNoteTitleUpdate],
  )

  const ensureTitleFromServer = useCallback(
    (noteId: string) => {
      if (!noteId) return
      const fetches = pendingTitleFetchesRef.current
      if (fetches.has(noteId)) {
        return
      }

      const fetchPromise = (async () => {
        try {
          const response = await fetchWithWorkspace(`/api/items/${encodeURIComponent(noteId)}`)
          if (!response.ok) {
            console.warn('[AnnotationApp] Failed to fetch note metadata for title', {
              noteId,
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }
          const data = await response.json()
          const rawName = data?.item?.name
          if (typeof rawName === 'string') {
            const trimmed = rawName.trim()
            if (trimmed.length > 0) {
              return trimmed
            }
          }
          return null
        } catch (error) {
          console.warn('[AnnotationApp] Error fetching note title', { noteId, error })
          return null
        }
      })()

      fetches.set(noteId, fetchPromise)

      fetchPromise
        .then(title => {
          fetches.delete(noteId)
          if (!title) return

          setTitleForNote(noteId, title)

          const dataStore = sharedWorkspace?.dataStore
          if (!dataStore) return

          const storeKey = ensurePanelKey(noteId, 'main')
          const existing = dataStore.get(storeKey)
          if (existing) {
            dataStore.update(storeKey, { title })
          }
        })
        .catch(error => {
          fetches.delete(noteId)
          console.warn('[AnnotationApp] Failed to resolve note title fetch promise', { noteId, error })
        })
    },
    [setTitleForNote, sharedWorkspace],
  )

  const deriveTitleFromRecord = useCallback((record: any): string | null => {
    if (!record || typeof record !== 'object') return null
    const candidates = [
      record.title,
      record.name,
      record.metadata?.noteTitle,
      record.metadata?.title,
      record.metadata?.displayName,
      record.metadata?.displayId,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim()
        if (trimmed) {
          return trimmed
        }
      }
    }

    return null
  }, [])

  const updateTitleForNote = useCallback(
    (noteId: string) => {
      if (!noteId) return
      const dataStore = sharedWorkspace?.dataStore
      if (!dataStore) return
      const storeKey = ensurePanelKey(noteId, 'main')
      const record = dataStore.get(storeKey)
      const derived = deriveTitleFromRecord(record)
      if (derived) {
        setTitleForNote(noteId, derived)
        return
      }

      const existingTitle = noteTitleMapRef.current.get(noteId)

      if (existingTitle) {
        if (record && typeof record === 'object') {
          const currentStoreTitle = typeof record.title === 'string' ? record.title.trim() : ''
          if (currentStoreTitle !== existingTitle) {
            dataStore.update(storeKey, { title: existingTitle })
          }
        }
        return
      }

      setTitleForNote(noteId, null)
      ensureTitleFromServer(noteId)
    },
    [sharedWorkspace, deriveTitleFromRecord, setTitleForNote, ensureTitleFromServer],
  )

  const logWorkspaceNotePositions = useCallback(
    (context: string) => {
      const dataStore = sharedWorkspace?.dataStore
      if (!dataStore) return

      const positions = sortedOpenNotes.map(note => {
        const storeKey = ensurePanelKey(note.noteId, 'main')
        const record = dataStore.get(storeKey)
        const position =
          record?.position ??
          record?.worldPosition ??
          record?.mainPosition ??
          null

        return {
          noteId: note.noteId,
          hasRecord: Boolean(record),
          position,
        }
      })

      debugLog({
        component: 'AnnotationApp',
        action: 'panel_position_snapshot',
        metadata: {
          context,
          activeNoteId,
          positions,
        },
      })
    },
    [sharedWorkspace, sortedOpenNotes, activeNoteId],
  )

  const resolveMainPanelPosition = useCallback(
    (noteId: string): { x: number; y: number } | null => {
      if (!noteId) return null

      const normalize = (value: any): { x: number; y: number } | null => {
        if (!value || typeof value !== 'object') return null
        const { x, y } = value as { x?: number; y?: number }
        if (typeof x !== 'number' || typeof y !== 'number') {
          return null
        }
        return { x, y }
      }

      const pending = normalize(getPendingPosition(noteId))
      if (pending) return pending

      const cached = normalize(getCachedPosition(noteId))
      if (cached) return cached

      const openNote = openNotes.find(note => note.noteId === noteId)
      const openPosition = normalize(openNote?.mainPosition)
      if (openPosition) return openPosition

      const dataStore = sharedWorkspace?.dataStore
      if (dataStore) {
        const storeKey = ensurePanelKey(noteId, 'main')
        const record = dataStore.get(storeKey)
        if (record && typeof record === 'object') {
          const candidates = [
            normalize((record as any)?.position),
            normalize((record as any)?.worldPosition),
            normalize((record as any)?.mainPosition),
          ]
          for (const candidate of candidates) {
            if (candidate) return candidate
          }
        }
      }

      // CRITICAL FALLBACK: If DataStore doesn't have it, try fetching from database
      // This handles the case where workspace hasn't hydrated yet but note is visible
      console.log('[resolveMainPanelPosition] DataStore miss, trying database for', noteId)
      // Note: This should ideally be async, but for now we return null and rely on
      // the workspace's mainPosition from canvas_workspace_notes table
      // The workspace context should have this from the initial load

      return null
    },
    [getPendingPosition, getCachedPosition, openNotes, sharedWorkspace],
  )

  useEffect(() => {
    if (sortedOpenNotes.length === 0) {
      if (noteTitleMapRef.current.size > 0) {
        noteTitleMapRef.current.clear()
        forceNoteTitleUpdate()
      }
      return
    }

    sortedOpenNotes.forEach(note => {
      updateTitleForNote(note.noteId)
    })

    const activeIds = new Set(sortedOpenNotes.map(note => note.noteId))
    let removed = false
    noteTitleMapRef.current.forEach((_value, noteId) => {
      if (!activeIds.has(noteId)) {
        noteTitleMapRef.current.delete(noteId)
        removed = true
      }
    })
    if (removed) {
      forceNoteTitleUpdate()
    }
  }, [sortedOpenNotes, updateTitleForNote, forceNoteTitleUpdate])

  useEffect(() => {
    const dataStore = sharedWorkspace?.dataStore
    if (!dataStore) return

    const handleMutation = (key: unknown) => {
      if (typeof key !== 'string') return
      const { noteId, panelId } = parsePanelKey(key)
      if (!noteId || panelId !== 'main') return
      updateTitleForNote(noteId)
    }

    const handleDelete = (key: unknown) => {
      if (typeof key !== 'string') return
      const { noteId, panelId } = parsePanelKey(key)
      if (!noteId || panelId !== 'main') return
      setTitleForNote(noteId, null)
    }

    dataStore.on('set', handleMutation)
    dataStore.on('update', handleMutation)
    dataStore.on('delete', handleDelete)

    return () => {
      dataStore.off('set', handleMutation)
      dataStore.off('update', handleMutation)
      dataStore.off('delete', handleDelete)
    }
  }, [sharedWorkspace, updateTitleForNote, setTitleForNote])

  const [canvasState, setCanvasState] = useState({
    zoom: 1,
    showConnections: true,
    translateX: 0,
    translateY: 0
  })
  const lastCanvasInteractionRef = useRef<{ x: number; y: number } | null>(null)
  const handleCanvasStateChange = useCallback(
    (
      stateUpdate: Partial<{
        zoom: number
        showConnections: boolean
        translateX: number
        translateY: number
        lastInteraction?: { x: number; y: number } | null
        interactionSource?: 'canvas' | 'keyboard' | 'toolbar'
      }>,
    ) => {
      let updated = false
      setCanvasState(prev => {
        const next = {
          zoom: stateUpdate.zoom ?? prev.zoom,
          showConnections: stateUpdate.showConnections ?? prev.showConnections,
          translateX: stateUpdate.translateX ?? prev.translateX,
          translateY: stateUpdate.translateY ?? prev.translateY,
        }
        if (
          next.zoom === prev.zoom &&
          next.showConnections === prev.showConnections &&
          next.translateX === prev.translateX &&
          next.translateY === prev.translateY
        ) {
          return prev
        }
        updated = true
        return next
      })
      if (stateUpdate.lastInteraction) {
        lastCanvasInteractionRef.current = stateUpdate.lastInteraction
        if (typeof window !== 'undefined') {
          ;(window as any).__canvasLastInteraction = stateUpdate.lastInteraction
          ;(window as any).__canvasLastInteractionSource = stateUpdate.interactionSource ?? 'canvas'
        }
      } else if (
        updated &&
        typeof window !== 'undefined' &&
        (stateUpdate.translateX !== undefined || stateUpdate.translateY !== undefined)
      ) {
        const fallbackPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        lastCanvasInteractionRef.current = fallbackPoint
        ;(window as any).__canvasLastInteraction = fallbackPoint
      }
    },
    [],
  )
  const reopenSequenceRef = useRef<RapidSequenceState>({ count: 0, lastTimestamp: 0 })
  const newNoteSequenceRef = useRef<RapidSequenceState>({ count: 0, lastTimestamp: 0 })
  const [freshNoteSeeds, setFreshNoteSeeds] = useState<Record<string, { x: number; y: number }>>({})
  const consumeFreshNoteSeed = useCallback((targetNoteId: string) => {
    setFreshNoteSeeds(prev => {
      if (!prev[targetNoteId]) return prev
      const next = { ...prev }
      delete next[targetNoteId]
      return next
    })
  }, [])
  const [showAddComponentMenu, setShowAddComponentMenu] = useState(false)
  const [mainOnlyNotes, setMainOnlyNotes] = useState<string[]>([])
  const requestMainOnlyNote = useCallback((noteId: string) => {
    if (!noteId) return
    setMainOnlyNotes(prev => (prev.includes(noteId) ? prev : [...prev, noteId]))
  }, [])
  const handleMainOnlyLayoutHandled = useCallback((noteId: string) => {
    if (!noteId) return
    setMainOnlyNotes(prev => prev.filter(id => id !== noteId))
  }, [])

  // Floating notes widget state
const [showNotesWidget, setShowNotesWidget] = useState(false)
const [notesWidgetPosition, setNotesWidgetPosition] = useState({ x: 100, y: 100 })
const activeEditorRef = useRef<any>(null) // Track the currently active editor
const [activePanelId, setActivePanelId] = useState<string | null>(null) // Track the currently active panel ID

  const freshNotesRef = useRef<Set<string>>(new Set())
  const [freshNoteIds, setFreshNoteIds] = useState<string[]>([])

  // Toolbar active panel state - persists across toolbar close/reopen
  // When user closes toolbar and reopens it, the last opened panel will be restored
  const [toolbarActivePanel, setToolbarActivePanel] = useState<"recents" | "org" | "tools" | "layer" | "format" | "resize" | "branches" | "actions" | "add-component" | "display" | null>(null)

  // Recent notes refresh counter - incremented when note is accessed to refresh toolbar's recent notes list
  const [recentNotesRefreshTrigger, setRecentNotesRefreshTrigger] = useState(0)

  // Display settings state (backdrop style preference)
  const [backdropStyle, setBackdropStyle] = useState<string>('opaque')

  // Overlay popups state - persists independently of toolbar (like activeNoteId)
const [overlayPopups, setOverlayPopups] = useState<OverlayPopup[]>([])
const [moveCascadeState, setMoveCascadeState] = useState<{ parentId: string | null; childIds: string[] }>({
  parentId: null,
  childIds: [],
})
type SidebarFolderPopup = {
  id: string
  folderId: string
  folderName: string
  position: { x: number; y: number }
  children: OrgItem[]
  isLoading: boolean
  parentFolderId?: string
  folderColor?: string
}
const [sidebarFolderPopups, setSidebarFolderPopups] = useState<SidebarFolderPopup[]>([])
const sidebarFolderPopupsRef = useRef<SidebarFolderPopup[]>([])
const sidebarHoverTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
const sidebarPopupIdCounter = useRef(0)
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const [overlayPanning, setOverlayPanning] = useState(false)
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const draggingPopupRef = useRef<string | null>(null)
  const dragScreenPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const hoverTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const closeTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const latestCameraRef = useRef<OverlayCameraState>(DEFAULT_CAMERA)
  const prevCameraForSaveRef = useRef<OverlayCameraState>(DEFAULT_CAMERA)
  const [organizationFolders, setOrganizationFolders] = useState<OrganizationSidebarItem[]>([])
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<OverlayWorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [isWorkspaceListLoading, setIsWorkspaceListLoading] = useState(false)
  const [isWorkspaceLayoutLoading, setIsWorkspaceLayoutLoading] = useState(false)
  const [isWorkspaceSaving, setIsWorkspaceSaving] = useState(false)
  const [workspaceDeletionId, setWorkspaceDeletionId] = useState<string | null>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [pendingDiagnostics, setPendingDiagnostics] = useState<OverlayLayoutDiagnostics | null>(null)
  const workspacesLoadedRef = useRef(false)
  const workspaceToggleRef = useRef<HTMLDivElement | null>(null)
  const diagnosticsRef = useRef<OverlayLayoutDiagnostics | null>(null)
  const lastDiagnosticsHashRef = useRef<string | null>(null)
  const currentWorkspace = useMemo(
    () => workspaces.find(ws => ws.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId]
  )
  const fetchWithWorkspace = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? {})
      if (currentWorkspaceId) {
        headers.set('X-Overlay-Workspace-ID', currentWorkspaceId)
      }
      return fetch(input, { ...init, headers })
    },
    [currentWorkspaceId]
  )

  const fetchNotePreview = useCallback(
    async (noteId: string) => {
      const response = await fetchWithWorkspace(`/api/items/${noteId}`)
      if (!response.ok) throw new Error('Failed to fetch note')
      const data = await response.json()
      return {
        content: data?.item?.content,
        contentText: data?.item?.contentText,
      }
    },
    [fetchWithWorkspace]
  )

  const {
    preview: notePreview,
    isLoading: isLoadingNotePreview,
    handleHover: triggerNotePreviewHover,
    handleLeave: triggerNotePreviewLeave,
    handleTooltipEnter: triggerNotePreviewTooltipEnter,
    handleTooltipLeave: triggerNotePreviewTooltipLeave,
    cancelPreview: cancelNotePreview,
  } = useNotePreviewHover<NotePreviewContext>({
    fetchNote: fetchNotePreview,
  })

  const folderCacheRef = useRef<Map<string, { folder?: any | null; children?: any[] | null }>>(new Map())

  const fetchGlobalFolder = useCallback(
    async (folderId: string): Promise<any | null> => {
      const cached = folderCacheRef.current.get(folderId)
      if (cached?.folder) {
        return cached.folder
      }
      try {
        const response = await fetch(`/api/items/${folderId}`)
        if (!response.ok) {
          debugLog({
            component: 'AnnotationApp',
            action: 'popup_restore_fetch_failed',
            metadata: { folderId, status: response.status }
          })
          return null
        }
        const payload = await response.json()
        folderCacheRef.current.set(folderId, { ...(cached ?? {}), folder: payload })
        return payload
      } catch (error) {
        debugLog({
          component: 'AnnotationApp',
          action: 'popup_restore_fetch_failed',
          metadata: {
            folderId,
            status: 'network_error',
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        })
        return null
      }
    },
    []
  )

  const fetchGlobalChildren = useCallback(async (folderId: string): Promise<any[] | null> => {
    const cached = folderCacheRef.current.get(folderId)
    if (cached?.children) {
      return cached.children
    }
    try {
      const response = await fetch(`/api/items?parentId=${folderId}`)
      if (!response.ok) return null
      const data = await response.json().catch(() => ({ items: [] }))
      const childItems = Array.isArray(data.items) ? data.items : []
      folderCacheRef.current.set(folderId, { ...(cached ?? {}), children: childItems })
      return childItems
    } catch {
      return null
    }
  }, [])
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

  useEffect(() => {
    diagnosticsRef.current = pendingDiagnostics
  }, [pendingDiagnostics])

  useEffect(() => {
    sidebarFolderPopupsRef.current = sidebarFolderPopups
  }, [sidebarFolderPopups])

  useEffect(() => {
    const transform = layerContext?.transforms.popups || DEFAULT_CAMERA
    latestCameraRef.current = {
      x: Number.isFinite(transform.x) ? (transform.x as number) : 0,
      y: Number.isFinite(transform.y) ? (transform.y as number) : 0,
      scale: Number.isFinite(transform.scale) ? (transform.scale as number) : 1,
    }
  }, [layerContext?.transforms.popups])

  useEffect(() => {
    let cancelled = false

    const mapCount = (item: any): number => {
      if (typeof item?.itemCount === 'number') return item.itemCount
      if (typeof item?.itemsCount === 'number') return item.itemsCount
      if (typeof item?.childrenCount === 'number') return item.childrenCount
      if (typeof item?.childCount === 'number') return item.childCount
      if (typeof item?.stats?.itemCount === 'number') return item.stats.itemCount
      if (Array.isArray(item?.children)) return item.children.length
      return 0
    }

    const toSidebarItem = (item: any): OrganizationSidebarItem => ({
      id: item.id,
      name: item.name ?? deriveFromPath(item.path) ?? 'Untitled',
      icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
      count: mapCount(item),
      color: item.color ?? null,
      path: item.path ?? null,
      level: typeof item.level === 'number' ? item.level : 0,
      type: item.type === 'note' ? 'note' : 'folder',
      parentId: item.parentId ?? null,
      hasChildren: item.hasChildren ?? Boolean(item.children?.length || mapCount(item)),
    })

    const loadOrganizationSidebar = async () => {
      try {
        const rootResponse = await fetch('/api/items?parentId=null')
        if (!rootResponse.ok) return
        const rootData = await rootResponse.json().catch(() => ({ items: [] }))
        const rootItems: any[] = Array.isArray(rootData?.items) ? rootData.items : []

        const knowledgeBase = rootItems.find(
          item => typeof item?.name === 'string' && item.name.toLowerCase() === 'knowledge base'
        )

        let sidebarItems: OrganizationSidebarItem[] = []

        if (knowledgeBase) {
          let children: any[] = []
          try {
            const childResponse = await fetch(`/api/items?parentId=${knowledgeBase.id}`)
            if (childResponse.ok) {
              const childData = await childResponse.json().catch(() => ({ items: [] }))
              if (Array.isArray(childData?.items)) {
                children = childData.items
              }
            }
          } catch (error) {
            console.error('[AnnotationApp] Failed to fetch Knowledge Base children:', error)
          }

          const formattedChildren = children.map(toSidebarItem)
          folderCacheRef.current.set(knowledgeBase.id, {
            ...(folderCacheRef.current.get(knowledgeBase.id) ?? {}),
            folder: knowledgeBase,
            children,
          })
          const knowledgeBaseCount = mapCount(knowledgeBase)

          sidebarItems = [
            {
              id: knowledgeBase.id,
              name: knowledgeBase.name ?? 'Knowledge Base',
              icon: knowledgeBase.icon || '🗃️',
              count: knowledgeBaseCount,
              interactive: false,
            },
            ...formattedChildren.map(child => ({ ...child, interactive: true })),
          ]
          setKnowledgeBaseId(knowledgeBase.id)
        } else {
          sidebarItems = rootItems.map(item => ({ ...toSidebarItem(item), interactive: true }))
          setKnowledgeBaseId(null)
        }

        if (!cancelled) {
          setOrganizationFolders(sidebarItems)
        }
      } catch (error) {
        console.error('[AnnotationApp] Failed to load organization sidebar items:', error)
        if (!cancelled) {
          setOrganizationFolders([])
          setKnowledgeBaseId(null)
        }
      }
    }

    loadOrganizationSidebar()

    return () => {
      cancelled = true
    }
  }, [])

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
  const overlayPersistenceActive = overlayPersistenceEnabled && shouldLoadOverlay
  const shouldShowWorkspaceToggle = overlayPersistenceActive && shouldShowSidebar
  useEffect(() => {
    if (!shouldShowWorkspaceToggle && workspaceMenuOpen) {
      setWorkspaceMenuOpen(false)
    }
  }, [shouldShowWorkspaceToggle, workspaceMenuOpen])

  useEffect(() => {
    if (!overlayPersistenceActive) {
      setIsWorkspaceListLoading(false)
      return
    }
    if (workspacesLoadedRef.current) return

    let cancelled = false

    setIsWorkspaceListLoading(true)

    OverlayLayoutAdapter.listWorkspaces()
      .then(list => {
        if (cancelled) return
        setWorkspaces(list)
        if (!currentWorkspaceId && list.length > 0) {
          setCurrentWorkspaceId(list[0].id)
        }
        workspacesLoadedRef.current = true
      })
      .catch(error => {
        console.error('[AnnotationApp] Failed to load workspace list:', error)
        toast({
          variant: 'destructive',
          title: 'Unable to load workspaces',
          description: error instanceof Error ? error.message : 'Unexpected error while listing workspaces.',
        })
      })
      .finally(() => {
        if (!cancelled) {
          setIsWorkspaceListLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [overlayPersistenceActive, toast, currentWorkspaceId])

  useEffect(() => {
    if (!workspaceMenuOpen) return

    const handleClickAway = (event: MouseEvent) => {
      if (!workspaceToggleRef.current) return
      if (!workspaceToggleRef.current.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickAway)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
    }
  }, [workspaceMenuOpen])

  const overlayAdapterRef = useRef<OverlayLayoutAdapter | null>(null)
  const layoutLoadedRef = useRef(false)
  const layoutRevisionRef = useRef<string | null>(null)
  const lastSavedLayoutHashRef = useRef<string | null>(null)
  const pendingLayoutRef = useRef<{ payload: OverlayLayoutPayload; hash: string } | null>(null)
  const saveInFlightRef = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(false) // Track if we're in initial database load

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

  // Initialize overlay adapter when workspace changes
  useEffect(() => {
    if (!overlayPersistenceActive) {
      overlayAdapterRef.current = null
      return
    }

    const workspaceKey = currentWorkspaceId ?? 'default'
    overlayAdapterRef.current = new OverlayLayoutAdapter({ workspaceKey })
    layoutLoadedRef.current = false
    layoutRevisionRef.current = null
    lastSavedLayoutHashRef.current = null
    pendingLayoutRef.current = null
  }, [overlayPersistenceActive, currentWorkspaceId])

  // Force re-center trigger - increment to force effect to run
  // Ref to access canvas methods
  const canvasRef = useRef<any>(null)

  // Ref to track last centered note to avoid repeated centering during normal flow

  // Ref to track when canvas last loaded a note (to avoid duplicate centering)
  const lastCanvasLoadTimeRef = useRef<number>(0)
  const pendingCenterAfterLoadRef = useRef<string | null>(null)

  const registerFreshNote = useCallback((noteId: string) => {
    if (!freshNotesRef.current.has(noteId)) {
      freshNotesRef.current.add(noteId)
      setFreshNoteIds(Array.from(freshNotesRef.current))
    }
  }, [])
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
      hoverTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      hoverTimeoutRef.current.clear()
      closeTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      closeTimeoutRef.current.clear()
    }
  }, [layerContext?.activeLayer, multiLayerEnabled, layerContext])

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear all hover timeouts
      hoverTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      hoverTimeoutRef.current.clear()

      // Clear all close timeouts
      closeTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      closeTimeoutRef.current.clear()
    }
  }, [])

  // Keep draggingPopupRef in sync
  useEffect(() => {
    draggingPopupRef.current = draggingPopup
  }, [draggingPopup])

  // Handle global mouse events for dragging popup
  useEffect(() => {
    if (!draggingPopup) return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      e.preventDefault()

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

      // Calculate new screen position
      const newScreenPosition = {
        x: e.clientX - dragOffsetRef.current.x,
        y: e.clientY - dragOffsetRef.current.y
      }

      // Convert to canvas coordinates
      const newCanvasPosition = CoordinateBridge.screenToCanvas(newScreenPosition, sharedTransform)

      const deltaScreen = {
        x: newScreenPosition.x - dragScreenPosRef.current.x,
        y: newScreenPosition.y - dragScreenPosRef.current.y,
      }
      const scale = sharedTransform.scale || 1
      const deltaCanvas = {
        x: deltaScreen.x / scale,
        y: deltaScreen.y / scale,
      }
      const cascadeActive = moveCascadeState.parentId === draggingPopup
      const cascadeChildSet = cascadeActive ? new Set(moveCascadeState.childIds) : null

      setOverlayPopups(prev =>
        prev.map(p => {
          if (p.id === draggingPopup) {
            return { ...p, canvasPosition: newCanvasPosition, position: newScreenPosition, isDragging: true }
          }
          if (cascadeChildSet?.has(p.id) && !p.isPinned) {
            const prevCanvas = p.canvasPosition || { x: 0, y: 0 }
            const newChildCanvas = { x: prevCanvas.x + deltaCanvas.x, y: prevCanvas.y + deltaCanvas.y }
            const prevScreen = p.position || CoordinateBridge.canvasToScreen(prevCanvas, sharedTransform)
            const newChildScreen = { x: prevScreen.x + deltaScreen.x, y: prevScreen.y + deltaScreen.y }
            return { ...p, canvasPosition: newChildCanvas, position: newChildScreen }
          }
          return p
        })
      )

      dragScreenPosRef.current = newScreenPosition
    }

    const handleGlobalMouseUp = () => {
      if (!draggingPopup) return

      // Mark popup as no longer dragging
      setOverlayPopups(prev =>
        prev.map(p =>
          p.id === draggingPopup
            ? { ...p, isDragging: false }
            : p
        )
      )

      setDraggingPopup(null)
      draggingPopupRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    // Use capture phase for better responsiveness
    document.addEventListener('mousemove', handleGlobalMouseMove, true)
    document.addEventListener('mouseup', handleGlobalMouseUp, true)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove, true)
      document.removeEventListener('mouseup', handleGlobalMouseUp, true)
    }
  }, [draggingPopup, layerContext, moveCascadeState]) // Stable during drag - only refs used inside

  // Build layout payload from current overlayPopups state
  const buildLayoutPayload = useCallback((): { payload: OverlayLayoutPayload; hash: string } => {
    const descriptors: OverlayPopupDescriptor[] = []
    const sharedTransform = layerContext?.transforms.popups || DEFAULT_CAMERA

    overlayPopups.forEach(popup => {
      const canvasPos = popup.canvasPosition
      if (!canvasPos) return

      const x = Number.isFinite(canvasPos.x) ? canvasPos.x : 0
      const y = Number.isFinite(canvasPos.y) ? canvasPos.y : 0

      // Derive display name with fallbacks to ensure we always persist a usable label
      const displayName = popup.folderName?.trim()
        || popup.folder?.name?.trim()
        || deriveFromPath((popup.folder as any)?.path)
        || 'Untitled Folder'

      const descriptor: OverlayPopupDescriptor = {
        id: popup.id,
        folderId: popup.folderId || null,
        folderName: displayName,
        folderColor: null,  // Don't cache colors - always fetch fresh from DB on restore
        parentId: popup.parentPopupId || null,
        canvasPosition: { x, y },
        level: popup.level || 0,
        width: popup.width ?? DEFAULT_POPUP_WIDTH,
        height: popup.height ?? DEFAULT_POPUP_HEIGHT,
      }

      console.log('[Save] Saving popup:', displayName, '- color:', popup.folder?.color, '- descriptor:', JSON.stringify(descriptor))
      descriptors.push(descriptor)
    })

    const camera: OverlayCameraState = {
      x: Number.isFinite(sharedTransform.x) ? (sharedTransform.x as number) : 0,
      y: Number.isFinite(sharedTransform.y) ? (sharedTransform.y as number) : 0,
      scale: Number.isFinite(sharedTransform.scale) ? (sharedTransform.scale as number) : 1,
    }

    const payload: OverlayLayoutPayload = {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: descriptors,
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
      camera,
    }

    const hash = JSON.stringify({
      schemaVersion: payload.schemaVersion,
      popups: payload.popups,
      inspectors: payload.inspectors,
      camera,
    })

    return { payload, hash }
  }, [overlayPopups, layerContext?.transforms.popups])

  const handleRepairMismatchedPopups = useCallback(() => {
    const diagnostics = diagnosticsRef.current
    if (!diagnostics) {
      return
    }

    const flaggedPopupIds = new Set<string>()
    diagnostics.workspaceMismatches.forEach(entry => {
      if (entry.popupId) flaggedPopupIds.add(entry.popupId)
    })
    diagnostics.missingFolders.forEach(entry => {
      if (entry.popupId) flaggedPopupIds.add(entry.popupId)
    })

    if (flaggedPopupIds.size === 0) {
      setPendingDiagnostics(null)
      lastDiagnosticsHashRef.current = null
      return
    }

    setOverlayPopups(prev => prev.filter(popup => !flaggedPopupIds.has(popup.id)))
    needsSaveAfterInteractionRef.current = true
    pendingLayoutRef.current = null

    debugLog({
      component: 'PopupOverlay',
      action: 'overlay_workspace_repair_applied',
      metadata: {
        removedPopupIds: Array.from(flaggedPopupIds),
        mismatchCount: diagnostics.workspaceMismatches.length,
        missingCount: diagnostics.missingFolders.length,
      },
    })

    toast({
      title: flaggedPopupIds.size === 1 ? 'Removed 1 popup' : `Removed ${flaggedPopupIds.size} popups`,
      description:
        diagnostics.workspaceMismatches.length > 0
          ? 'Popups referencing another workspace were removed from this layout.'
          : 'Popups without matching folders were removed from this layout.',
    })

    setPendingDiagnostics(null)
    lastDiagnosticsHashRef.current = null
  }, [setOverlayPopups])

  // Apply layout from database
  const applyOverlayLayout = useCallback((layout: OverlayLayoutPayload) => {
    const diagnostics = layout.diagnostics ?? null
    const mismatchCount = diagnostics?.workspaceMismatches?.length ?? 0
    const missingCount = diagnostics?.missingFolders?.length ?? 0
    const hasDiagnostics = Boolean(diagnostics) && (mismatchCount > 0 || missingCount > 0)

    if (hasDiagnostics && diagnostics) {
      const digest = JSON.stringify({
        mismatches: diagnostics.workspaceMismatches.map(entry => ({
          popupId: entry.popupId,
          actualWorkspaceId: entry.actualWorkspaceId ?? null,
        })),
        missing: diagnostics.missingFolders.map(entry => ({
          popupId: entry.popupId,
          folderId: entry.folderId ?? null,
        })),
      })

      if (lastDiagnosticsHashRef.current !== digest) {
        lastDiagnosticsHashRef.current = digest
        setPendingDiagnostics(diagnostics)

        debugLog({
          component: 'PopupOverlay',
          action: 'overlay_workspace_mismatch_detected',
          metadata: {
            workspaceId: currentWorkspaceId,
            mismatchCount,
            missingCount,
            mismatches: diagnostics.workspaceMismatches.slice(0, 10),
            missingFolders: diagnostics.missingFolders.slice(0, 10),
          },
        })

        const summaryParts: string[] = []
        if (mismatchCount > 0) {
          summaryParts.push(
            mismatchCount === 1
              ? '1 popup belongs to a different workspace.'
              : `${mismatchCount} popups belong to a different workspace.`
          )
        }
        if (missingCount > 0) {
          summaryParts.push(
            missingCount === 1
              ? '1 popup references a folder that no longer exists.'
              : `${missingCount} popups reference folders that no longer exist.`
          )
        }

        toast({
          variant: 'destructive',
          title: 'Overlay layout needs repair',
          description: summaryParts.join(' '),
          action: (
            <ToastAction altText="Repair popups" onClick={handleRepairMismatchedPopups}>
              Repair
            </ToastAction>
          ),
        })
      }
    } else {
      if (pendingDiagnostics) {
        setPendingDiagnostics(null)
      }
      lastDiagnosticsHashRef.current = null
    }

    const savedCamera = layout.camera ?? DEFAULT_CAMERA
    if (layerContext?.setTransform) {
      const currentTransform = layerContext.transforms.popups || DEFAULT_CAMERA
      if (!camerasEqual(currentTransform, savedCamera)) {
        layerContext.setTransform('popups', savedCamera)
      }
    }
    latestCameraRef.current = savedCamera
    prevCameraForSaveRef.current = savedCamera
    const { popups: hydratedPopups, hash: coreHash } = buildHydratedOverlayLayout(layout, savedCamera)
    lastSavedLayoutHashRef.current = coreHash
    // NOTE: Do NOT set layoutLoadedRef.current = true here!
    // It must be set AFTER setOverlayPopups completes, to prevent auto-switch during hydration
    // The load effect (lines 562-604) sets it correctly at line 596

    if (hydratedPopups.length === 0) {
      setOverlayPopups([])
      return
    }

    const restoredPopups = (hydratedPopups as OverlayPopup[]).map((popup) => ({
      ...popup,
      sizeMode: popup.sizeMode ?? (
        Number.isFinite(popup.width) || Number.isFinite(popup.height)
          ? 'auto'
          : 'default'
      )
    }))
    setOverlayPopups(restoredPopups)

    const popupsNeedingFetch = restoredPopups.filter(p => p.isLoading && p.folderId)
    if (popupsNeedingFetch.length === 0) {
      return
    }

    // Fallback: fetch folder data when metadata was not prefetched
    popupsNeedingFetch.forEach(async (popup) => {
      if (!popup.folderId) return

      try {
        const responseData = await fetchGlobalFolder(popup.folderId)
        if (!responseData) return
        const folderData = responseData.item || responseData

        // Get the cached color from the descriptor
        const cachedColor = popup.folder?.color

        console.log('[Restore] Processing', folderData.name, '- DB color:', folderData.color, ', cached:', cachedColor)

        // Start with folder's own color, fall back to cached
        let effectiveColor = folderData.color || cachedColor

        // Walk up ancestor chain if we have no color at all (neither DB nor cache)
        if (!effectiveColor) {
          const initialParentId = folderData.parentId ?? folderData.parent_id
          console.log('[Restore] No color for', folderData.name, '- walking ancestor chain from:', initialParentId)
          if (initialParentId) {
            try {
              let currentParentId = initialParentId
              let depth = 0
              const maxDepth = 10 // Prevent infinite loops

              while (currentParentId && !effectiveColor && depth < maxDepth) {
                const parentResponse = await fetchWithWorkspace(`/api/items/${currentParentId}`)
                if (!parentResponse.ok) break

                const parentData = await parentResponse.json()
                const parent = parentData.item || parentData

                if (parent.color) {
                  effectiveColor = parent.color
                  console.log('[Restore] Inherited color from ancestor:', parent.name, 'color:', effectiveColor, 'depth:', depth + 1)
                  break
                }

                // Move up to next parent
                currentParentId = parent.parentId ?? parent.parent_id
                depth++
              }

              if (!effectiveColor) {
                console.log('[Restore] No color found in ancestor chain after', depth, 'levels')
              }
            } catch (e) {
              console.warn('[Popup Restore] Failed to fetch ancestor color:', e)
            }
          }
        }

        console.log('[Restore] Final effectiveColor for', folderData.name, ':', effectiveColor)

        // Fetch children
        const childItems = await fetchGlobalChildren(popup.folderId)
        if (!childItems) return
        const children = childItems.map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          path: item.path,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          hasChildren: item.type === 'folder',
          level: popup.level + 1,
          children: [],
          parentId: item.parentId ?? item.parent_id,
        }))

        setOverlayPopups(prev => {
          const updated = prev.map(p => {
            if (p.id !== popup.id) return p

            // Derive display name with fallbacks to prevent blank name from wiping cached label
            const displayName = folderData.name?.trim()
              || deriveFromPath(folderData.path)
              || p.folderName?.trim()  // Keep existing cached name if new data has no name
              || 'Untitled Folder'

            return {
              ...p,
              folderName: displayName,
              folder: {
                id: folderData.id,
                name: displayName,
                type: 'folder' as const,
                level: p.level,
                color: effectiveColor,
                path: folderData.path,
                children,
              },
              children,
              isLoading: false,
            }
          })

          return updated
        })
      } catch (error) {
        if (isDebugEnabled()) {
          debugLog({
            component: 'AnnotationApp',
            action: 'folder_load_failed',
            metadata: {
              folderId: popup.folderId,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          })
        }
      }
    })
  }, [layerContext, handleRepairMismatchedPopups, currentWorkspaceId, pendingDiagnostics])

  // Flush pending save to database
  const flushLayoutSave = useCallback(async () => {
    if (!overlayPersistenceActive) return

    const adapter = overlayAdapterRef.current
    if (!adapter) return

    const pending = pendingLayoutRef.current ?? (() => {
      const snapshot = buildLayoutPayload()
      return snapshot.hash === lastSavedLayoutHashRef.current ? null : snapshot
    })()

    if (!pending) return

    if (saveInFlightRef.current) {
      pendingLayoutRef.current = pending
      return
    }

    pendingLayoutRef.current = null
    saveInFlightRef.current = true

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    try {
      const envelope = await adapter.saveLayout({
        layout: pending.payload,
        version: pending.payload.schemaVersion,
        revision: layoutRevisionRef.current,
      })

      layoutRevisionRef.current = envelope.revision
      lastSavedLayoutHashRef.current = JSON.stringify({
        schemaVersion: envelope.layout.schemaVersion,
        popups: envelope.layout.popups,
        inspectors: envelope.layout.inspectors,
        camera: envelope.layout.camera ?? DEFAULT_CAMERA,
      })
      console.log('[AnnotationApp] Saved overlay layout to database')
    } catch (error) {
      if (error instanceof OverlayLayoutConflictError) {
        const envelope = error.payload
        layoutRevisionRef.current = envelope.revision
        lastSavedLayoutHashRef.current = JSON.stringify({
          schemaVersion: envelope.layout.schemaVersion,
          popups: envelope.layout.popups,
          inspectors: envelope.layout.inspectors,
          camera: envelope.layout.camera ?? DEFAULT_CAMERA,
        })
        applyOverlayLayout(envelope.layout)
        console.log('[AnnotationApp] Resolved layout conflict from database')
      } else {
        if (isDebugEnabled()) {
          debugLog({
            component: 'AnnotationApp',
            action: 'overlay_layout_save_failed',
            metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
          })
        }
        pendingLayoutRef.current = pending
      }
    } finally {
      saveInFlightRef.current = false
      if (pendingLayoutRef.current) {
        void flushLayoutSave()
      }
    }
  }, [applyOverlayLayout, buildLayoutPayload, overlayPersistenceActive])

  // Schedule save with debounce (or immediate for creation/deletion)
  const scheduleLayoutSave = useCallback((immediate = false) => {
    if (!overlayPersistenceActive) return
    if (!overlayAdapterRef.current) return
    if (draggingPopupRef.current) {
      console.log('[AnnotationApp] Save skipped: popup dragging in progress')
      return
    }

    const snapshot = buildLayoutPayload()

    if (snapshot.hash === lastSavedLayoutHashRef.current) {
      pendingLayoutRef.current = null
      return
    }

    if (saveInFlightRef.current) {
      pendingLayoutRef.current = snapshot
      return
    }

    pendingLayoutRef.current = snapshot

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    if (immediate) {
      // Immediate save (for creation/deletion - existence changes)
      console.log('[AnnotationApp] Saving immediately (existence change)...')
      void flushLayoutSave()
    } else {
      // Debounced save (for moves, resizes, etc. - property changes)
      saveTimeoutRef.current = setTimeout(() => {
        void flushLayoutSave()
      }, 2500) // 2.5 second debounce
    }
  }, [buildLayoutPayload, flushLayoutSave, overlayPersistenceActive])

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
  useEffect(() => {
    if (!overlayPersistenceActive || layoutLoadedRef.current) return

    const adapter = overlayAdapterRef.current
    if (!adapter) return

    let cancelled = false
    setIsWorkspaceLayoutLoading(true)

    void (async () => {
      try {
        console.log('[AnnotationApp] Loading overlay layout from database...')
        const envelope = await adapter.loadLayout()
        if (cancelled) return

        if (!envelope) {
          console.log('[AnnotationApp] No saved layout found')
          layoutRevisionRef.current = null
          lastSavedLayoutHashRef.current = null
          layoutLoadedRef.current = true
          setOverlayPopups([])
          setIsWorkspaceLayoutLoading(false)
          return
        }

        console.log('[AnnotationApp] Loaded overlay layout from database:', envelope.layout.popups.length, 'popups')
        layoutRevisionRef.current = envelope.revision
        lastSavedLayoutHashRef.current = JSON.stringify({
          schemaVersion: envelope.layout.schemaVersion,
          popups: envelope.layout.popups,
          inspectors: envelope.layout.inspectors,
          camera: envelope.layout.camera ?? DEFAULT_CAMERA,
        })

        // Set flag to indicate initial load is in progress
        // This prevents auto-switch during hydration
        isInitialLoadRef.current = true
        applyOverlayLayout(envelope.layout)
        // NOTE: Do NOT set layoutLoadedRef.current = true here!
        // It will be set by the useEffect below after overlayPopups state update completes
      } catch (error) {
        if (!cancelled) {
          console.error('[AnnotationApp] Failed to load overlay layout:', error)
          layoutLoadedRef.current = true // Set on error so we don't block saves
          toast({
            variant: 'destructive',
            title: 'Failed to load workspace layout',
            description:
              error instanceof Error ? error.message : 'Unexpected error while loading the workspace.',
          })
        }
      } finally {
        if (!cancelled) {
          setIsWorkspaceLayoutLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyOverlayLayout, overlayPersistenceActive, currentWorkspaceId, setOverlayPopups])

  // Set layoutLoadedRef.current = true AFTER initial popups load completes
  // This ensures auto-switch doesn't trigger during database hydration
  useEffect(() => {
    if (isInitialLoadRef.current && overlayPopups.length >= 0) {
      // Initial load completed (popups state has been updated)
      console.log('[AnnotationApp] Initial layout load complete, enabling auto-switch')
      layoutLoadedRef.current = true
      isInitialLoadRef.current = false
    }
  }, [overlayPopups.length])

  // Save layout when overlayPopups changes
  // Use a ref to track if we need to save, to avoid infinite loops
  const prevPopupsRef = useRef<OverlayPopup[]>([])
  const needsSaveAfterInteractionRef = useRef(false)

  useEffect(() => {
    console.log(
      '[AnnotationApp] Save effect triggered.',
      {
        overlayPersistenceEnabled,
        overlayPersistenceActive,
        overlayCount: overlayPopups.length,
        layoutLoaded: layoutLoadedRef.current,
      }
    )
    if (!overlayPersistenceActive) {
      console.log('[AnnotationApp] Save skipped: persistence inactive')
      return
    }
    if (!layoutLoadedRef.current) {
      console.log('[AnnotationApp] Save skipped: layout not loaded yet')
      prevPopupsRef.current = overlayPopups
      return
    }

    const serializeForChangeDetection = (popups: OverlayPopup[]) =>
      popups.map(p => ({
        id: p.id,
        width: p.width,
        height: p.height,
        canvasPosition: p.canvasPosition,
        position: p.position,
        level: p.level,
        parentPopupId: p.parentPopupId,
        childrenCount: p.children?.length ?? 0,
      }))

    const currentSnapshot = serializeForChangeDetection(overlayPopups)
    const prevSnapshot = serializeForChangeDetection(prevPopupsRef.current)
    const changed = JSON.stringify(currentSnapshot) !== JSON.stringify(prevSnapshot)

    const anyDragging = overlayPopups.some(popup => popup.isDragging)
    if (anyDragging || overlayPanning) {
      if (changed) {
        console.log('[AnnotationApp] Save deferred: canvas interaction in progress', { anyDragging, overlayPanning })
        needsSaveAfterInteractionRef.current = true
      } else {
        console.log('[AnnotationApp] Save skipped: interaction in progress (no layout delta)')
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      return
    }

    if (!changed) {
      console.log('[AnnotationApp] Save skipped: no changes detected')
      prevPopupsRef.current = overlayPopups
      needsSaveAfterInteractionRef.current = false
      return
    }

    // Detect if this is a creation or deletion (existence change vs property change)
    const isCreation = overlayPopups.length > prevPopupsRef.current.length
    const isDeletion = overlayPopups.length < prevPopupsRef.current.length
    const isExistenceChange = isCreation || isDeletion

    if (isCreation) {
      console.log('[AnnotationApp] Scheduling save... (IMMEDIATE - creation)')
    } else if (isDeletion) {
      console.log('[AnnotationApp] Scheduling save... (IMMEDIATE - deletion)')
    } else {
      console.log('[AnnotationApp] Scheduling save... (debounced - property change)')
    }

    prevPopupsRef.current = overlayPopups
    needsSaveAfterInteractionRef.current = false
    scheduleLayoutSave(isExistenceChange) // Immediate save for creation/deletion, debounced for moves/resizes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayPopups, overlayPersistenceActive, overlayPanning, draggingPopup])

  useEffect(() => {
    if (!overlayPanning) return
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      pendingLayoutRef.current = null
      console.log('[AnnotationApp] Cleared pending layout save due to overlay panning')
    }
  }, [overlayPanning])

  useEffect(() => {
    if (!overlayPanning && needsSaveAfterInteractionRef.current) {
      console.log('[AnnotationApp] Resuming deferred overlay save after interaction')
      needsSaveAfterInteractionRef.current = false
      scheduleLayoutSave(false)
    }
  }, [overlayPanning, scheduleLayoutSave])

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

  const centerNoteOnCanvas = useCallback(
    (noteId: string, overrides?: CenterOnNoteOptions) => {
      const attempts = overrides?.attempts ?? CENTER_RETRY_ATTEMPTS
      const delayMs = overrides?.delayMs ?? CENTER_RETRY_DELAY_MS
      const extraShouldRetry = overrides?.shouldRetry

      const shouldRetry = () => {
        if (activeNoteIdRef.current !== noteId) return false
        return extraShouldRetry ? extraShouldRetry() : true
      }

      const handled = centerOnNotePanel(canvasRef.current, noteId, {
        attempts,
        delayMs,
        shouldRetry,
        onError: overrides?.onError,
      })

      if (!handled) {
        debugLog({
          component: 'AnnotationApp',
          action: 'center_on_panel_skipped',
          metadata: {
            noteId,
            reason: 'canvas_unavailable'
          }
        })
      }
    },
    [],
  )

  const handleSnapshotLoadComplete = useCallback(() => {
    lastCanvasLoadTimeRef.current = Date.now()
    debugLog({
      component: 'AnnotationApp',
      action: 'snapshot_load_complete',
      metadata: { timestamp: lastCanvasLoadTimeRef.current }
    })

    const pendingNoteId = pendingCenterAfterLoadRef.current
    if (pendingNoteId && activeNoteIdRef.current === pendingNoteId) {
      const scheduleCenter = (attempts = POST_LOAD_CENTER_ATTEMPTS) => {
        centerNoteOnCanvas(pendingNoteId, {
          attempts,
          delayMs: POST_LOAD_CENTER_DELAY_MS,
        })
      }

      setTimeout(() => {
        if (activeNoteIdRef.current === pendingNoteId) {
          scheduleCenter()
        }
      }, 30)

      setTimeout(() => {
        if (activeNoteIdRef.current === pendingNoteId) {
          scheduleCenter(POST_LOAD_CENTER_ATTEMPTS)
        }
      }, POST_LOAD_SECOND_PASS_DELAY_MS)

      setTimeout(() => {
        if (pendingCenterAfterLoadRef.current === pendingNoteId) {
          pendingCenterAfterLoadRef.current = null
        }
      }, POST_LOAD_PENDING_CLEAR_DELAY_MS)
    }
  }, [centerNoteOnCanvas])

  const handleFreshNoteHydrated = useCallback((noteId: string) => {
    if (!freshNotesRef.current.has(noteId)) {
      return
    }

    freshNotesRef.current.delete(noteId)
    setFreshNoteIds(Array.from(freshNotesRef.current))

    debugLog({
      component: 'AnnotationApp',
      action: 'fresh_note_hydrated',
      metadata: { noteId }
    })

    const events = sharedWorkspace?.events
    if (!events) {
      return
    }

    try {
      events.emit('workspace:highlight-note', { noteId })
      debugLog({
        component: 'AnnotationApp',
        action: 'fresh_note_highlight_emitted',
        metadata: { noteId }
      })
    } catch (error) {
      console.warn('[AnnotationApp] Failed to emit highlight for fresh note:', error)
    }
  }, [sharedWorkspace])

  const handleNoteSelect = useCallback((noteId: string, options?: { initialPosition?: { x: number; y: number } | null; source?: 'toolbar-create' | 'toolbar-open' | 'popup' | 'recent' }) => {
    debugLog({
      component: 'AnnotationApp',
      action: 'note_select',
      metadata: {
        noteId,
        activeNoteId,
        isReselect: noteId === activeNoteId,
        source: options?.source,
        hasOptions: !!options
      }
    })

    // Track note access in recent notes and refresh toolbar's recent notes list
    // Only refresh if tracking succeeds (promise resolves)
    const isReselect = noteId === activeNoteId
    const isToolbarCreation = options?.source === 'toolbar-create'

    if (isToolbarCreation) {
      registerFreshNote(noteId)
    }

    trackNoteAccess(noteId)
      .then(() => {
        // Increment refresh trigger after tracking completes to update toolbar's recent notes
        setRecentNotesRefreshTrigger(prev => prev + 1)
      })
      .catch(() => {
        // Error already logged by trackNoteAccess, silently skip refresh
        // Note will still open, just won't appear in recent notes
      })

    const emitHighlight = () => {
      // Skip highlight during workspace hydration (TDD §4.1)
      if (isHydrating) {
        debugLog({
          component: 'AnnotationApp',
          action: 'highlight_event_skipped',
          metadata: { noteId, reason: 'workspace_hydrating' }
        })
        return
      }

      const events = sharedWorkspace?.events
      if (!events) {
        debugLog({
          component: 'AnnotationApp',
          action: 'highlight_event_skipped',
          metadata: { noteId, reason: 'no_workspace_events' }
        })
        return
      }
      try {
        events.emit('workspace:highlight-note', { noteId })
      } catch (error) {
        console.warn('[AnnotationApp] Failed to emit highlight event:', error)
      }
    }

    if (isReselect) {
      logWorkspaceNotePositions('tab_click_reselect')
      debugLog({
        component: 'AnnotationApp',
        action: 'highlight_note',
        metadata: { noteId }
      })
      if (!isToolbarCreation) {
        emitHighlight()
      }
      return
    }

    // Different note - ensure it's marked open and marked as focused
    setSkipSnapshotForNote(noteId)
    const alreadyOpen = openNotes.some(open => open.noteId === noteId)

    debugLog({
      component: 'AnnotationApp',
      action: 'toolbar_click_debug',
      metadata: {
        noteId,
        alreadyOpen,
        openNotesCount: openNotes.length,
        openNoteIds: openNotes.map(n => n.noteId),
        isThisNoteInList: openNotes.some(n => n.noteId === noteId)
      }
    })

    // CRITICAL FIX (infinite-canvas approach): Separate new note creation from reopening
    // NEW NOTES: Always compute fresh viewport-centered position (NO CACHING)
    // EXISTING NOTES: Look up persisted position from database
    const hasExplicitPosition = Boolean(options?.initialPosition)
    let resolvedPosition = options?.initialPosition ?? null

    // CRITICAL FIX: Fetch persisted position early to use in centering guard
    // This prevents recentering notes that already have a saved position
    const persistedPosition = !alreadyOpen && !hasExplicitPosition
      ? resolveMainPanelPosition(noteId)
      : null

    // HYDRATION GAP FIX: Check if panel already rendered on canvas
    // During early hydration, openNotes is empty so resolveMainPanelPosition returns null,
    // but the canvas has already rendered panels from database. Treat rendered panels
    // as "having a persisted position" to prevent recentering during hydration gap.
    const dataStore = sharedWorkspace?.dataStore
    const panelAlreadyRendered = dataStore ? dataStore.has(ensurePanelKey(noteId, 'main')) : false

    const hasPersistedPosition = Boolean(
      (persistedPosition && !isDefaultMainPosition(persistedPosition)) ||
      panelAlreadyRendered  // Treat rendered panels as persisted
    )

    debugLog({
      component: 'AnnotationApp',
      action: 'position_guard_check',
      metadata: {
        noteId,
        alreadyOpen,
        hasExplicitPosition,
        hasPersisted: !!persistedPosition,
        panelAlreadyRendered,
        hasPersistedPosition,
        persistedPosition
      }
    })

    if (isToolbarCreation && !hasExplicitPosition) {
      // NEW NOTE: Compute viewport-centered position using simple, direct formula
      // This is the infinite-canvas approach - no caching, no async lookups
      const currentCamera = canvasRef.current?.getCameraState?.() ?? canvasState

      debugLog({
        component: 'AnnotationApp',
        action: 'new_note_camera_state',
        metadata: {
          noteId,
          currentCamera,
          canvasState,
          hasGetCameraState: !!canvasRef.current?.getCameraState
        }
      })

      // Get viewport center in screen coordinates
      const viewportCenterX = typeof window !== 'undefined' ? window.innerWidth / 2 : 960
      const viewportCenterY = typeof window !== 'undefined' ? window.innerHeight / 2 : 540

      // Convert to world coordinates accounting for camera transform
      // Formula: worldX = (screenX - cameraX) / zoom
      const PANEL_WIDTH = 500
      const PANEL_HEIGHT = 400
      const worldX = (viewportCenterX - (currentCamera.translateX ?? 0)) / (currentCamera.zoom ?? 1) - PANEL_WIDTH / 2
      const worldY = (viewportCenterY - (currentCamera.translateY ?? 0)) / (currentCamera.zoom ?? 1) - PANEL_HEIGHT / 2

      resolvedPosition = { x: worldX, y: worldY }

      debugLog({
        component: 'AnnotationApp',
        action: 'new_note_viewport_centered',
        metadata: {
          noteId,
          viewportCenter: { x: viewportCenterX, y: viewportCenterY },
          camera: currentCamera,
          worldPosition: resolvedPosition,
          formula: `x = (${viewportCenterX} - ${currentCamera.translateX ?? 0}) / ${currentCamera.zoom ?? 1} - ${PANEL_WIDTH / 2}`,
          formulaY: `y = (${viewportCenterY} - ${currentCamera.translateY ?? 0}) / ${currentCamera.zoom ?? 1} - ${PANEL_HEIGHT / 2}`
        }
      })

      // DO NOT cache this position - use it immediately
    } else if (!hasExplicitPosition && !alreadyOpen) {
      // EXISTING NOTE: Use persisted position fetched earlier
      resolvedPosition = persistedPosition ?? null

      debugLog({
        component: 'AnnotationApp',
        action: 'existing_note_persisted_position',
        metadata: {
          noteId,
          persistedPosition: resolvedPosition,
          hasPersistedPosition
        }
      })
    }

    if (!alreadyOpen) {

      const shouldCenterExisting =
        CENTER_EXISTING_NOTES_ENABLED &&
        !isToolbarCreation &&
        !hasExplicitPosition &&
        !hasPersistedPosition  // CRITICAL FIX: Only center if no saved position exists

      debugLog({
        component: 'AnnotationApp',
        action: 'centering_guard_evaluated',
        metadata: {
          noteId,
          CENTER_EXISTING_NOTES_ENABLED,
          isToolbarCreation,
          hasExplicitPosition,
          hasPersistedPosition,
          panelAlreadyRendered,
          shouldCenterExisting,
          fixBlocked: !shouldCenterExisting && panelAlreadyRendered  // NEW: Show when hydration gap fix blocks centering
        }
      })

      let usedCenteredOverride = false
      if (shouldCenterExisting) {
        debugLog({
          component: 'AnnotationApp',
          action: 'centering_override_applying',
          metadata: { noteId, reason: 'shouldCenterExisting=true' }
        })
        // Get current camera state directly from canvas ref to avoid stale React state
        const currentCamera = canvasRef.current?.getCameraState?.() ?? canvasState

        debugLog({
          component: 'AnnotationApp',
          action: 'existing_note_centering_camera_state',
          metadata: {
            noteId,
            currentCamera,
            canvasState,
            hasGetCameraState: !!canvasRef.current?.getCameraState
          }
        })

        // EXISTING NOTES: Always use viewport center (null = use viewport center)
        // Don't use lastCanvasInteractionRef because we want screen center, not last click position
        const centeredCandidate = computeVisuallyCenteredWorldPosition(
          {
            translateX: currentCamera.translateX,
            translateY: currentCamera.translateY,
            zoom: currentCamera.zoom,
          },
          reopenSequenceRef.current,
          null,  // Force viewport center, ignore last interaction
        )

        debugLog({
          component: 'AnnotationApp',
          action: 'existing_note_centered_candidate',
          metadata: {
            noteId,
            centeredCandidate,
            lastInteraction: lastCanvasInteractionRef.current,
            sequenceCount: reopenSequenceRef.current.count
          }
        })

        // Use pure centered position (100%) - same behavior as new notes
        if (centeredCandidate) {
          resolvedPosition = centeredCandidate
          usedCenteredOverride = true

          // CRITICAL: Store in freshNoteSeeds so canvas gets position BEFORE first paint
          // This prevents the panel from appearing elsewhere and then moving
          setFreshNoteSeeds(prev => ({
            ...prev,
            [noteId]: centeredCandidate
          }))
        }

        if (usedCenteredOverride) {
          const persistedPosition = resolveMainPanelPosition(noteId)
          debugLog({
            component: "AnnotationApp",
            action: "open_note_centered_override",
            metadata: {
              noteId,
              persistedPosition,
              centeredPosition: resolvedPosition,
              storedInFreshNoteSeeds: true
            },
          })
        }
      } else if (panelAlreadyRendered) {
        // HYDRATION GAP FIX: Centering blocked because panel already rendered
        debugLog({
          component: 'AnnotationApp',
          action: 'centering_blocked_by_hydration_gap_fix',
          metadata: {
            noteId,
            reason: 'Panel already rendered on canvas',
            panelAlreadyRendered,
            hasPersistedPosition
          }
        })
      }

      if (shouldCenterExisting) {
        requestMainOnlyNote(noteId)
      }

      const skipPersistPosition = false

      debugLog({
        component: 'AnnotationApp',
        action: 'calling_openWorkspaceNote',
        metadata: {
          noteId,
          resolvedPosition,
          isToolbarCreation,
          hasExplicitPosition
        }
      })

      void openWorkspaceNote(noteId, {
        persist: true,
        mainPosition: resolvedPosition ?? undefined,
        persistPosition: !skipPersistPosition,
      }).catch(error => {
        console.error('[AnnotationApp] Failed to open note in workspace:', error)
      })
    }
    setActiveNoteId(noteId)
    if (!isToolbarCreation) {
      emitHighlight()
    }
  }, [activeNoteId, logWorkspaceNotePositions, isHydrating, sharedWorkspace, openNotes, openWorkspaceNote, resolveMainPanelPosition, setSkipSnapshotForNote, registerFreshNote, setRecentNotesRefreshTrigger, canvasState, requestMainOnlyNote])

  const handleCloseNote = useCallback(
    (noteId: string) => {
      if (!noteId) return

      void closeWorkspaceNote(noteId).catch(error => {
        console.error('[AnnotationApp] Failed to close workspace note:', error)
      })
    },
    [closeWorkspaceNote],
  )

const handleCenterNote = useCallback(
    (noteId: string) => {
      if (!noteId) return

      debugLog({
        component: 'AnnotationApp',
        action: 'manual_center_request',
        metadata: {
          noteId,
          activeNoteId,
        },
      })

      if (noteId !== activeNoteId) {
        setActiveNoteId(noteId)
      }

      const events = sharedWorkspace?.events
      if (events) {
        try {
          events.emit('workspace:highlight-note', { noteId })
        } catch (error) {
          console.warn('[AnnotationApp] Failed to emit manual highlight event:', error)
        }
      }

      centerNoteOnCanvas(noteId, { attempts: CENTER_RETRY_ATTEMPTS + 1 })
    },
    [activeNoteId, setActiveNoteId, sharedWorkspace],
  )

  const handleSnapshotSettled = useCallback((noteId: string) => {
    setSkipSnapshotForNote(current => (current === noteId ? null : current))
  }, [])
  
  // Center panel when note selection changes

  // Handle right-click to show notes widget
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()

    debugLog({
      component: 'AnnotationApp',
      action: 'context_menu_opened',
      metadata: {
        x: e.clientX,
        y: e.clientY,
        canvasTranslateX: canvasState?.translateX,
        canvasTranslateY: canvasState?.translateY
      }
    })

    // Find which panel was right-clicked
    let target = e.target as HTMLElement
    let panelElement: HTMLElement | null = null

    // Traverse up the DOM tree to find the panel element
    // Panels have data-store-key attribute with composite key (noteId::panelId)
    while (target && target !== e.currentTarget) {
      if (target.dataset?.storeKey) {
        panelElement = target
        break
      }
      target = target.parentElement as HTMLElement
    }

    // If a panel was right-clicked, register its composite key as active
    // This allows FloatingToolbar to correctly identify which note's panel was clicked
    if (panelElement?.dataset?.storeKey) {
      const storeKey = panelElement.dataset.storeKey
      console.log('[AnnotationApp] Right-click detected on panel with store key:', storeKey)
      setActivePanelId(storeKey)  // Set full composite key (e.g., "abc123::main")
    }

    setNotesWidgetPosition({ x: e.clientX, y: e.clientY })
    setShowNotesWidget(true)

    debugLog({
      component: 'AnnotationApp',
      action: 'context_menu_after_open',
      metadata: {
        canvasTranslateX: canvasState?.translateX,
        canvasTranslateY: canvasState?.translateY,
        toolbarOpen: true
      }
    })
  }, [canvasState])

  // Handle closing notes widget
  const handleCloseNotesWidget = useCallback(() => {
    setShowNotesWidget(false)
  }, [])

  // Track mouse position for keyboard shortcut
  const mousePositionRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Listen for text selection events from editor
  useEffect(() => {
    const handleShowToolbarOnSelection = (e: Event) => {
      const customEvent = e as CustomEvent
      const { x, y, autoOpenFormat } = customEvent.detail

      setNotesWidgetPosition({ x, y })
      setShowNotesWidget(true)

      // Auto-open Format panel if requested
      // This will be handled by FloatingToolbar component
      if (autoOpenFormat) {
        // Store in window for FloatingToolbar to pick up
        ;(window as any).__autoOpenFormatPanel = true
      }
    }

    window.addEventListener('show-floating-toolbar-on-selection', handleShowToolbarOnSelection)
    return () => window.removeEventListener('show-floating-toolbar-on-selection', handleShowToolbarOnSelection)
  }, [])

  // Keyboard shortcut to open floating toolbar (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()

        // Use last known mouse position
        const { x, y } = mousePositionRef.current

        setNotesWidgetPosition({ x, y })
        setShowNotesWidget(true)
      }

      // Escape to close toolbar
      if (e.key === 'Escape' && showNotesWidget) {
        setShowNotesWidget(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showNotesWidget])

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

  // Handle folder renamed (callback from FloatingToolbar and PopupOverlay)
  const handleFolderRenamed = useCallback((folderId: string, newName: string) => {
    setOverlayPopups(prev => {
      return prev.map(popup => {
        // Case 1: This popup IS the renamed folder - update its title
        if (popup.folderId === folderId) {
          return {
            ...popup,
            folderName: newName,
            folder: popup.folder ? { ...popup.folder, name: newName } : null
          } as OverlayPopup
        }

        // Case 2: This popup CONTAINS the renamed folder in its children array
        // Update the child entry so parent's list shows the new name
        if (popup.folder?.children) {
          const hasMatchingChild = popup.folder.children.some((child: OrgItem) => child.id === folderId)
          if (hasMatchingChild) {
            return {
              ...popup,
              folder: {
                ...popup.folder,
                children: popup.folder.children.map((child: OrgItem) =>
                  child.id === folderId
                    ? { ...child, name: newName }
                    : child
                )
              }
            } as OverlayPopup
          }
        }

        // Case 3: Unrelated popup - return unchanged
        return popup
      })
    })
  }, [])

  // Handle creating overlay popup (callback from FloatingToolbar)
  const handleOrganizationSidebarSelect = useCallback(
    async (folderId: string, rect?: DOMRect) => {
      if (knowledgeBaseId && folderId === knowledgeBaseId) return
      ensureOverlayHydrated('sidebar-select')

      const existingIndex = overlayPopups.findIndex(p => p.folderId === folderId)
      if (existingIndex >= 0) {
        const existingPopup = overlayPopups[existingIndex]
        setOverlayPopups(prev => {
          const without = prev.filter(p => p.id !== existingPopup.id).map(p => ({ ...p, isHighlighted: false }))
          const highlighted = { ...existingPopup, isHighlighted: true }
          return [...without, highlighted]
        })
        layerContext?.setActiveLayer('popups')
        setCanvasMode('overlay')
        return
      }

      try {
        const detailResponse = await fetch(`/api/items/${folderId}`)
        if (!detailResponse.ok) throw new Error('Failed to load folder metadata')
        const detailData = await detailResponse.json()
        const detail = detailData.item || detailData

        const folderName = detail?.name ?? organizationFolders.find(item => item.id === folderId)?.name ?? 'Untitled'
        const folderColor = detail?.color ?? null
        const folderPath = detail?.path ?? null
        const folderLevel = typeof detail?.level === 'number' ? detail.level : 0

        const targetRect = rect || new DOMRect(0, 80, 320, 40)

        const popupWidth = 320
        let popupX = targetRect.right + 16
        if (popupX + popupWidth > window.innerWidth) {
          popupX = Math.max(16, targetRect.left - popupWidth - 16)
        }
        const popupY = Math.min(Math.max(16, targetRect.top), window.innerHeight - 360)

        const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }
        const screenPosition = { x: popupX, y: popupY }
        const canvasPosition = CoordinateBridge.screenToCanvas(screenPosition, sharedTransform)

        const popupId = `overlay-sidebar-${Date.now()}-${folderId}`

        layerContext?.setActiveLayer('popups')
        setCanvasMode('overlay')

        setOverlayPopups(prev => [
          ...prev.map(p => ({ ...p, isHighlighted: false })),
          {
            id: popupId,
            folderId,
            folderName,
            folder: {
              id: folderId,
              name: folderName,
              type: 'folder',
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
          const childResponse = await fetch(`/api/items?parentId=${folderId}`)
          if (!childResponse.ok) throw new Error('Failed to load folder contents')

          const childData = await childResponse.json()
          const childItems: any[] = Array.isArray(childData?.items) ? childData.items : []
          const formattedChildren: OrgItem[] = childItems.map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
            color: item.color,
            path: item.path,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            hasChildren: item.type === 'folder',
            level: (detail?.level ?? 0) + 1,
            children: [],
            parentId: item.parentId,
          }))

          setOverlayPopups(prev =>
            prev.map(p =>
              p.id === popupId
                ? {
                    ...p,
                    children: formattedChildren,
                    isLoading: false,
                    folder: p.folder ? { ...p.folder, children: formattedChildren } : null,
                  }
                : p
            )
          )
          folderCacheRef.current.set(folderId, {
            ...(folderCacheRef.current.get(folderId) ?? {}),
            folder: detail,
            children: childItems,
          })
        } catch (childError) {
          console.error('[AnnotationApp] Failed to load folder children:', childError)
          setOverlayPopups(prev => prev.map(p => (p.id === popupId ? { ...p, isLoading: false } : p)))
        }
      } catch (error) {
        console.error('[AnnotationApp] Failed to open folder popup from sidebar:', error)
      }
    },
    [ensureOverlayHydrated, knowledgeBaseId, overlayPopups, organizationFolders, layerContext]
  )

  const closeSidebarFolderPopups = useCallback(() => {
    sidebarHoverTimeoutRef.current.forEach(timeout => clearTimeout(timeout))
    sidebarHoverTimeoutRef.current.clear()
    setSidebarFolderPopups([])
    cancelNotePreview()
  }, [cancelNotePreview])

  const handleSidebarPopupHover = useCallback((folderId: string) => {
    const timeout = sidebarHoverTimeoutRef.current.get(folderId)
    if (timeout) {
      clearTimeout(timeout)
      sidebarHoverTimeoutRef.current.delete(folderId)
    }

    const currentPopup = sidebarFolderPopupsRef.current.find(p => p.folderId === folderId)
    if (currentPopup?.parentFolderId) {
      let parentId: string | undefined = currentPopup.parentFolderId
      while (parentId) {
        const parentTimeout = sidebarHoverTimeoutRef.current.get(parentId)
        if (parentTimeout) {
          clearTimeout(parentTimeout)
          sidebarHoverTimeoutRef.current.delete(parentId)
        }
        parentId = sidebarFolderPopupsRef.current.find(p => p.folderId === parentId)?.parentFolderId
      }
    }
  }, [])

  const handleSidebarEyeHoverLeave = useCallback((folderId: string) => {
    const timeout = setTimeout(() => {
      setSidebarFolderPopups(prev =>
        prev.filter(p => p.folderId !== folderId && p.parentFolderId !== folderId)
      )
      sidebarHoverTimeoutRef.current.delete(folderId)
    }, 200)
    const existingTimeout = sidebarHoverTimeoutRef.current.get(folderId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    sidebarHoverTimeoutRef.current.set(folderId, timeout)
  }, [])

  const handleSidebarOrgEyeHover = useCallback(
    async (folder: OrgItem, event: React.MouseEvent<HTMLElement>, parentFolderId?: string) => {
      event.stopPropagation()
      ensureOverlayHydrated('sidebar-hover')

      if (sidebarFolderPopupsRef.current.some(popup => popup.folderId === folder.id)) {
        return
      }

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const spaceRight = window.innerWidth - rect.right
      const popupPosition =
        spaceRight > 320
          ? { x: rect.right + 10, y: Math.max(16, rect.top) }
          : { x: Math.max(16, rect.left), y: Math.min(rect.bottom + 10, window.innerHeight - 320) }

      const popupId = `sidebar-folder-popup-${++sidebarPopupIdCounter.current}`
      const newPopup: SidebarFolderPopup = {
        id: popupId,
        folderId: folder.id,
        folderName: folder.name,
        position: popupPosition,
        children: [],
        isLoading: true,
        parentFolderId,
        folderColor: folder.color,
      }

      setSidebarFolderPopups(prev => [...prev, newPopup])

      try {
        const children = await fetchGlobalChildren(folder.id)
        if (!children) {
          setSidebarFolderPopups(prev =>
            prev.map(p => (p.id === popupId ? { ...p, isLoading: false } : p))
          )
          return
        }

        const formattedChildren: OrgItem[] = children.map((item: any) => ({
          id: item.id,
          name: item.name ?? deriveFromPath(item.path) ?? 'Untitled',
          type: item.type === 'note' ? 'note' : 'folder',
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color || (item.type === 'folder' ? folder.color : undefined),
          path: item.path,
          hasChildren: item.type === 'folder',
          level: (folder.level ?? 0) + 1,
          children: [],
          parentId: item.parentId,
        }))

        setSidebarFolderPopups(prev =>
          prev.map(p =>
            p.id === popupId
              ? {
                  ...p,
                  children: formattedChildren,
                  isLoading: false,
                }
              : p
          )
        )
      } catch (error) {
        console.error('[AnnotationApp] Failed to load sidebar hover children:', error)
        setSidebarFolderPopups(prev =>
          prev.map(p => (p.id === popupId ? { ...p, isLoading: false } : p))
        )
      }
    },
    [ensureOverlayHydrated, fetchGlobalChildren]
  )

  const handleOrganizationSidebarEyeHover = useCallback(
    (item: OrganizationSidebarItem, event: React.MouseEvent<HTMLButtonElement>) => {
      if (item.interactive === false) return
      const folder = sidebarItemToOrgItem(item)
      handleSidebarOrgEyeHover(folder, event)
    },
    [handleSidebarOrgEyeHover]
  )

  const handleOrganizationSidebarEyeLeave = useCallback(
    (id: string) => {
      handleSidebarEyeHoverLeave(id)
    },
    [handleSidebarEyeHoverLeave]
  )

  const handleSidebarNotePreviewHover = useCallback(
    (noteId: string, event: React.MouseEvent<HTMLElement>, sourceFolderId?: string) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const position = {
        x: rect.right + 10,
        y: Math.max(16, rect.top),
      }
      triggerNotePreviewHover(noteId, () => position, { sourceFolderId })
    },
    [triggerNotePreviewHover]
  )

  const handleSidebarNotePreviewLeave = useCallback(() => {
    triggerNotePreviewLeave()
  }, [triggerNotePreviewLeave])

  const handleSidebarPreviewTooltipEnter = useCallback(() => {
    triggerNotePreviewTooltipEnter()
    if (notePreview?.context?.sourceFolderId) {
      handleSidebarPopupHover(notePreview.context.sourceFolderId)
    }
  }, [handleSidebarPopupHover, notePreview, triggerNotePreviewTooltipEnter])

  const handleSidebarPreviewTooltipLeave = useCallback(() => {
    triggerNotePreviewTooltipLeave()
  }, [triggerNotePreviewTooltipLeave])

  const handleOrganizationSidebarNoteHover = useCallback(
    (item: OrganizationSidebarItem, event: React.MouseEvent<HTMLButtonElement>) => {
      handleSidebarNotePreviewHover(item.id, event)
    },
    [handleSidebarNotePreviewHover]
  )

  const handleOrganizationSidebarNoteLeave = useCallback(() => {
    handleSidebarNotePreviewLeave()
  }, [handleSidebarNotePreviewLeave])

  const handleSidebarPopupFolderClick = useCallback(
    (folder: OrgItem, event: React.MouseEvent<HTMLElement>) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      handleOrganizationSidebarSelect(folder.id, rect)
      closeSidebarFolderPopups()
    },
    [handleOrganizationSidebarSelect, closeSidebarFolderPopups]
  )

  const handleSidebarNoteOpen = useCallback(
    (noteId: string) => {
      layerContext?.setActiveLayer('notes')
      handleNoteSelect(noteId, { source: 'popup' })
      closeSidebarFolderPopups()
    },
    [handleNoteSelect, layerContext, closeSidebarFolderPopups]
  )

  const handleWorkspaceSelect = useCallback(
    async (workspaceId: string) => {
      ensureOverlayHydrated('workspace-select')
      if (overlayPersistenceActive) {
        // Force any pending layout changes to flush so the next workspace loads a clean snapshot.
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }

        const snapshot = buildLayoutPayload()
        const hasUnsavedChanges = snapshot.hash !== lastSavedLayoutHashRef.current
        if (hasUnsavedChanges) {
          pendingLayoutRef.current = snapshot
          try {
            await flushLayoutSave()
          } catch (error) {
            console.error('[AnnotationApp] Failed to flush layout before workspace switch:', error)
          }
        }
      }

      setWorkspaceMenuOpen(false)
      setCanvasMode('overlay')
      setCurrentWorkspaceId(prev => (prev === workspaceId ? prev : workspaceId))
    },
    [ensureOverlayHydrated, overlayPersistenceActive, buildLayoutPayload, flushLayoutSave, setCanvasMode]
  )

  const handleCreateWorkspace = useCallback(async () => {
    ensureOverlayHydrated('workspace-create')
    if (!overlayPersistenceActive) return

    const emptyLayout: OverlayLayoutPayload = {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: [],
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
      camera: DEFAULT_CAMERA,
    }

    const defaultName = computeNextWorkspaceName(workspaces)
    let nameHint = defaultName

    if (typeof window !== 'undefined') {
      const proposed = window.prompt('Name this workspace', defaultName)
      if (proposed === null) {
        return
      }
      const trimmed = proposed.trim()
      if (trimmed.length > 0) {
        nameHint = trimmed
      }
    }

    setIsWorkspaceSaving(true)

    try {
      const result = await OverlayLayoutAdapter.createWorkspace({
        layout: emptyLayout,
        version: emptyLayout.schemaVersion,
        nameHint,
      })

      setWorkspaces(prev => {
        const withoutDuplicate = prev.filter(ws => ws.id !== result.workspace.id)
        const updated = [result.workspace, ...withoutDuplicate]
        return updated.sort((a, b) => {
          const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
          const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
          return bTime - aTime
        })
      })

      layoutRevisionRef.current = result.envelope.revision
      lastSavedLayoutHashRef.current = JSON.stringify({
        schemaVersion: result.envelope.layout.schemaVersion,
        popups: result.envelope.layout.popups,
        inspectors: result.envelope.layout.inspectors,
        camera: result.envelope.layout.camera ?? DEFAULT_CAMERA,
      })
      layoutLoadedRef.current = true
      setCanvasMode('overlay')
      setCurrentWorkspaceId(result.workspace.id)
      setWorkspaceMenuOpen(false)
      setOverlayPopups([])
      toast({
        title: 'Workspace created',
        description: `${result.workspace.name} is ready — start arranging panels.`,
      })
    } catch (error) {
      console.error('[AnnotationApp] Failed to create workspace:', error)
      toast({
        variant: 'destructive',
        title: 'Failed to snapshot workspace',
        description: error instanceof Error ? error.message : 'Unexpected error while saving the workspace.',
      })
    } finally {
      setIsWorkspaceSaving(false)
    }
  }, [ensureOverlayHydrated, overlayPersistenceActive, setCanvasMode, workspaces])

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceDeletionId) return

      const targetWorkspace = workspaces.find(ws => ws.id === workspaceId)
      if (!targetWorkspace || targetWorkspace.isDefault) return

      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(
          `Delete "${targetWorkspace.name}"? This will remove its saved overlay layout.`
        )
        if (!confirmed) {
          return
        }
      }

      setWorkspaceDeletionId(workspaceId)

      try {
        await OverlayLayoutAdapter.deleteWorkspace({ workspaceId })

        const updatedWorkspaces = workspaces.filter(ws => ws.id !== workspaceId)
        setWorkspaces(updatedWorkspaces)
        setWorkspaceMenuOpen(false)

        if (currentWorkspaceId === workspaceId) {
          const fallback = updatedWorkspaces[0]?.id ?? null
          setCurrentWorkspaceId(fallback)
          setCanvasMode('overlay')
          if (!fallback) {
            overlayAdapterRef.current = null
            layoutRevisionRef.current = null
            lastSavedLayoutHashRef.current = null
            layoutLoadedRef.current = true
            setOverlayPopups([])
          }
        }

        toast({
          title: 'Workspace deleted',
          description: `${targetWorkspace.name} has been removed.`,
        })
      } catch (error) {
        console.error('[AnnotationApp] Failed to delete workspace:', error)
        toast({
          variant: 'destructive',
          title: 'Failed to delete workspace',
          description:
            error instanceof Error ? error.message : 'Unexpected error while deleting the workspace.',
        })
      } finally {
        setWorkspaceDeletionId(null)
      }
    },
    [
      workspaceDeletionId,
      workspaces,
      currentWorkspaceId,
      setCanvasMode,
      setOverlayPopups,
    ]
  )

  const handleCreateOverlayPopup = useCallback((popup: OverlayPopup, shouldHighlight: boolean = false) => {
    ensureOverlayHydrated('floating-toolbar')
    console.log('[handleCreateOverlayPopup] Adding popup:', popup.folderName, 'folderId:', popup.folderId, 'shouldHighlight:', shouldHighlight);
    setOverlayPopups(prev => {
      console.log('[handleCreateOverlayPopup] Current popups:', prev.length, prev.map(p => p.folderName));

      // Check if popup with same ID already exists
      const existingIndex = prev.findIndex(p => p.id === popup.id)
      if (existingIndex >= 0) {
        console.log('[handleCreateOverlayPopup] Popup already exists at index', existingIndex);

        // If shouldHighlight is true, just highlight - don't replace data or position
        if (shouldHighlight) {
          console.log('[handleCreateOverlayPopup] Just highlighting existing popup IN PLACE, not moving');
          console.log('[handleCreateOverlayPopup] Setting isHighlighted to TRUE for popup:', prev[existingIndex].folderName);
          const updated = [...prev]
          // Only update isHighlighted flag, keep existing position and data
          updated[existingIndex] = { ...updated[existingIndex], isHighlighted: true }
          console.log('[handleCreateOverlayPopup] Updated popup isHighlighted:', updated[existingIndex].isHighlighted);
          return updated
        }

        // Otherwise update popup data (e.g., when children are loaded)
        // Preserve position when just updating children
        console.log('[handleCreateOverlayPopup] Updating existing popup data, preserving position');
        const updated = [...prev]
        const incomingSizeMode = popup.sizeMode ?? (popup.isLoading ? (updated[existingIndex].sizeMode ?? 'default') : 'default')
        const nextSizeMode = updated[existingIndex].sizeMode === 'user' ? 'user' : incomingSizeMode
        const shouldReleaseHeight = nextSizeMode === 'default' && updated[existingIndex].sizeMode !== 'user'
        const resolvedHeight = shouldReleaseHeight
          ? undefined
          : (popup.height ?? updated[existingIndex].height)
        const resolvedWidth = popup.width ?? updated[existingIndex].width

        updated[existingIndex] = {
          ...updated[existingIndex],
          ...popup,
          // Preserve existing position - don't move popup when updating children
          position: updated[existingIndex].position,
          canvasPosition: updated[existingIndex].canvasPosition,
          isHighlighted: updated[existingIndex].isHighlighted,
          width: resolvedWidth,
          height: resolvedHeight,
          sizeMode: nextSizeMode
        }
        return updated
      }

      // Check if popup with same folder already exists (shouldn't happen with deterministic IDs, but keep as safety)
      const folderExists = prev.some(p => p.folderId === popup.folderId)
      if (folderExists) {
        console.log('[handleCreateOverlayPopup] Popup for this folder already exists (different ID), highlighting it');
        return prev.map(p =>
          p.folderId === popup.folderId
            ? { ...p, isHighlighted: true }
            : p
        )
      }

      // Add new popup
      console.log('[handleCreateOverlayPopup] Adding new popup. New count will be:', prev.length + 1);
      return [...prev, popup]
    })

    // If highlighting, clear the highlight after animation (2 seconds)
    if (shouldHighlight) {
      setTimeout(() => {
        setOverlayPopups(prev =>
          prev.map(p =>
            p.id === popup.id ? { ...p, isHighlighted: false } : p
          )
        )
      }, 2000)
    }
  }, [ensureOverlayHydrated])

  // Helper: Get all descendants of a popup (recursive)
  const getAllDescendants = useCallback((popupId: string): string[] => {
    const descendants: string[] = []
    const findChildren = (parentId: string) => {
      overlayPopups.forEach(p => {
        if (p.parentPopupId === parentId) {
          descendants.push(p.id)
          findChildren(p.id) // Recurse
        }
      })
    }
    findChildren(popupId)
    return descendants
  }, [overlayPopups])

  const applyMoveCascadeState = useCallback((parentId: string | null, childIds: string[]) => {
    const childSet = new Set(childIds)
    setOverlayPopups(prev =>
      prev.map(p => {
        if (parentId && p.id === parentId) {
          return p.moveMode === 'parent' ? p : { ...p, moveMode: 'parent' }
        }
        if (childSet.has(p.id)) {
          return p.moveMode === 'child' ? p : { ...p, moveMode: 'child' }
        }
        if (!parentId && childSet.size === 0 && !p.moveMode) {
          return p
        }
        if (p.moveMode) {
          return { ...p, moveMode: undefined }
        }
        return p
      })
    )
  }, [])

  const clearMoveCascadeState = useCallback(() => {
    setMoveCascadeState({ parentId: null, childIds: [] })
    applyMoveCascadeState(null, [])
  }, [applyMoveCascadeState])

  useEffect(() => {
    if (!moveCascadeState.parentId) return
    const exists = overlayPopups.some(p => p.id === moveCascadeState.parentId)
    if (!exists) {
      clearMoveCascadeState()
    }
  }, [overlayPopups, moveCascadeState.parentId, clearMoveCascadeState])

  const handleToggleMoveCascade = useCallback((popupId: string) => {
    setMoveCascadeState(prev => {
      if (prev.parentId === popupId) {
        applyMoveCascadeState(null, [])
        return { parentId: null, childIds: [] }
      }
      const descendants = getAllDescendants(popupId)
      applyMoveCascadeState(popupId, descendants)
      return { parentId: popupId, childIds: descendants }
    })
  }, [applyMoveCascadeState, getAllDescendants])

  // Handle closing overlay popup with cascade (closes all children recursively)
  // Used for immediate close without interactive mode
  const handleCloseOverlayPopup = useCallback((popupId: string) => {
    // Build set of all popups to close (parent + all descendants)
    const toClose = new Set<string>([popupId])

    // Recursively find all children of a given popup
    const findChildren = (parentId: string) => {
      overlayPopups.forEach(p => {
        if (p.parentPopupId === parentId && !toClose.has(p.id)) {
          toClose.add(p.id)
          findChildren(p.id) // Recurse for grandchildren, great-grandchildren, etc.
        }
      })
    }

    findChildren(popupId)

    console.log(`[Cascade Close] Closing popup ${popupId} and ${toClose.size - 1} descendants`)

    if (
      (moveCascadeState.parentId && toClose.has(moveCascadeState.parentId)) ||
      moveCascadeState.childIds.some(id => toClose.has(id))
    ) {
      clearMoveCascadeState()
    }

    // Clean up timeouts for all popups being closed
    toClose.forEach(id => {
      const popup = overlayPopups.find(p => p.id === id)
      if (!popup) return

      const timeoutKey = popup.parentPopupId ? `${popup.parentPopupId}-${popup.folderId}` : popup.folderId

      // Clear hover timeout
      const hoverTimeout = hoverTimeoutRef.current.get(timeoutKey)
      if (hoverTimeout) {
        clearTimeout(hoverTimeout)
        hoverTimeoutRef.current.delete(timeoutKey)
      }

      // Clear close timeout
      const closeTimeout = closeTimeoutRef.current.get(timeoutKey)
      if (closeTimeout) {
        clearTimeout(closeTimeout)
        closeTimeoutRef.current.delete(timeoutKey)
      }
    })

    // Remove all popups in the cascade
    setOverlayPopups(prev => prev.filter(p => !toClose.has(p.id)))
    // Save will be triggered automatically by the save effect with immediate save
  }, [overlayPopups, getAllDescendants, moveCascadeState, clearMoveCascadeState])

  // Handle toggle pin (prevent cascade-close)
  // Cascades pin state to all descendants automatically
  const handleTogglePin = useCallback((popupId: string) => {
    setOverlayPopups(prev => {
      // Find the popup being toggled
      const targetPopup = prev.find(p => p.id === popupId)
      if (!targetPopup) return prev

      // Determine new pin state (toggle)
      const newPinState = !targetPopup.isPinned

      // Get all descendants of this popup
      const descendants = getAllDescendants(popupId)

      console.log(`[Toggle Pin] Setting pin=${newPinState} for popup ${targetPopup.folderName} and ${descendants.length} descendants`)

      // Update target popup and all its descendants with the new pin state
      return prev.map(p => {
        if (p.id === popupId) {
          return { ...p, isPinned: newPinState }
        }
        if (descendants.includes(p.id)) {
          return { ...p, isPinned: newPinState }
        }
        return p
      })
    })
  }, [getAllDescendants])

  // Handle initiate close (enter interactive close mode)
  const handleInitiateClose = useCallback((popupId: string) => {
    const descendants = getAllDescendants(popupId)

    // If no descendants, close immediately (no need for interactive mode)
    if (descendants.length === 0) {
      handleCloseOverlayPopup(popupId)
      return
    }

    // Enter close mode: highlight descendants and show pin buttons
    setOverlayPopups(prev =>
      prev.map(p => {
        if (p.id === popupId) {
          return { ...p, closeMode: 'closing' as const }
        }
        if (descendants.includes(p.id)) {
          return { ...p, isHighlighted: true }
        }
        return p
      })
    )
  }, [getAllDescendants, handleCloseOverlayPopup])

  // Handle confirm close (user clicked Done - close parent and unpinned children)
  const handleConfirmClose = useCallback((parentId: string) => {
    const descendants = getAllDescendants(parentId)
    const toClose = new Set<string>([parentId])

    // Add unpinned descendants to close list
    descendants.forEach(descId => {
      const popup = overlayPopups.find(p => p.id === descId)
      if (popup && !popup.isPinned) {
        toClose.add(descId)
      }
    })

    console.log(`[Confirm Close] Closing parent and ${toClose.size - 1} unpinned descendants`)

    if (
      (moveCascadeState.parentId && toClose.has(moveCascadeState.parentId)) ||
      moveCascadeState.childIds.some(id => toClose.has(id))
    ) {
      clearMoveCascadeState()
    }

    // Clean up timeouts for all closing popups
    toClose.forEach(id => {
      const popup = overlayPopups.find(p => p.id === id)
      if (!popup) return

      const timeoutKey = popup.parentPopupId ? `${popup.parentPopupId}-${popup.folderId}` : popup.folderId
      const hoverTimeout = hoverTimeoutRef.current.get(timeoutKey)
      if (hoverTimeout) {
        clearTimeout(hoverTimeout)
        hoverTimeoutRef.current.delete(timeoutKey)
      }
      const closeTimeout = closeTimeoutRef.current.get(timeoutKey)
      if (closeTimeout) {
        clearTimeout(closeTimeout)
        closeTimeoutRef.current.delete(timeoutKey)
      }
    })

    // Remove closing popups and clear highlights/close mode from survivors
    setOverlayPopups(prev =>
      prev
        .filter(p => !toClose.has(p.id))
        .map(p => ({
          ...p,
          isHighlighted: false,
          closeMode: undefined
        }))
    )
  }, [getAllDescendants, overlayPopups, moveCascadeState, clearMoveCascadeState])

  // Handle cancel close (user cancelled - revert to normal mode)
  const handleCancelClose = useCallback((parentId: string) => {
    const descendants = getAllDescendants(parentId)

    setOverlayPopups(prev =>
      prev.map(p => {
        if (p.id === parentId) {
          return { ...p, closeMode: undefined }
        }
        if (descendants.includes(p.id)) {
          return { ...p, isHighlighted: false }
        }
        return p
      })
    )
  }, [getAllDescendants])

  // Handle folder hover inside popup (creates cascading child popups)
  const handleFolderHover = useCallback(async (folder: OrgItem, event: React.MouseEvent, parentPopupId: string, isPersistent: boolean = false) => {
    console.log('[handleFolderHover]', { folderName: folder.name, folderId: folder.id, parentPopupId, isPersistent })

    // Check if popup already exists for this folder
    const existingPopup = overlayPopups.find(p => p.folderId === folder.id)

    if (existingPopup) {
      console.log('[handleFolderHover] ✅ EXISTING POPUP FOUND:', existingPopup.folderName, 'existing.isPersistent:', existingPopup.isPersistent, 'click.isPersistent:', isPersistent)

      if (isPersistent) {
        const alreadyPersistent = existingPopup.isPersistent

        console.log(alreadyPersistent
          ? '[handleFolderHover] 🌟 Already persistent - HIGHLIGHTING'
          : '[handleFolderHover] ⬆️ Upgrading hover preview to persistent (no highlight)')

        setOverlayPopups(prev =>
          prev.map(p =>
            p.folderId === folder.id
              ? {
                  ...p,
                  isPersistent: true,
                  isHighlighted: alreadyPersistent, // only flash if this popup had been pinned before
                }
              : p
          )
        )

        if (alreadyPersistent) {
          setTimeout(() => {
            setOverlayPopups(prev =>
              prev.map(p =>
                p.folderId === folder.id ? { ...p, isHighlighted: false } : p
              )
            )
          }, 2000)
        }
      }
      return
    }

    console.log('[handleFolderHover] ❌ NO EXISTING POPUP - creating new one with isHighlighted=false')

    // Capture rect position IMMEDIATELY (before any async/timeout)
    const rect = event.currentTarget.getBoundingClientRect()

    // For non-persistent (hover) popups, use a timeout
    const timeoutKey = parentPopupId ? `${parentPopupId}-${folder.id}` : folder.id

    if (!isPersistent) {
      // Clear any existing timeout for this folder
      if (hoverTimeoutRef.current.has(timeoutKey)) {
        clearTimeout(hoverTimeoutRef.current.get(timeoutKey)!)
        hoverTimeoutRef.current.delete(timeoutKey)
      }

      // Set timeout to show hover tooltip after 300ms
      const timeout = setTimeout(() => {
        hoverTimeoutRef.current.delete(timeoutKey)
        // Create temporary hover popup (pass captured rect)
        createPopup(folder, rect, parentPopupId, false)
      }, 300)

      hoverTimeoutRef.current.set(timeoutKey, timeout)
      return
    }

    // For persistent (click) popups, create immediately
    createPopup(folder, rect, parentPopupId, true)

    async function createPopup(folder: OrgItem, rect: DOMRect, parentPopupId: string, isPersistent: boolean) {
      // Check again if popup exists (might have been created during timeout)
      const currentOverlayPopups = overlayPopups
      const exists = currentOverlayPopups.some(p => p.folderId === folder.id)
      if (exists) return
      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

      // Inherit color from parent popup (already open) - FAST, no API call needed!
      let inheritedColor = folder.color
      if (!inheritedColor && parentPopupId) {
        const parentPopup = currentOverlayPopups.find(p => p.id === parentPopupId)

        // If parent popup has color in folder object, use it
        if (parentPopup?.folder?.color) {
          inheritedColor = parentPopup.folder.color
          console.log('[createPopup] ⚡ Inherited color from parent popup folder:', parentPopup.folderName, 'color:', inheritedColor)
        }
        // If parent is still loading but we have folder data with color, use that
        else if (parentPopup?.isLoading && folder.color) {
          inheritedColor = folder.color
          console.log('[createPopup] ⚡ Using folder own color (parent still loading):', inheritedColor)
        }
        // Last resort: walk up ancestor chain via API
          else if (!parentPopup?.isLoading) {
            console.log('[createPopup] Parent popup has no color and not loading, checking ancestors via API')
            const initialParentId = folder.parentId ?? (folder as any).parent_id
            if (initialParentId) {
              try {
                let currentParentId = initialParentId
                let depth = 0
                const maxDepth = 10

                while (currentParentId && !inheritedColor && depth < maxDepth) {
                  const parentResponse = await fetch(`/api/items/${currentParentId}`)
                  if (!parentResponse.ok) break

                  const parentData = await parentResponse.json()
                  const parent = parentData.item || parentData

                if (parent.color) {
                  inheritedColor = parent.color
                  console.log('[createPopup] Inherited color from ancestor via API:', parent.name, 'color:', inheritedColor, 'depth:', depth + 1)
                  break
                }

                currentParentId = parent.parentId ?? parent.parent_id
                depth++
              }
            } catch (e) {
              console.warn('[createPopup] Failed to fetch ancestor color:', e)
            }
          }
        }
      }

      // Position child popup to the right of parent
      const spaceRight = window.innerWidth - rect.right
      let popupPosition = { x: rect.right + 10, y: rect.top }

      if (spaceRight < 320) {
        popupPosition = { x: rect.left - 320, y: rect.top }
      }

      const cachedEntry = folderCacheRef.current.get(folder.id)
      const normalizeChild = (item: any): OrgItem => {
        if (item && typeof item === 'object' && 'hasChildren' in item) {
          return { ...(item as OrgItem) }
        }
        return {
          id: item.id,
          name: item.name ?? deriveFromPath(item.path) ?? 'Untitled',
          type: item.type === 'note' ? 'note' : 'folder',
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          path: item.path,
          hasChildren: item.type === 'folder',
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
      const canvasPosition = CoordinateBridge.screenToCanvas(popupPosition, sharedTransform)
      const screenPosition = CoordinateBridge.canvasToScreen(canvasPosition, sharedTransform)

      const newPopup: OverlayPopup = {
        id: popupId,
        folderId: folder.id,
        folderName: folder.name,
        folder: {
          id: folder.id,
          name: folder.name,
          type: 'folder' as const,
          level: (currentOverlayPopups.find(p => p.id === parentPopupId)?.level || 0) + 1,
          color: inheritedColor,
          path: (folder as any).path,
          children: initialChildren ?? []
        },
        position: screenPosition,
        canvasPosition: canvasPosition,
        width: DEFAULT_POPUP_WIDTH,
        sizeMode: 'default',
        children: initialChildren ?? [],
        isLoading: !initialChildren,
        isPersistent: isPersistent,
        isHighlighted: false, // Never glow on first creation
        level: (currentOverlayPopups.find(p => p.id === parentPopupId)?.level || 0) + 1,
        parentId: parentPopupId || null,
        parentPopupId: parentPopupId || undefined
      }

      console.log('[createPopup] 📦 Creating NEW popup:', folder.name, 'color:', inheritedColor, 'isHighlighted:', newPopup.isHighlighted)
      setOverlayPopups(prev => [...prev, newPopup])

      // Fetch children
      try {
        const children = await fetchGlobalChildren(folder.id)
        if (!children) throw new Error('Failed to fetch folder contents')

        const formattedChildren: OrgItem[] = children.map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          path: item.path,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          hasChildren: item.type === 'folder',
          level: folder.level + 1,
          children: [],
          parentId: item.parentId
        }))

        setOverlayPopups(prev =>
          prev.map(p => {
            if (p.id !== popupId) return p
            return {
              ...p,
              children: formattedChildren,
              isLoading: false,
              folder: p.folder
                ? {
                    ...p.folder,
                    children: formattedChildren,
                  }
                : null,
            }
          })
        )
        folderCacheRef.current.set(folder.id, {
          ...(folderCacheRef.current.get(folder.id) ?? {}),
          folder,
          children,
        })
      } catch (error) {
        console.error('Error fetching child popup contents:', error)
        setOverlayPopups(prev => prev.filter(p => p.id !== popupId))
      }
    }
  }, [overlayPopups, layerContext, fetchGlobalChildren])

  // Cancel close timeout when hovering the popup itself (keeps it alive)
  const handlePopupHover = useCallback((folderId: string, parentPopupId?: string) => {
    console.log('[handlePopupHover] CALLED', { folderId, parentPopupId, hasTimeouts: closeTimeoutRef.current.size })

    // Try multiple possible timeout keys since we might not know the exact parent
    const possibleKeys = [
      folderId, // Simple key (no parent)
      parentPopupId ? `${parentPopupId}-${folderId}` : null, // With known parent
    ].filter(Boolean) as string[]

    // Also try all keys that end with this folderId
    closeTimeoutRef.current.forEach((timeout, key) => {
      if (key.endsWith(folderId) && !possibleKeys.includes(key)) {
        possibleKeys.push(key)
      }
    })

    console.log('[handlePopupHover] Trying timeout keys:', possibleKeys)
    console.log('[handlePopupHover] Available timeouts:', Array.from(closeTimeoutRef.current.keys()))

    let found = false
    for (const key of possibleKeys) {
      const timeout = closeTimeoutRef.current.get(key)
      if (timeout) {
        clearTimeout(timeout)
        closeTimeoutRef.current.delete(key)
        console.log('[handlePopupHover] ✅ Cancelled close timeout for', key)
        found = true
        break
      }
    }

    if (!found) {
      console.log('[handlePopupHover] ❌ No matching timeout found')
    }
  }, [])

  // Handle folder hover leave (for temporary tooltips)
  const handleFolderHoverLeave = useCallback((folderId?: string, parentPopupId?: string) => {
    console.log('[handleFolderHoverLeave]', { folderId, parentPopupId })

    if (!folderId) return

    // Clear hover timeout if user leaves before tooltip appears
    const timeoutKey = parentPopupId ? `${parentPopupId}-${folderId}` : folderId
    if (hoverTimeoutRef.current.has(timeoutKey)) {
      clearTimeout(hoverTimeoutRef.current.get(timeoutKey)!)
      hoverTimeoutRef.current.delete(timeoutKey)
    }

    // Set close timeout and STORE IT so it can be cancelled when hovering the popup
    const closeTimeout = setTimeout(() => {
      closeTimeoutRef.current.delete(timeoutKey)
      // Close temporary (non-persistent) hover popups for this folder
      setOverlayPopups(prev =>
        prev.filter(p => {
          // Keep popup if it's persistent (clicked) or if it's for a different folder
          if (p.isPersistent) return true
          if (p.folderId !== folderId) return true
          // Remove non-persistent hover popup for this folder
          return false
        })
      )
    }, 300) // 300ms delay to allow moving to tooltip (same as organization panel)

    closeTimeoutRef.current.set(timeoutKey, closeTimeout)
  }, [])

  const handlePopupPositionChange = useCallback(
    (
      popupId: string,
      positions: {
        screenPosition?: { x: number; y: number }
        canvasPosition?: { x: number; y: number }
        size?: { width: number; height: number }
      }
    ) => {
      setOverlayPopups(prev =>
        prev.map(popup => {
          if (popup.id !== popupId) return popup

          let next = popup
          const ensureClone = () => {
            if (next === popup) {
              next = { ...popup }
            }
          }

          const { screenPosition, canvasPosition, size } = positions

          if (screenPosition) {
            const prevScreen = popup.position
            if (
              !prevScreen ||
              Math.abs(prevScreen.x - screenPosition.x) > 0.5 ||
              Math.abs(prevScreen.y - screenPosition.y) > 0.5
            ) {
              ensureClone()
              next.position = screenPosition
            }
          }

          if (canvasPosition) {
            const prevCanvas = popup.canvasPosition
            if (
              !prevCanvas ||
              Math.abs(prevCanvas.x - canvasPosition.x) > 0.1 ||
              Math.abs(prevCanvas.y - canvasPosition.y) > 0.1
            ) {
              ensureClone()
              next.canvasPosition = canvasPosition
            }
          }

          if (size) {
            const width = size.width
            const height = size.height
            const prevWidth = popup.width ?? DEFAULT_POPUP_WIDTH
            const prevHeight = popup.height ?? DEFAULT_POPUP_HEIGHT
            const widthChanged = Math.abs(prevWidth - width) > 0.5
            const heightChanged = Math.abs(prevHeight - height) > 0.5

            if (widthChanged || heightChanged) {
              ensureClone()
              if (widthChanged) next.width = width
              if (heightChanged) next.height = height
            }
          }

          return next
        })
      )
    },
    []
  )

  const handleResizePopup = useCallback(
    (
      popupId: string,
      size: { width: number; height: number },
      options?: { source?: 'auto' | 'user' }
    ) => {
      const source = options?.source ?? 'user'
      const clampedWidth = clamp(size.width, MIN_POPUP_WIDTH, MAX_POPUP_WIDTH)
      const clampedHeight = clamp(size.height, MIN_POPUP_HEIGHT, MAX_POPUP_HEIGHT)

      setOverlayPopups(prev =>
        prev.map(popup => {
          if (popup.id !== popupId) return popup

          if (source === 'auto' && popup.sizeMode === 'user') {
            return popup
          }

          const prevWidth = popup.width ?? DEFAULT_POPUP_WIDTH
          const prevHeight = popup.height ?? DEFAULT_POPUP_HEIGHT

          if (
            Math.abs(prevWidth - clampedWidth) <= 0.5 &&
            Math.abs(prevHeight - clampedHeight) <= 0.5
          ) {
            if (source === 'auto' && popup.sizeMode !== 'auto') {
              return {
                ...popup,
                sizeMode: 'auto'
              }
            }
            return popup
          }

          return {
            ...popup,
            width: clampedWidth,
            height: clampedHeight,
            sizeMode: source === 'user' ? 'user' : 'auto'
          }
        })
      )
    },
    []
  )

  // Handle delete selected items from popup
  const handleDeleteSelected = useCallback(async (popupId: string, selectedIds: Set<string>) => {
    console.log('[handleDeleteSelected]', { popupId, selectedIds: Array.from(selectedIds) })

    try {
      // Delete each selected item via API and track which ones succeed
      const deleteResults = await Promise.all(
        Array.from(selectedIds).map(async (itemId) => {
          try {
            const response = await fetchWithWorkspace(`/api/items/${itemId}`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json'
              }
            })

            if (!response.ok && response.status !== 404) {
              // 404 is ok (already deleted), but other errors should be logged
              console.error(`Failed to delete item ${itemId}:`, response.status)
              return { itemId, success: false }
            }

            console.log(`Successfully deleted item ${itemId}`)
            return { itemId, success: true }
          } catch (error) {
            console.error(`Error deleting item ${itemId}:`, error)
            return { itemId, success: false }
          }
        })
      )

      // Get IDs of items that were actually deleted successfully
      const successfullyDeletedIds = new Set(
        deleteResults.filter(r => r.success).map(r => r.itemId)
      )
      const successCount = successfullyDeletedIds.size

      console.log(`Deleted ${successCount}/${selectedIds.size} items`)

      // Only remove items that were successfully deleted
      if (successCount > 0) {
        console.log('[handleDeleteSelected] Updating popup to remove successfully deleted items...')

        setOverlayPopups(prev =>
          prev.map(p => {
            if (p.id === popupId && p.folder && p.children) {
              // Filter out ONLY successfully deleted items (safety: failed deletes remain visible)
              const updatedChildren = p.children.filter(child => !successfullyDeletedIds.has(child.id))
              const nextSizeMode = p.sizeMode === 'user' ? 'user' : 'default'

              return {
                ...p,
                children: updatedChildren,
                folder: {
                  ...p.folder,
                  children: updatedChildren
                },
                sizeMode: nextSizeMode,
                height: nextSizeMode === 'default' ? undefined : p.height
              }
            }
            return p
          })
        )

        console.log('[handleDeleteSelected] Popup updated - removed', successCount, 'successfully deleted items')
      }

      // Warn user if some deletes failed
      const failedCount = selectedIds.size - successCount
      if (failedCount > 0) {
        console.warn(`[handleDeleteSelected] ${failedCount} item(s) failed to delete - they remain visible`)
        // Could show user notification here
      }
    } catch (error) {
      console.error('[handleDeleteSelected] Error:', error)
    }
  }, [overlayPopups])

  // Handle bulk move of items to target folder (drag-drop)
  const handleFolderCreated = useCallback((popupId: string, newFolder: any) => {
    console.log('[handleFolderCreated]', { popupId, newFolder })

    let updatedParentFolderId: string | null = null
    let updatedChildrenSnapshot: OrgItem[] | null = null

    // Update the popup's children to include the new folder
    setOverlayPopups(prev =>
      prev.map(popup => {
        if (popup.id === popupId && popup.folder) {
          // Add new folder to the beginning of children array (folders typically shown first)
          const updatedChildren: OrgItem[] = [newFolder, ...popup.children]
          const nextSizeMode = popup.sizeMode === 'user' ? 'user' : 'default'

          updatedParentFolderId = popup.folderId
          updatedChildrenSnapshot = updatedChildren

          return {
            ...popup,
            children: updatedChildren,
            folder: { ...popup.folder, children: updatedChildren },
            sizeMode: nextSizeMode,
            height: nextSizeMode === 'default' ? undefined : popup.height
          }
        }
        return popup
      })
    )

    if (updatedParentFolderId && updatedChildrenSnapshot) {
      const existingCache = folderCacheRef.current.get(updatedParentFolderId) ?? {}
      folderCacheRef.current.set(updatedParentFolderId, {
        ...existingCache,
        children: updatedChildrenSnapshot,
      })
    }

    console.log('[handleFolderCreated] Popup updated with new folder')
  }, [])

  const handleBulkMove = useCallback(async (
    itemIds: string[],
    targetFolderId: string,
    sourcePopupId: string
  ) => {
    console.log('[handleBulkMove] Moving items:', { itemIds, targetFolderId, sourcePopupId })

    try {
      // Call bulk-move API
      const response = await fetchWithWorkspace('/api/items/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds,
          targetFolderId,
          ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to move items')
      }

      const data = await response.json()

      // CRITICAL: Track which items actually moved (same pattern as delete)
      const successfullyMovedIds = new Set(
        (data.movedItems || []).map((item: any) => item.id)
      )
      const movedCount = successfullyMovedIds.size

      console.log(`[handleBulkMove] Successfully moved ${movedCount}/${itemIds.length} items`)

      // Only update UI for items that actually moved
      if (movedCount > 0) {
        setOverlayPopups(prev =>
          prev.map(popup => {
            // Update source popup: remove successfully moved items
            if (popup.id === sourcePopupId && popup.folder && popup.children) {
              const updatedChildren = popup.children.filter(
                child => !successfullyMovedIds.has(child.id)
              )
              const nextSizeMode = popup.sizeMode === 'user' ? 'user' : 'default'
              return {
                ...popup,
                children: updatedChildren,
                folder: { ...popup.folder, children: updatedChildren },
                sizeMode: nextSizeMode,
                height: nextSizeMode === 'default' ? undefined : popup.height
              }
            }

            // Update target popup: add successfully moved items (prevent duplicates)
            if (popup.folderId === targetFolderId && popup.folder) {
              const movedItems = data.movedItems || []

              // Get IDs of existing children to prevent duplicates
              const existingIds = new Set(popup.children.map(child => child.id))

              // Filter out items that already exist in this popup
              const newItems = movedItems.filter((item: any) => !existingIds.has(item.id))

              // Append only new items
              const updatedChildren = [...popup.children, ...newItems]
              const nextSizeMode = popup.sizeMode === 'user' ? 'user' : 'default'

              return {
                ...popup,
                children: updatedChildren,
                folder: { ...popup.folder, children: updatedChildren },
                sizeMode: nextSizeMode,
                height: nextSizeMode === 'default' ? undefined : popup.height
              }
            }

            return popup
          })
        )

        console.log('[handleBulkMove] Source popup updated - removed', movedCount, 'moved items')
        console.log('[handleBulkMove] Target popup auto-refresh applied if popup is open')
      }

      // Warn if some moves failed
      const failedCount = itemIds.length - movedCount
      if (failedCount > 0) {
        console.warn(`[handleBulkMove] ${failedCount} item(s) failed to move`)
        // Optional: Show user notification
      }

    } catch (error) {
      console.error('[handleBulkMove] Error:', error)
      alert(`Failed to move items: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [])

  // Handle popup drag start
  const handlePopupDragStart = useCallback((popupId: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const popup = overlayPopups.find(p => p.id === popupId)
    if (!popup) return

    // Get the shared transform for coordinate conversion
    const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

    // Calculate offset between mouse position and popup position
    const screenPosition = CoordinateBridge.canvasToScreen(popup.canvasPosition, sharedTransform)
    const offset = {
      x: event.clientX - screenPosition.x,
      y: event.clientY - screenPosition.y
    }

    dragOffsetRef.current = offset
    setDraggingPopup(popupId)
    draggingPopupRef.current = popupId
    dragScreenPosRef.current = { x: screenPosition.x, y: screenPosition.y }

    // Mark popup as dragging
    setOverlayPopups(prev =>
      prev.map(p => p.id === popupId ? { ...p, isDragging: true } : p)
    )

    // Prevent text selection
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [overlayPopups, layerContext])

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

  // Handler for creating new note from workspace toolbar
  // Reuses the same logic as floating toolbar's "+ Note" button
  const handleNewNoteFromToolbar = useCallback(async () => {
    if (isCreatingNoteFromToolbar) return // Prevent double-clicks

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
  }, [isCreatingNoteFromToolbar, handleNoteSelect, currentWorkspaceId])

  // Handler for opening settings from workspace toolbar
  const handleSettingsFromToolbar = useCallback(() => {
    // TODO: Implement settings panel
    console.log('[AnnotationApp] Settings clicked')
  }, [])

  return (
    <ConstellationProvider>
      <div className="relative h-screen w-screen overflow-hidden bg-neutral-950/80">
        <div className="flex h-full w-full">
          {shouldShowSidebar && (
            <div
              data-sidebar="sidebar"
              className="h-full"
              style={{ position: showConstellationPanel ? 'absolute' : 'relative', zIndex: 50 }}
            >
              <CanvasSidebar
                activeTab={activeSidebarTab}
                onTabChange={handleSidebarTabChange}
                showWorkspaceTab={false}
                constellationContent={<ConstellationSidebarShared />}
                organizationContent={
                  <OrganizationSidebarContent
                    items={organizationSidebarData.items}
                    stats={organizationSidebarData.stats}
                    onSelect={(id, rect) => handleOrganizationSidebarSelect(id, rect)}
                    onEyeHover={handleOrganizationSidebarEyeHover}
                    onEyeLeave={handleOrganizationSidebarEyeLeave}
                    onNoteHover={handleOrganizationSidebarNoteHover}
                    onNoteLeave={handleOrganizationSidebarNoteLeave}
                  />
                }
              />
            </div>
          )}

          <div className="flex-1 flex flex-col overflow-hidden">
            {!showConstellationPanel && !isPopupLayerActive && (
            <AutoHideToolbar edgeThreshold={50} hideDelay={800}>
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 overflow-visible">
                <WorkspaceToolbar
                  notes={sortedOpenNotes}
                  activeNoteId={activeNoteId}
                  isLoading={isWorkspaceLoading || isCreatingNoteFromToolbar}
                  formatNoteLabel={formatNoteLabel}
                  onActivateNote={handleNoteSelect}
                  onCenterNote={handleCenterNote}
                  onCloseNote={handleCloseNote}
                  onNewNote={handleNewNoteFromToolbar}
                  onSettings={handleSettingsFromToolbar}
                />
              </div>
            </AutoHideToolbar>
          )}

          <div className="relative flex-1" onContextMenu={handleContextMenu}>
            {shouldShowWorkspaceToggle && (
              <div
                className="absolute inset-x-0 top-4 flex justify-center"
                style={{ zIndex: Z_INDEX.DROPDOWN + 10, pointerEvents: 'none' }}
              >
                <div
                  ref={workspaceToggleRef}
                  className="flex flex-col items-center gap-2 pointer-events-auto"
                >
                  <div className="flex items-center gap-2 rounded-full bg-slate-950/85 px-2 py-1.5 shadow-lg ring-1 ring-white/15 backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => setWorkspaceMenuOpen(prev => !prev)}
                      aria-expanded={workspaceMenuOpen}
                      aria-label="Choose workspace"
                      className="flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <span className="text-[11px] uppercase tracking-wide text-white/60">
                        Workspace
                      </span>
                      <span>{workspaceStatusLabel}</span>
                      <svg
                        aria-hidden="true"
                        className={`h-3 w-3 transition-transform ${
                          workspaceMenuOpen ? 'rotate-180' : ''
                        }`}
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M3 4.5L6 7.5L9 4.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateWorkspace}
                      disabled={isWorkspaceSaving || isWorkspaceLayoutLoading}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/90 text-slate-950 transition-transform hover:translate-y-[-1px] disabled:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
                      aria-label="Snapshot current workspace"
                    >
                      <span className="text-lg font-semibold leading-none">+</span>
                    </button>
                  </div>

                  {workspaceMenuOpen && (
                    <div className="mt-2 w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
                      {isWorkspaceListLoading ? (
                        <div className="py-6 text-center text-sm text-white/60">
                          Loading workspaces...
                        </div>
                      ) : workspaces.length === 0 ? (
                        <div className="py-6 text-center text-sm text-white/60 px-4">
                          No saved workspaces yet. Use the + button to snapshot this layout.
                        </div>
                      ) : (
                        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                          {workspaces.map(workspace => {
                            const isActive = workspace.id === currentWorkspaceId
                            const isDeleting = workspaceDeletionId === workspace.id
                            const disableDelete = workspace.isDefault || isDeleting
                            const updatedDate = workspace.updatedAt ? new Date(workspace.updatedAt) : null
                            const lastUpdated =
                              updatedDate && !Number.isNaN(updatedDate.getTime())
                                ? updatedDate.toLocaleString()
                                : 'Never saved'
                            return (
                              <li key={workspace.id} className="group relative">
                                <button
                                  type="button"
                                  onClick={() => handleWorkspaceSelect(workspace.id)}
                                  className={[
                                    'w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                                    isActive
                                      ? 'border-blue-400/60 bg-blue-500/20 text-white shadow-lg'
                                      : 'border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10',
                                  ].join(' ')}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">{workspace.name}</span>
                                    <span className="text-xs text-white/60">
                                      {workspace.popupCount} panel{workspace.popupCount === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-[11px] text-white/50">
                                    {lastUpdated}
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation()
                                    handleDeleteWorkspace(workspace.id)
                                  }}
                                  disabled={disableDelete}
                                  className={[
                                    'absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-white/70 opacity-0 transition-all group-hover:opacity-100',
                                    disableDelete
                                      ? 'cursor-not-allowed opacity-30'
                                      : 'hover:border-red-400/60 hover:bg-red-600/20 hover:text-red-200',
                                  ].join(' ')}
                                  aria-label={
                                    workspace.isDefault
                                      ? 'Default workspace cannot be deleted'
                                      : 'Delete workspace'
                                  }
                                >
                                  {isDeleting ? (
                                    <span className="text-[10px] font-semibold uppercase tracking-wide">…</span>
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="flex h-full w-full">
              <div
                className="flex-1 relative transition-all duration-300 ease-in-out"
                style={{
                  position: 'relative',
                  zIndex: 1,
                  isolation: 'isolate',
                  opacity: showConstellationPanel ? 0 : 1,
                  visibility: showConstellationPanel ? 'hidden' : 'visible',
                }}
                aria-hidden={showConstellationPanel}
              >
                <div
                  className="h-full w-full"
                  style={{
                    pointerEvents: showConstellationPanel || isPopupLayerActive ? 'none' : 'auto',
                  }}
                >
                  {openNotes.length > 0 ? (
                    <ModernAnnotationCanvas
                      key="workspace"
                      noteIds={openNotes.map(note => note.noteId)}
                      primaryNoteId={activeNoteId ?? openNotes[0].noteId}
                      ref={canvasRef}
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
                        />
                      )}
                    </ModernAnnotationCanvas>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gray-950">
                      <div className="text-center">
                        <h2 className="mb-4 text-3xl font-bold text-gray-600">
                          Welcome to Annotation Canvas
                        </h2>
                        <p className="mb-6 text-gray-500">
                          Right-click anywhere to open Notes Explorer and create a new note
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {canRenderOverlay && adaptedPopups && (
              <PopupOverlay
                popups={adaptedPopups}
                draggingPopup={draggingPopup}
                onClosePopup={handleCloseOverlayPopup}
                onInitiateClose={handleInitiateClose}
                onConfirmClose={handleConfirmClose}
                onCancelClose={handleCancelClose}
                onTogglePin={handleTogglePin}
                onDragStart={handlePopupDragStart}
                onHoverFolder={handleFolderHover}
                onLeaveFolder={handleFolderHoverLeave}
                onPopupHover={handlePopupHover}
                onSelectNote={handleNoteSelect}
                onDeleteSelected={handleDeleteSelected}
                onBulkMove={handleBulkMove}
                onFolderCreated={handleFolderCreated}
                onFolderRenamed={handleFolderRenamed}
                onPopupCardClick={handleCloseNotesWidget}
                onContextMenu={handleContextMenu}
                onPopupPositionChange={handlePopupPositionChange}
                onResizePopup={handleResizePopup}
                isLocked={isWorkspaceLayoutLoading}
                sidebarOpen={isPopupLayerActive}
                backdropStyle={backdropStyle}
                workspaceId={currentWorkspaceId}
                activeMoveCascadeParentId={moveCascadeState.parentId}
                moveCascadeChildIds={moveCascadeState.childIds}
                onToggleMoveCascade={handleToggleMoveCascade}
              />
            )}

            {shouldLoadOverlay && sidebarFolderPopups.map((popup) => {
              const popupColorTheme = popup.folderColor ? getFolderColorTheme(popup.folderColor) : null
              return (
                <div
                  key={popup.id}
                  className="fixed w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
                  style={{
                    backgroundColor: 'rgba(17, 24, 39, 0.98)',
                    left: `${popup.position.x}px`,
                    top: `${popup.position.y}px`,
                    zIndex: Z_INDEX.DROPDOWN + 20,
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onMouseEnter={() => handleSidebarPopupHover(popup.folderId)}
                  onMouseLeave={() => handleSidebarEyeHoverLeave(popup.folderId)}
                >
                  <div
                    className="flex items-center justify-between px-4 py-3 border-b text-sm font-medium"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'rgba(255, 255, 255, 0.8)',
                      borderBottomColor: 'rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {popupColorTheme && (
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: popupColorTheme.bg }}
                        />
                      )}
                      <span>{popup.folderName}</span>
                    </div>
                    <button
                      className="text-white/60 hover:text-white"
                      onClick={() =>
                        setSidebarFolderPopups((prev) => prev.filter((p) => p.id !== popup.id))
                      }
                      aria-label="Close preview popup"
                    >
                      ×
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-3 space-y-1">
                    {popup.isLoading ? (
                      <div className="py-4 text-center text-sm text-white/60">Loading...</div>
                    ) : popup.children.length === 0 ? (
                      <div className="py-4 text-center text-sm text-white/60">Empty folder</div>
                    ) : (
                      popup.children.map((child) => (
                        <div key={child.id} className="group relative">
                          <button
                            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-white/90 transition hover:border-blue-400/40 hover:bg-blue-500/20"
                            onDoubleClick={() => {
                              if (child.type === 'note') {
                                handleSidebarNoteOpen(child.id)
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 text-sm font-medium">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span>{child.icon ?? (child.type === 'folder' ? '📁' : '📄')}</span>
                                <span className="truncate">{child.name}</span>
                              </div>
                              {child.type === 'folder' ? (
                                <div
                                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                                  onMouseEnter={(event) =>
                                    handleSidebarOrgEyeHover(child, event, popup.folderId)
                                  }
                                  onMouseLeave={() => handleSidebarEyeHoverLeave(child.id)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleSidebarPopupFolderClick(child, event)
                                  }}
                                >
                                  <Eye className="h-3.5 w-3.5 text-blue-400" />
                                </div>
                              ) : child.type === 'note' ? (
                                <div
                                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                                  onMouseEnter={(event) =>
                                    handleSidebarNotePreviewHover(child.id, event, popup.folderId)
                                  }
                                  onMouseLeave={handleSidebarNotePreviewLeave}
                                >
                                  <Eye className="h-3.5 w-3.5 text-blue-400" />
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-white/60">
                              {child.type === 'folder' ? 'Folder' : 'Note'}
                            </div>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}

            {notePreview &&
              typeof document !== 'undefined' &&
              createPortal(
                <PreviewPopover
                  content={notePreview.content}
                  status={isLoadingNotePreview ? 'loading' : 'ready'}
                  position={notePreview.position}
                  noteId={notePreview.noteId}
                  onOpenNote={(noteId) => {
                    handleSidebarNoteOpen(noteId)
                    cancelNotePreview()
                  }}
                  onMouseEnter={handleSidebarPreviewTooltipEnter}
                  onMouseLeave={handleSidebarPreviewTooltipLeave}
                />,
                document.body
              )}

            {showNotesWidget && !activeNoteId && !showConstellationPanel && (
              <FloatingToolbar
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
                workspaceId={currentWorkspaceId}
              />
            )}

            {showConstellationPanel && (
              <div className="absolute inset-0 z-40">
                <ConstellationPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </ConstellationProvider>
  )
}

export function AnnotationApp() {
  // Always provide LayerProvider - it will internally check feature flag
  return (
    <LayerProvider initialPopupCount={0}>
      <CanvasWorkspaceProvider>
        <AnnotationAppContent />
      </CanvasWorkspaceProvider>
    </LayerProvider>
  )
} 
