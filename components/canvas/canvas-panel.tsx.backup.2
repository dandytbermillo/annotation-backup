"use client"

import React, { useRef, useState, useEffect, useReducer, useCallback, useLayoutEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import dynamic from 'next/dynamic'
import TiptapEditorPlain, { TiptapEditorPlainHandle } from "./tiptap-editor-plain"
import type { TiptapEditorHandle } from './tiptap-editor-collab'
import type * as Y from 'yjs'
import { v4 as uuidv4 } from "uuid"
import { createAnnotationBranch, getDefaultPanelWidth } from "@/lib/models/annotation"
import { getPlainProvider } from "@/lib/provider-switcher"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import type { PlainOfflineProvider, ProseMirrorJSON } from "@/lib/providers/plain-offline-provider"
import { type CollapsibleSelectionSnapshot } from "@/lib/extensions/collapsible-block-selection"
import { useLayer } from "@/components/canvas/layer-provider"
import { useAutoScroll } from "./use-auto-scroll"
import { useIsolation, useRegisterWithIsolation } from "@/lib/isolation/context"
import { Z_INDEX } from "@/lib/constants/z-index"
import { useCanvasCamera } from "@/lib/hooks/use-canvas-camera"
import { useLayerManager, useCanvasNode } from "@/lib/hooks/use-layer-manager"
import { Z_INDEX_BANDS } from "@/lib/canvas/canvas-node"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import { usePanelPersistence } from "@/lib/hooks/use-panel-persistence"
import { createNote } from "@/lib/utils/note-creator"
import { Save, Pencil, Wrench } from "lucide-react"
import { TypeSelector, type AnnotationType } from "./type-selector"
import { BranchesSection } from "./branches-section"
import { debugLog } from "@/lib/utils/debug-logger"
import { useCanvasWorkspace, SHARED_WORKSPACE_ID } from "./canvas-workspace-context"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { HOVER_HIGHLIGHT_DURATION_MS } from "@/lib/constants/ui-timings"

const TiptapEditorCollab = dynamic(() => import('./tiptap-editor-collab'), { ssr: false })

const CORE_ANNOTATION_TYPES = ['note', 'explore', 'promote'] as const
type CoreAnnotationType = typeof CORE_ANNOTATION_TYPES[number]

function isCoreAnnotationType(value: string): value is CoreAnnotationType {
  return CORE_ANNOTATION_TYPES.includes(value as CoreAnnotationType)
}

// Track which panel is currently being dragged globally
let globalDraggingPanelId: string | null = null

const HEADER_BUTTON_HOVER_DELAY_MS = 300

interface CanvasPanelProps {
  panelId: string
  branch: Branch
  position: { x: number; y: number }
  width?: number  // Optional width prop (defaults based on type)
  onClose?: () => void
  noteId?: string
}

export function CanvasPanel({ panelId, branch, position, width, onClose, noteId }: CanvasPanelProps) {
  const { dispatch, state, dataStore, noteId: contextNoteId, onRegisterActiveEditor, updateAnnotationType } = useCanvas()
  const { getWorkspace: getCanvasWorkspace } = useCanvasWorkspace()
  const workspaceShared = getCanvasWorkspace(SHARED_WORKSPACE_ID)
  const sharedDataStore = workspaceShared.dataStore
  type UnifiedEditorHandle = TiptapEditorHandle | TiptapEditorPlainHandle
  const editorRef = useRef<UnifiedEditorHandle | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  
  const effectiveNoteId = noteId || contextNoteId || ''
  const storeKey = useMemo(() => ensurePanelKey(effectiveNoteId, panelId), [effectiveNoteId, panelId])

  // Layer management integration
  const layerManager = useLayerManager()
  const layerBandInfo = layerManager.getLayerBandInfo(storeKey)
  const { node: canvasNode } = useCanvasNode(storeKey, 'panel', position)

  // Canvas state persistence - Get provider and branchesMap for persistence
  const provider = UnifiedProvider.getInstance()
  const branchesMap = provider.getBranchesMap()

  const { updateMainPosition, getWorkspace } = useCanvasWorkspace()
  const sharedWorkspace = useMemo(() => getWorkspace(SHARED_WORKSPACE_ID), [getWorkspace])

  // Panel persistence hook - needs LayerManager instance, not the hook
  const layerManagerInstance = layerManager.manager
  const { persistPanelUpdate } = usePanelPersistence({
    dataStore,
    branchesMap,
    layerManager: layerManagerInstance,
    noteId: effectiveNoteId
  })

  // State to track render position and prevent snap-back during drag
  const [renderPosition, setRenderPosition] = useState(position)

  // Annotation actions toggle state
  const [isActionsVisible, setIsActionsVisible] = useState(false)
  const [isActionsHovering, setIsActionsHovering] = useState(false)
  const actionsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const actionsShowTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Panel hover state for hiding/showing buttons
  const [isPanelHovered, setIsPanelHovered] = useState(false)
  const panelHoverShowTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const panelHoverHideTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showToolsDropdown, setShowToolsDropdown] = useState(false)
  const [activeToolPanel, setActiveToolPanel] = useState<'layer' | 'format' | 'resize' | 'branches' | 'actions' | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Type change state - prevents race conditions from rapid clicks
  const [isChangingType, setIsChangingType] = useState(false)

  // Request cancellation for race condition prevention
  //
  // CRITICAL: Prevents rapid-rename race conditions where:
  //   User types: A → B → C
  //   Without cancellation:
  //     t0: Request A→B starts
  //     t1: Request B→C starts
  //     t2: Response B→C arrives → dataStore = "C" ✓
  //     t3: Response A→B arrives → dataStore = "B" ❌ (overwrites C!)
  //   With cancellation:
  //     t0: Request A→B starts
  //     t1: Request B→C starts + Request A→B cancelled
  //     t2: Response B→C arrives → dataStore = "C" ✓
  //     t3: Cancelled response ignored
  //
  // Result: Only the LATEST rename wins, user's final input is preserved
  const renameAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const events = sharedWorkspace?.events
    if (!events || !effectiveNoteId) {
      return
    }

    const handleHighlight = (payload: { noteId?: string } | undefined) => {
      if (!payload || payload.noteId !== effectiveNoteId || panelId !== 'main') {
        return
      }

      setIsHighlighting(true)
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setIsHighlighting(false)
        highlightTimeoutRef.current = null
      }, HOVER_HIGHLIGHT_DURATION_MS)
    }

    events.on('workspace:highlight-note', handleHighlight)

    return () => {
      events.off('workspace:highlight-note', handleHighlight)
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
        highlightTimeoutRef.current = null
      }
    }
  }, [sharedWorkspace, effectiveNoteId, panelId])

  // Load panel title from database on mount - force re-fetch on every mount
  useEffect(() => {
    if (!noteId) return

    let isMounted = true

    const loadPanelTitle = async () => {
      try {
        // Add timestamp to prevent caching during rapid reloads
        const timestamp = Date.now()
        const response = await fetch(`/api/postgres-offline/panels?note_id=${encodeURIComponent(noteId)}&_t=${timestamp}`)
        if (response.ok && isMounted) {
          const panels = await response.json()
          const panel = panels.find((p: any) => p.panel_id === panelId)
          if (panel?.title && panel.title !== currentBranch.title) {
            // Only update if title actually changed (prevent re-render loops)
            dataStore.update(storeKey, { title: panel.title })
            console.log('[CanvasPanel] Loaded title from DB:', panel.title)
          }
        }
      } catch (error) {
        console.error('[CanvasPanel] Failed to load panel title:', error)
      }
    }

    // Load immediately on mount
    loadPanelTitle()

    return () => {
      isMounted = false
      // Cancel any in-flight rename requests on unmount
      if (renameAbortControllerRef.current) {
        renameAbortControllerRef.current.abort()
        renameAbortControllerRef.current = null
      }
    }
  }, [noteId, panelId]) // Only re-run when noteId or panelId changes

  // Listen for rename events from other components (e.g., popup overlay)
  // CRITICAL: Defensive validation prevents crashes from malformed events
  useEffect(() => {
    if (!noteId) return

    const handleNoteRenamed = (event: Event) => {
      try {
        // Validate event structure before accessing properties
        const customEvent = event as CustomEvent<{ noteId: string; newTitle: string }>

        // Guard: Ensure detail object exists
        if (!customEvent.detail) {
          console.warn('[CanvasPanel] Received note-renamed event with no detail object')
          return
        }

        const { noteId: renamedNoteId, newTitle } = customEvent.detail

        // Guard: Validate required fields
        if (!renamedNoteId || typeof renamedNoteId !== 'string') {
          console.warn('[CanvasPanel] Received note-renamed event with invalid noteId:', renamedNoteId)
          return
        }

        if (!newTitle || typeof newTitle !== 'string' || !newTitle.trim()) {
          console.warn('[CanvasPanel] Received note-renamed event with invalid newTitle:', newTitle)
          return
        }

        // Only update if this is the main panel and showing the renamed note
        // Branch panels manage their own titles independently via handleSaveRename
        if (panelId === 'main' && renamedNoteId === noteId) {
          console.log('[CanvasPanel] Main panel received note rename event:', newTitle.trim())

          // Guard: Ensure dataStore.update doesn't throw
          try {
            dataStore.update(storeKey, { title: newTitle.trim() })
            dispatch({ type: "BRANCH_UPDATED" })
          } catch (updateError) {
            console.error('[CanvasPanel] Failed to update panel title:', updateError)
            // Non-critical: Don't crash the app, just log the error
          }
        }
      } catch (error) {
        // Catch-all: Prevent event handler errors from crashing the app
        console.error('[CanvasPanel] Error handling note-renamed event:', error)
      }
    }

    window.addEventListener('note-renamed', handleNoteRenamed)
    return () => {
      window.removeEventListener('note-renamed', handleNoteRenamed)
    }
  }, [noteId, panelId, dataStore, dispatch])

  const [panelHeight, setPanelHeight] = useState<number>(500)
  const previousPanelHeightRef = useRef<number>(500)
  const [isPanelHeightExpanded, setIsPanelHeightExpanded] = useState(false)
  const cameraZoomRef = useRef<number>(1)

  const headerControlsActive = isPanelHovered || isActionsVisible || isActionsHovering
  
  // Branch preview state
  const [previewBranchId, setPreviewBranchId] = useState<string | null>(null)
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [collapsibleSelection, setCollapsibleSelection] = useState<CollapsibleSelectionSnapshot | null>(null)
  const handleCollapsibleSelectionChange = useCallback((snapshot: CollapsibleSelectionSnapshot) => {
    if (snapshot.mode === 'none') {
      setCollapsibleSelection(null)
      return
    }
    setCollapsibleSelection(snapshot)
  }, [])

  const getViewportFillHeight = useCallback((top: number) => {
    if (typeof window === 'undefined') {
      return previousPanelHeightRef.current
    }
    const viewportHeight = window.innerHeight
    const marginBottom = 8
    const screenAvailable = viewportHeight - Math.max(top, 0) - marginBottom
    const safeZoom = cameraZoomRef.current || 1
    const worldHeight = screenAvailable / safeZoom
    return Math.max(worldHeight, 320)
  }, [])

  const getCurrentPanelTop = useCallback(() => {
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect()
      return rect.top
    }
    return renderPosition.y
  }, [renderPosition.y])


  const positionAnnotationToolbar = useCallback((target: HTMLElement) => {
    const toolbar = document.getElementById("annotation-toolbar")
    if (!toolbar) return

    const rect = target.getBoundingClientRect()
    toolbar.style.position = "fixed"
    toolbar.style.left = `${rect.left + rect.width / 2}px`
    toolbar.style.top = `${rect.bottom + 8}px`
    toolbar.style.opacity = "1"
    toolbar.style.pointerEvents = "auto"
    toolbar.classList.add("visible")
  }, [])

  const hideAnnotationToolbar = useCallback(() => {
    const toolbar = document.getElementById("annotation-toolbar")
    if (!toolbar) return
    toolbar.style.opacity = "0"
    toolbar.style.pointerEvents = "none"
    toolbar.classList.remove("visible")
  }, [])

  const handleActionsButtonClick = useCallback((event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation()

    if (actionsShowTimeoutRef.current) {
      clearTimeout(actionsShowTimeoutRef.current)
      actionsShowTimeoutRef.current = null
    }

    const target = event?.currentTarget as HTMLElement

    const nextVisible = !isActionsVisible
    setIsActionsVisible(nextVisible)
    setIsActionsHovering(false)

    if (nextVisible && target) {
      positionAnnotationToolbar(target)
    } else if (!nextVisible) {
      hideAnnotationToolbar()
    }
  }, [hideAnnotationToolbar, isActionsVisible, positionAnnotationToolbar])

  const handleActionsButtonMouseEnter = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = "rgba(255,255,255,0.3)"
    if (actionsTimeoutRef.current) {
      clearTimeout(actionsTimeoutRef.current)
    }
    if (actionsShowTimeoutRef.current) {
      clearTimeout(actionsShowTimeoutRef.current)
      actionsShowTimeoutRef.current = null
    }

    const buttonEl = event.currentTarget

    const showToolbar = (target: HTMLButtonElement) => {
      setIsActionsHovering(true)
      positionAnnotationToolbar(target)
    }

    if (isActionsVisible || isActionsHovering) {
      showToolbar(buttonEl)
      return
    }

    actionsShowTimeoutRef.current = setTimeout(() => {
      showToolbar(buttonEl)
      actionsShowTimeoutRef.current = null
    }, HEADER_BUTTON_HOVER_DELAY_MS)
  }, [isActionsHovering, isActionsVisible, positionAnnotationToolbar])

  const handleActionsButtonMouseLeave = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = "rgba(255,255,255,0.2)"
    if (actionsShowTimeoutRef.current) {
      clearTimeout(actionsShowTimeoutRef.current)
      actionsShowTimeoutRef.current = null
    }
    actionsTimeoutRef.current = setTimeout(() => {
      setIsActionsHovering(false)
      const toolbar = document.getElementById("annotation-toolbar")
      if (toolbar && !toolbar.matches(':hover')) {
        hideAnnotationToolbar()
      }
    }, HEADER_BUTTON_HOVER_DELAY_MS)
  }, [hideAnnotationToolbar])

  const handleTogglePanelHeight = useCallback(() => {
    if (isPanelHeightExpanded) {
      setPanelHeight(previousPanelHeightRef.current)
      setIsPanelHeightExpanded(false)
      return
    }

    previousPanelHeightRef.current = panelHeight
    const panelTop = getCurrentPanelTop()
    const expandedHeight = getViewportFillHeight(panelTop)
    setPanelHeight(expandedHeight)
    setIsPanelHeightExpanded(true)
  }, [getCurrentPanelTop, getViewportFillHeight, isPanelHeightExpanded, panelHeight])
  
  // Update render position when position prop changes (but not during drag)
  const dragStateRef = useRef<any>(null) // Will be set to dragState later
  useEffect(() => {
    // Use globalDraggingPanelId to check if THIS panel is being dragged
    // This is more reliable than dragStateRef during re-renders
    const isPanelBeingDragged = globalDraggingPanelId === panelId

    if (!isPanelBeingDragged) {
      // Always use prop position (centered)
      const nodePosition = position

      // DEBUG: Log position sources
      debugLog({
        component: 'CanvasPanel',
        action: 'position_update_sources',
        metadata: {
          panelId,
          propPosition: position,
          canvasNodePosition: canvasNode?.position,
          usingPosition: nodePosition,
          isDragging: dragStateRef.current?.isDragging,
          globalDraggingPanelId,
          isPanelBeingDragged
        }
      })

      setRenderPosition(nodePosition)
    } else {
      // DEBUG: Log that we're skipping position update during drag
      debugLog({
        component: 'CanvasPanel',
        action: 'position_update_skipped_during_drag',
        metadata: {
          panelId,
          globalDraggingPanelId,
          propPosition: position
        }
      })
    }
  }, [position, panelId]) // REMOVED canvasNode?.position - we don't use it and it causes re-renders during drag
  
  // Camera-based panning
  const {
    panCameraBy,
    resetPanAccumulation,
    getPanAccumulation,
    isCameraEnabled,
    getCameraState,
  } = useCanvasCamera()

  cameraZoomRef.current = getCameraState().zoom || 1
  
  // Isolation system integration
  const { isIsolated, level, placeholder } = useIsolation(panelId)
  // Register panel with isolation manager - mark 'main' as 'critical' so it is never auto-isolated
  useRegisterWithIsolation(panelId, panelRef as any, panelId === 'main' ? 'critical' : 'normal', 'panel')
  
  // Multi-layer canvas context
  const multiLayerEnabled = true
  const layerContext = useLayer()
  
  // Use refs to avoid stale closures in event handlers
  const multiLayerEnabledRef = useRef(multiLayerEnabled)
  const layerContextRef = useRef(layerContext)
  
  // Update refs when values change
  useEffect(() => {
    multiLayerEnabledRef.current = multiLayerEnabled
    layerContextRef.current = layerContext
  }, [multiLayerEnabled, layerContext])
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (actionsTimeoutRef.current) {
        clearTimeout(actionsTimeoutRef.current)
      }
      if (actionsShowTimeoutRef.current) {
        clearTimeout(actionsShowTimeoutRef.current)
        actionsShowTimeoutRef.current = null
      }
      if (panelHoverShowTimeoutRef.current) {
        clearTimeout(panelHoverShowTimeoutRef.current)
        panelHoverShowTimeoutRef.current = null
      }
      if (panelHoverHideTimeoutRef.current) {
        clearTimeout(panelHoverHideTimeoutRef.current)
        panelHoverHideTimeoutRef.current = null
      }
    }
  }, [])
  
  // Handle clicking outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Close actions panel if clicking outside of it
      if (isActionsHovering || isActionsVisible) {
        const actions = document.getElementById(`actions-panel-${panelId}`)
        const button = document.getElementById(`actions-button-${panelId}`)

        if (actions && !actions.contains(target) && button && !button.contains(target)) {
          setIsActionsHovering(false)
          setIsActionsVisible(false)
          if (actionsTimeoutRef.current) {
            clearTimeout(actionsTimeoutRef.current)
          }
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isActionsHovering, isActionsVisible, panelId])

  // Determine Option A (plain) vs collaboration mode as early as possible
  const isPlainMode = isPlainModeActive()
  
  // Check if content is empty to auto-enable edit mode
  const isContentEmpty = () => {
    if (!branch.content) return true
    
    // Check for empty string
    if (branch.content === '') return true
    
    // Check for empty HTML content
    if (typeof branch.content === 'string') {
      const stripped = branch.content.replace(/<[^>]*>/g, '').trim()
      if (stripped.length === 0) return true
      
      // Also check for just placeholder paragraphs
      if (stripped === 'Start writing your document here...' || 
          stripped === 'Start typing...' ||
          stripped.match(/^Start writing your (note|explore|promote)\.{0,3}$/)) {
        return true
      }
    }
    
    // Check for empty ProseMirror JSON
    if (typeof branch.content === 'object' && branch.content.content) {
      const jsonStr = JSON.stringify(branch.content)
      // Check if has any actual text content
      if (!jsonStr.includes('"text"')) return true
      
      // Check if only has empty paragraph
      if (branch.content.content.length === 1 && 
          branch.content.content[0].type === 'paragraph' &&
          (!branch.content.content[0].content || branch.content.content[0].content.length === 0)) {
        return true
      }
    }
    
    return false
  }
  
  // Edit mode state - now respects layer state
  const [isEditing, setIsEditing] = useState(true)
  
  // Use LayerManager z-index as single source of truth
  // Default to base z-index if node not yet registered
  const zIndex = canvasNode?.zIndex ?? Z_INDEX.CANVAS_NODE_BASE
  
  // Compute whether the editor should be editable based on layer state
  const isLayerInteractive = !multiLayerEnabled || !layerContext || layerContext.activeLayer === 'notes'
  const isLayerInteractiveRef = useRef(isLayerInteractive)
  useEffect(() => {
    isLayerInteractiveRef.current = isLayerInteractive
    if (!isLayerInteractive && typeof window !== 'undefined') {
      const activeElement = document.activeElement as HTMLElement | null
      if (activeElement?.closest('.ProseMirror')) {
        activeElement.blur()
      }
    }
  }, [isLayerInteractive])

  const actuallyEditable = isEditing
  const [activeFilter, setActiveFilter] = useState<'all' | 'note' | 'explore' | 'promote'>('all')
  const [lastBranchUpdate, setLastBranchUpdate] = useState(Date.now())
  const forceUpdate = useReducer(() => ({}), {})[1]
  const [isContentLoading, setIsContentLoading] = useState(true)
  const [isHighlighting, setIsHighlighting] = useState(false)
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const defaultShadow = isIsolated ? '0 8px 32px rgba(239, 68, 68, 0.25)' : '0 8px 32px rgba(0,0,0,0.15)'
  const panelBoxShadow = isHighlighting
    ? `0 0 0 3px rgba(129, 140, 248, 0.85), ${defaultShadow}`
    : defaultShadow

  // Save As dialog state (matching notes-explorer implementation)
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false)
  const [saveAsNoteName, setSaveAsNoteName] = useState("")
  const [saveAsSelectedFolderId, setSaveAsSelectedFolderId] = useState<string | null>(null)
  const [saveAsAvailableFolders, setSaveAsAvailableFolders] = useState<Array<{
    id: string
    name: string
    path: string
    parentId?: string | null
    depth?: number
  }>>([])
  const [saveAsIsCreatingFolder, setSaveAsIsCreatingFolder] = useState(false)
  const [saveAsNewFolderName, setSaveAsNewFolderName] = useState("")
  const [saveAsShowCustomFolder, setSaveAsShowCustomFolder] = useState(false)
  const [saveAsCustomFolderInput, setSaveAsCustomFolderInput] = useState("")
  const [plainProvider, setPlainProvider] = useState<PlainOfflineProvider | null>(null)
  const postLoadEditApplied = useRef(false)
  
  // Use noteId from props or context
  const currentNoteId = noteId || contextNoteId
  
  // Blur editor when switching to popup layer
  // RAF-throttled drag state
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialPosition: { x: 0, y: 0 },
    pointerDelta: { x: 0, y: 0 },
    autoScrollOffset: { x: 0, y: 0 },
    mouseMoveCount: 0, // Track first few mousemove events for debugging
    lastMoveTime: 0, // Track timing for jitter detection
    lastPosition: { x: 0, y: 0 }, // Track previous position for delta calculation
    rafScheduled: false, // Track if RAF update is scheduled
    pendingMouseEvent: null as { clientX: number; clientY: number } | null, // Store latest mouse position
  })
  const rafIdRef = useRef<number | null>(null)
  
  // Link dragStateRef to dragState for the useEffect above
  dragStateRef.current = dragState.current
  
  // Auto-scroll functionality for panel dragging
  const handleAutoScroll = useCallback((deltaX: number, deltaY: number) => {
    if (!dragState.current.isDragging) {
      debugLog({
        component: 'CanvasPanel',
        action: 'auto_scroll_ignored_not_dragging',
        metadata: {
          panelId,
          scrollDelta: { x: deltaX, y: deltaY },
          reason: 'isDragging is false'
        }
      })
      return
    }

    // DEBUG: Log auto-scroll events with full state
    const currentPanelLeft = panelRef.current ? panelRef.current.style.left : 'N/A'
    const currentPanelTop = panelRef.current ? panelRef.current.style.top : 'N/A'

    // Get canvas state before scroll
    const canvasEl = document.getElementById('infinite-canvas')
    const canvasTransformBefore = canvasEl ? window.getComputedStyle(canvasEl).transform : 'none'

    debugLog({
      component: 'CanvasPanel',
      action: 'auto_scroll_EXECUTING',
      metadata: {
        panelId,
        scrollDelta: { x: deltaX, y: deltaY },
        currentPanelPosition: { left: currentPanelLeft, top: currentPanelTop },
        cameraEnabled: isCameraEnabled,
        moveCount: dragState.current.mouseMoveCount,
        canvasTransformBefore,
        canvasState: {
          translateX: state.canvasState?.translateX || 0,
          translateY: state.canvasState?.translateY || 0,
          zoom: state.canvasState?.zoom || 1
        },
        dragState: {
          initialPosition: { ...dragState.current.initialPosition },
          pointerDelta: { ...dragState.current.pointerDelta },
          autoScrollOffset: { ...dragState.current.autoScrollOffset }
        },
        scrollMethod: isCameraEnabled ? 'CAMERA_PAN' : 'LEGACY_PANEL_MOVE'
      }
    })

    if (isCameraEnabled) {
      // Use camera-based panning (pan opposite to pointer delta)
      panCameraBy({ dxScreen: -deltaX, dyScreen: -deltaY })

      const state = dragState.current
      state.autoScrollOffset.x += deltaX
      state.autoScrollOffset.y += deltaY

      if (state.isDragging && panelRef.current) {
        const { pointerDelta, initialPosition, autoScrollOffset } = state
        const nextLeft = initialPosition.x + pointerDelta.x - autoScrollOffset.x
        const nextTop = initialPosition.y + pointerDelta.y - autoScrollOffset.y

        // DEBUG: Comprehensive viewport + panel state logging
        // Get canvas transform to detect viewport panning
        const canvasEl = document.getElementById('infinite-canvas')
        const canvasTransform = canvasEl ? window.getComputedStyle(canvasEl).transform : 'none'

        // Get ALL panel positions to see if multiple panels move
        const allPanels = document.querySelectorAll('[data-panel-id]')
        const allPanelPositions: Record<string, { left: string; top: string }> = {}
        allPanels.forEach(panel => {
          const panelEl = panel as HTMLElement
          const panelId = panelEl.getAttribute('data-panel-id')
          if (panelId) {
            allPanelPositions[panelId] = {
              left: panelEl.style.left || '0',
              top: panelEl.style.top || '0'
            }
          }
        })

        debugLog({
          component: 'CanvasPanel',
          action: 'auto_scroll_comprehensive_state',
          metadata: {
            draggedPanelId: panelId,
            draggedPanelCalculated: { nextLeft, nextTop },
            dragState: { initialPosition, pointerDelta, autoScrollOffset },
            canvasTransform,
            allPanelPositions,
            viewportSize: { width: window.innerWidth, height: window.innerHeight }
          }
        })

        panelRef.current.style.left = `${nextLeft}px`
        panelRef.current.style.top = `${nextTop}px`
        // REMOVED: Don't call setRenderPosition during drag - causes position snapping
        // We'll update React state only when drag ends
      }
    } else {
      // Legacy: Move ALL panels to simulate canvas panning
      debugLog({
        component: 'CanvasPanel',
        action: 'auto_scroll_legacy_mode',
        metadata: {
          panelId,
          scrollDelta: { x: deltaX, y: deltaY },
          note: 'This mode moves ALL panels - if this logs, camera is disabled'
        }
      })

      const allPanels = document.querySelectorAll('[data-panel-id]')
      const panelPositionsBefore: Record<string, { left: number; top: number }> = {}
      const panelPositionsAfter: Record<string, { left: number; top: number }> = {}

      allPanels.forEach(panel => {
        const panelEl = panel as HTMLElement
        const pid = panelEl.getAttribute('data-panel-id')
        if (pid) {
          const currentLeft = parseInt(panelEl.style.left || '0', 10)
          const currentTop = parseInt(panelEl.style.top || '0', 10)
          panelPositionsBefore[pid] = { left: currentLeft, top: currentTop }

          if (panelEl.id === `panel-${panelId}` && dragState.current.isDragging) {
            // For the dragging panel, update its initial position
            dragState.current.initialPosition.x += deltaX
            dragState.current.initialPosition.y += deltaY
          } else {
            // For other panels, update their actual position
            panelEl.style.left = (currentLeft + deltaX) + 'px'
            panelEl.style.top = (currentTop + deltaY) + 'px'
          }

          const newLeft = parseInt(panelEl.style.left || '0', 10)
          const newTop = parseInt(panelEl.style.top || '0', 10)
          panelPositionsAfter[pid] = { left: newLeft, top: newTop }
        }
      })

      debugLog({
        component: 'CanvasPanel',
        action: 'auto_scroll_legacy_panel_moves',
        metadata: {
          panelId,
          panelPositionsBefore,
          panelPositionsAfter,
          scrollDelta: { x: deltaX, y: deltaY }
        }
      })
    }
  }, [panelId, isCameraEnabled, panCameraBy])
  
  // State for auto-scroll visual affordance
  const [isAutoScrollPending, setIsAutoScrollPending] = useState(false)
  const [edgeGlowEdges, setEdgeGlowEdges] = useState<string[]>([])

  const { checkAutoScroll, stopAutoScroll, autoScroll } = useAutoScroll({
    enabled: true,
    threshold: 50, // Reduced from 80px to 50px
    speedPxPerSec: 500, // 500 screen px/s (industry standard, frame-rate independent)
    activationDelay: 800, // Increased to 800ms - gives user time to position panel
    onScroll: handleAutoScroll,
    onActivationPending: setIsAutoScrollPending // Visual affordance callback
  })

  // Sync pendingEdges to local state (only when edges actually change, not on velocity updates)
  useEffect(() => {
    const newEdges = autoScroll.pendingEdges
    const edgesChanged =
      newEdges.length !== edgeGlowEdges.length ||
      newEdges.some(edge => !edgeGlowEdges.includes(edge))

    if (edgesChanged) {
      setEdgeGlowEdges(newEdges)
    }
  }, [autoScroll.pendingEdges, edgeGlowEdges])

  // Visual affordance: Change cursor when auto-scroll activation is pending
  useEffect(() => {
    if (isAutoScrollPending) {
      // Show "waiting" cursor to indicate auto-scroll will activate soon
      document.body.style.cursor = 'wait'

      debugLog({
        component: 'CanvasPanel',
        action: 'auto_scroll_visual_affordance_active',
        metadata: {
          panelId,
          cursorStyle: 'wait',
          reason: 'activation_delay_countdown'
        }
      })
    } else {
      // Reset cursor only if we set it to wait
      if (document.body.style.cursor === 'wait') {
        document.body.style.cursor = ''

        debugLog({
          component: 'CanvasPanel',
          action: 'auto_scroll_visual_affordance_cleared',
          metadata: {
            panelId,
            reason: 'activation_cancelled_or_completed'
          }
        })
      }
    }
  }, [isAutoScrollPending, panelId])

  // Get appropriate provider based on mode
  const [ydocState, setYdocState] = useState<{ loading: boolean; doc: Y.Doc | null; error: Error | null }>(
    { loading: false, doc: null, error: null }
  )
  // provider already declared at component start (line 61)

  // Load plain provider when in plain mode
  useEffect(() => {
    if (isPlainMode) {
      // Poll for plain provider initialization
      const checkProvider = () => {
        const { getPlainProvider } = require('@/lib/provider-switcher')
        const provider = getPlainProvider()
        if (provider) {
          console.log('[CanvasPanel] Plain provider initialized')
          setPlainProvider(provider)
        } else {
          // Retry after a short delay
          setTimeout(checkProvider, 100)
        }
      }
      checkProvider()
    }
  }, [isPlainMode])
  
  // Lazy-load Y.Doc only in Yjs mode
  useEffect(() => {
    let cancelled = false
    if (!isPlainMode) {
      setYdocState(s => ({ ...s, loading: true, error: null }))
      import('@/lib/lazy-yjs')
        .then(({ loadYjsProvider }) => loadYjsProvider())
        .then((yjsProvider) => {
          if (cancelled) return
          if (yjsProvider?.getEditorYDoc) {
            const doc = yjsProvider.getEditorYDoc(panelId, currentNoteId)
            setYdocState({ loading: false, doc, error: null })
          } else {
            setYdocState({ loading: false, doc: null, error: new Error('getEditorYDoc unavailable') })
          }
        })
        .catch((e: any) => {
          if (cancelled) return
          setYdocState({ loading: false, doc: null, error: e instanceof Error ? e : new Error('Failed to load Yjs') })
        })
    } else {
      setYdocState({ loading: false, doc: null, error: null })
    }
    return () => { cancelled = true }
  }, [isPlainMode, panelId, currentNoteId])
  
  // Set the current note context if provided
  useEffect(() => {
    if (currentNoteId) {
      provider.setCurrentNote(currentNoteId)
    }
  }, [currentNoteId])
  
  // Wait for content to load (Y.Doc for Yjs mode, or skip for plain mode)
  useEffect(() => {
    if (isPlainMode) {
      // Plain mode doesn't need to wait for Y.Doc loading
      setIsContentLoading(false)
      return
    }
    
    // Reset loading state when note/panel changes
    setIsContentLoading(true)
    
    const checkDocLoading = async () => {
      const { docLoadingStates } = await import('@/lib/yjs-utils')
      const cacheKey = currentNoteId ? `${currentNoteId}-${panelId}` : panelId
      
      // Check if doc is loading
      const loadingPromise = docLoadingStates.get(cacheKey)
      if (loadingPromise) {
        // Wait for loading to complete
        await loadingPromise
      }
      
      // Content is loaded, allow rendering
      setIsContentLoading(false)
    }
    
    checkDocLoading()
  }, [currentNoteId, panelId, isPlainMode])
  
  // Ensure panel position is set on mount
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.left = position.x + 'px'
      panelRef.current.style.top = position.y + 'px'
    }
  }, [])

  const cameraZoom = state.canvasState?.zoom || 1

  useEffect(() => {
    if (!isPanelHeightExpanded) {
      return
    }
    if (dragStateRef.current?.isDragging) {
      return
    }
    cameraZoomRef.current = cameraZoom
    const panelTop = getCurrentPanelTop()
    setPanelHeight(getViewportFillHeight(panelTop))
  }, [cameraZoom, getCurrentPanelTop, getViewportFillHeight, isPanelHeightExpanded])

  useEffect(() => {
    if (!isPanelHeightExpanded) {
      return
    }
    if (dragStateRef.current?.isDragging) {
      return
    }
    const handleResize = () => {
      const panelTop = getCurrentPanelTop()
      setPanelHeight(getViewportFillHeight(panelTop))
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [cameraZoom, getCurrentPanelTop, getViewportFillHeight, isPanelHeightExpanded])
  
  // Auto-focus editor when panel mounts if content is empty or it's the main panel
  useEffect(() => {
    const isEmpty = isContentEmpty()
    const isMain = panelId === 'main'
    
    // Always auto-focus main panel when it's empty and editable
    if (isEditing && isMain && isEmpty) {
      // Multiple attempts to ensure focus works after note switch
      const focusAttempts = [100, 300, 500, 800]
      focusAttempts.forEach(delay => {
        setTimeout(() => {
          if (editorRef.current && isEditing && isLayerInteractiveRef.current) {
            editorRef.current.focus()
          }
        }, delay)
      })
    } else if (isEditing && isEmpty && editorRef.current) {
      // For non-main panels, single focus attempt
      setTimeout(() => {
        if (editorRef.current && isLayerInteractiveRef.current) {
          editorRef.current.focus()
        }
      }, 300)
    }
  }, [noteId]) // Re-run when noteId changes (when switching notes)

  const isContentEmptyValue = (value: ProseMirrorJSON | string | null) => {
    if (!value) return true
    if (typeof value === 'string') {
      const stripped = value.replace(/<[^>]*>/g, '').trim()
      return stripped.length === 0 || value === '<p></p>'
    }
    if (typeof value === 'object' && Array.isArray((value as any).content)) {
      return (value as any).content.length === 0
    }
    return false
  }

  const handleEditorContentLoaded = useCallback(
    ({ content: loadedContent }: { content: ProseMirrorJSON | string | null; version: number }) => {
      if (!isPlainMode) return

      console.log(`[🔍 DATASTORE-UPDATE] handleEditorContentLoaded called for ${panelId}`, {
        hasContent: !!loadedContent,
        isEmpty: isContentEmptyValue(loadedContent),
        contentPreview: loadedContent ? JSON.stringify(loadedContent).substring(0, 100) : 'NULL'
      })

      if (loadedContent !== undefined && loadedContent !== null && !isContentEmptyValue(loadedContent)) {
        const existing = dataStore.get(storeKey) || {}
        const previewFallback = existing.preview
          || existing.metadata?.preview
          || ''
        const computedPreview = buildBranchPreview(loadedContent)
        const previewText = (computedPreview || previewFallback || '').replace(/\s+/g, ' ').trim()

        const nextMetadata = {
          ...(existing.metadata || {}),
        }

        if (previewText) {
          nextMetadata.preview = previewText
        } else {
          delete nextMetadata.preview
        }

        console.log(`[🔍 DATASTORE-UPDATE] Updating dataStore for ${panelId}`, {
          preview: previewText.substring(0, 50),
          hasHydratedContent: true
        })

        dataStore.update(storeKey, {
          content: loadedContent,
          preview: previewText,
          hasHydratedContent: true,
          metadata: nextMetadata,
        })
      } else if (loadedContent !== undefined && loadedContent !== null) {
        // Ensure preview clears when empty content is applied
        const existing = dataStore.get(storeKey) || {}
        const nextMetadata = {
          ...(existing.metadata || {}),
        }
        delete nextMetadata.preview

        dataStore.update(storeKey, {
          content: loadedContent,
          preview: '',
          hasHydratedContent: false,
          metadata: nextMetadata,
        })
      }

      const empty = isContentEmptyValue(loadedContent)

      if (panelId !== 'main') return
      if (postLoadEditApplied.current) return

      postLoadEditApplied.current = true

      if (empty) {
        setIsEditing(true)
        setTimeout(() => {
          if (editorRef.current && isLayerInteractiveRef.current) {
            editorRef.current.focus()
          }
        }, 120)
      }
    },
    [isPlainMode, panelId, branch.originalText, dataStore]
  )
  
  // Update edit mode when branch content changes (Option A only)
  useEffect(() => {
    if (!isPlainMode) return
    
    // Don't trigger auto-edit while content is still loading
    if (isContentLoading) {
      console.log('[CanvasPanel] Skipping auto-edit check - content still loading')
      return
    }
    
    const isEmpty = isContentEmpty()
    
    // If content is empty and we're not in edit mode, switch to edit mode
    if (isEmpty && !isEditing) {
      console.log('[CanvasPanel] Auto-enabling edit mode for empty content')
      setIsEditing(true)
      
      // Also trigger focus
      setTimeout(() => {
        if (editorRef.current && isLayerInteractiveRef.current) {
          editorRef.current.focus()
        }
      }, 100)
    }
  }, [branch.content, panelId, isEditing, isPlainMode, isContentLoading]) // Watch for content changes

  // branchesMap already declared at component start (line 62)

  // Get current branch data - re-evaluate on each render
  const getBranchData = () => {
    const providerData = branchesMap.get(storeKey)
    const storeData = dataStore.get(storeKey)

    // YJS returns proxy objects, convert to plain object for React
    if (providerData) {
      // Ensure branches array is preserved
      const plainData = JSON.parse(JSON.stringify(providerData))
      // Merge with store data to ensure no branches are lost
      if (storeData && storeData.branches) {
        const mergedBranches = [...new Set([...(plainData.branches || []), ...(storeData.branches || [])])]
        plainData.branches = mergedBranches
      }
      // Ensure branches array exists
      if (!plainData.branches) {
        plainData.branches = []
      }
      return plainData
    }

    // If no provider data, use store data or branch prop
    const data = storeData || branch
    // CRITICAL: Return a deep copy to prevent shared object references
    // Without this, multiple panels would modify the same object causing title/data sync issues
    const dataCopy = JSON.parse(JSON.stringify(data))
    // Ensure branches array exists
    if (!dataCopy.branches) {
      dataCopy.branches = []
    }

    return dataCopy
  }
  const currentBranch = getBranchData()

  // Debug: Log what currentBranch.type is for header color
  debugLog({
    component: 'CanvasPanel',
    action: 'currentBranch_type_for_header',
    metadata: {
      panelId,
      currentBranchType: currentBranch.type,
      currentBranchMetadata: currentBranch.metadata
    }
  })

  // Calculate panel width based on type (if not explicitly provided)
  const panelWidth = width ?? getDefaultPanelWidth(
    currentBranch.type === 'main' ? 'main' : (currentBranch.type as 'note' | 'explore' | 'promote')
  )

  // Generate title for branch panels if not set
  const getPanelTitle = () => {
    if (currentBranch.title) {
      return currentBranch.title
    }
    
    // For branch panels without a title, use the originalText
    if (panelId !== 'main' && currentBranch.originalText) {
      const truncatedText = currentBranch.originalText.length > 30 
        ? currentBranch.originalText.substring(0, 30) + '...' 
        : currentBranch.originalText
      return `"${truncatedText}"`
    }
    
    // Fallback to panelId if no title can be generated
    return panelId
  }

  const panelTitle = getPanelTitle()
  const showPanelTitle = Boolean(panelTitle)

  // Rename handlers
  const handleStartRename = () => {
    setIsRenaming(true)
    setTitleValue(currentBranch.title || '')
    setTimeout(() => titleInputRef.current?.select(), 0)
  }

  const handleSaveRename = async () => {
    const trimmed = titleValue.trim()
    if (trimmed && trimmed !== currentBranch.title) {
      const oldTitle = currentBranch.title // For rollback on error

      // Race condition prevention: Cancel any in-flight rename request
      // This ensures only the LATEST rename wins, preventing "A→B→C" bugs
      // where the slower "B" request might overwrite the faster "C" result
      if (renameAbortControllerRef.current) {
        console.log('[CanvasPanel] Cancelling previous rename request')
        renameAbortControllerRef.current.abort()
      }

      // Create new AbortController for this request
      const abortController = new AbortController()
      renameAbortControllerRef.current = abortController

      // Show saving indicator to user
      setIsSaving(true)

      // Optimistic update in-memory dataStore
      dataStore.update(storeKey, { title: trimmed })
      dispatch({ type: "BRANCH_UPDATED" })

      // Persist to database via atomic transaction endpoint
      if (noteId) {
        try {
          const response = await fetch(`/api/panels/${encodeURIComponent(panelId)}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              noteId,
              newTitle: trimmed
            }),
            signal: abortController.signal // Attach abort signal
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.details || 'Failed to rename panel')
          }

          const result = await response.json()
          console.log('[CanvasPanel] Rename succeeded:', result)

          // CRITICAL: Clear isSaving BEFORE nulling the ref
          // Otherwise finally block's guard (renameAbortControllerRef === abortController) fails
          // and isSaving stays true forever, leaving input permanently disabled
          if (renameAbortControllerRef.current === abortController) {
            setIsSaving(false)
            renameAbortControllerRef.current = null
          }

          // Update dataStore with confirmed server value (in case server modified it)
          dataStore.update(storeKey, { title: result.title })

          // Invalidate localStorage cache IMMEDIATELY with timestamped tombstone
          if (typeof window !== 'undefined') {
            try {
              const cachedKey = `note-data-${noteId}`

              // 1. Delete cache immediately
              window.localStorage.removeItem(cachedKey)

              // 2. Set timestamped tombstone (self-expires after 5 seconds)
              window.localStorage.setItem(`${cachedKey}:invalidated`, Date.now().toString())

              // 3. Emit event for live components (e.g., popup overlay) to refresh
              // CRITICAL: Only emit note-renamed event for main panel (note-level rename)
              // Branch panels manage their own titles independently
              if (panelId === 'main') {
                window.dispatchEvent(new CustomEvent('note-renamed', {
                  detail: { noteId, newTitle: result.title }
                }))
              }

              console.log('[CanvasPanel] Invalidated localStorage cache with tombstone')
            } catch (cacheError) {
              // Non-critical: localStorage may be disabled/full, or event dispatch may fail
              // Don't let this prevent the rename from succeeding
              console.warn('[CanvasPanel] Failed to invalidate cache or emit event:', cacheError)
            }
          }

          // Note: No dispatch needed - setIsRenaming(false) triggers re-render

        } catch (error) {
          // Check if this was an intentional abort (race condition prevention)
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('[CanvasPanel] Rename request was cancelled (superseded by newer request)')
            // Don't rollback or show error - this is expected behavior
            // The newer request will handle the update
            return
          }

          console.error('[CanvasPanel] Rename failed, rolling back:', error)

          // CRITICAL: Clear isSaving BEFORE nulling the ref (same reason as success path)
          if (renameAbortControllerRef.current === abortController) {
            setIsSaving(false)
            renameAbortControllerRef.current = null
          }

          // Rollback optimistic update
          dataStore.update(storeKey, { title: oldTitle })
          dispatch({ type: "BRANCH_UPDATED" })

          // Show error to user
          alert(`Failed to rename: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }
    setIsRenaming(false)
  }

  const handleCancelRename = () => {
    // CRITICAL: Cancel any in-flight rename request
    // Without this, a slow network response can complete after user cancels,
    // violating user intent (they cancelled, but rename happens anyway)
    if (renameAbortControllerRef.current) {
      console.log('[CanvasPanel] Aborting rename due to user cancel')
      renameAbortControllerRef.current.abort()
      renameAbortControllerRef.current = null
    }

    setIsRenaming(false)
    setIsSaving(false)
    setTitleValue(currentBranch.title || '')
  }

  const handleTypeChange = async (newType: AnnotationType) => {
    const plainProvider = getPlainProvider()
    if (!plainProvider || !noteId || panelId === 'main') return

    // Prevent concurrent type changes (race condition protection)
    if (isChangingType) {
      console.log('[CanvasPanel] Type change already in progress, ignoring')
      return
    }

    setIsChangingType(true)

    try {
      // Extract branch ID (remove 'branch-' prefix)
      const branchId = panelId.replace('branch-', '')

      const appliedType: CoreAnnotationType = isCoreAnnotationType(newType) ? newType : 'note'
      if (!isCoreAnnotationType(newType)) {
        console.warn('[CanvasPanel] Falling back to core annotation type for provider update', { branchId, requestedType: newType, appliedType })
      }

      // Call provider method which handles API call
      await plainProvider.changeBranchType(branchId, appliedType)

      // Update local state immediately (provider already updated cache)
      const current = dataStore.get(storeKey)
      if (current) {
        dataStore.update(storeKey, { type: appliedType })
      }

      // Force re-render
      dispatch({ type: "BRANCH_UPDATED" })

      // Update annotation color in main editor via context (type-safe)
      updateAnnotationType?.(branchId, appliedType)

      console.log(`✓ Changed annotation type to ${appliedType}`)
    } catch (error) {
      console.error('[CanvasPanel] Failed to change type:', error)
      alert(`Failed to change type: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      // Always reset loading state, even on error
      setIsChangingType(false)
    }
  }

  const handleUpdate = (payload: ProseMirrorJSON | string) => {
    const existing = dataStore.get(storeKey) || {}

    const previewFallback = existing.preview
      || existing.metadata?.preview
      || ''
    const isPayloadEmpty = isContentEmptyValue(payload as any)
    const computedPreview = buildBranchPreview(payload)
    const resolvedPreview = computedPreview || (isPayloadEmpty ? '' : previewFallback)
    const previewText = resolvedPreview.replace(/\s+/g, ' ').trim()

    const nextMetadata = {
      ...(currentBranch.metadata || {}),
    }

    if (previewText) {
      nextMetadata.preview = previewText
    } else {
      delete nextMetadata.preview
    }

    // CRITICAL: Don't spread entire currentBranch - it would overwrite branches array!
    // Only update content/preview/metadata, preserve branches managed by AnnotationToolbar
    const updatedData = {
      content: payload,
      preview: previewText,
      hasHydratedContent: true,
      metadata: nextMetadata,
      // Explicitly preserve other fields we care about
      type: currentBranch.type,
      position: currentBranch.position,
      title: currentBranch.title, // Preserve title to prevent overwriting during edits
    }

    // Update both stores with panel-specific content + preview
    dataStore.update(storeKey, updatedData)
    
    // Also update in CollaborationProvider
    const branchData = branchesMap.get(storeKey)
    if (branchData) {
      branchData.content = payload
      branchData.preview = previewText
      branchesMap.set(storeKey, branchData)
    } else {
      // If not in YJS yet, add the full data
      branchesMap.set(storeKey, updatedData)
    }
    
    // Show auto-save indicator
    // CRITICAL FIX: Use storeKey (which includes noteId) to ensure unique ID across multiple notes
    const autoSave = document.getElementById(`auto-save-${storeKey}`)
    if (autoSave) {
      autoSave.style.opacity = '1'
      setTimeout(() => {
        autoSave.style.opacity = '0'
      }, 2000)
    }

    // Force re-render to update branch displays
    dispatch({ type: "BRANCH_UPDATED" })
  }

  const handleSelectionChange = (text: string, range: Range | null) => {
    dispatch({
      type: "SET_SELECTION",
      payload: {
        text,
        range,
        panel: text.length > 0 ? panelId : null,
      },
    })

    // Don't show toolbar on text selection - only show via Actions button
  }

  const handleToggleEditing = () => {
    const newEditableState = !isEditing
    setIsEditing(newEditableState)

    const toggleBtn = document.querySelector(`#toolbar-${panelId} .toolbar-btn.special`) as HTMLButtonElement
    if (toggleBtn) {
      toggleBtn.innerHTML = newEditableState ? '💾 Save' : '📝 Edit'
      toggleBtn.title = newEditableState ? 'Save Changes' : 'Edit Content'
    }

    dataStore.update(storeKey, { isEditable: newEditableState })

    if (newEditableState) {
      editorRef.current?.focus()
    }
  }

  // Fetch available folders with nested structure
  const fetchSaveAsFolders = useCallback(async () => {
    try {
      // Fetch all folders (not just root level)
      const response = await fetch('/api/items?type=folder')
      if (!response.ok) return

      const data = await response.json()
      const allFolders = data.items?.filter((item: any) => item.type === 'folder') || []

      // Build hierarchy with depth calculation
      const folderMap = new Map()
      allFolders.forEach((folder: any) => {
        folderMap.set(folder.id, folder)
      })

      // Calculate depth for each folder based on path
      const foldersWithDepth = allFolders.map((folder: any) => {
        const pathParts = folder.path.split('/').filter(Boolean)
        return {
          id: folder.id,
          name: folder.name,
          path: folder.path,
          parentId: folder.parentId,
          depth: pathParts.length - 1 // Root folders have depth 0
        }
      })

      // Sort by path to maintain hierarchical order
      foldersWithDepth.sort((a: any, b: any) => a.path.localeCompare(b.path))

      setSaveAsAvailableFolders(foldersWithDepth)
    } catch (error) {
      console.error('[CanvasPanel] Failed to fetch folders:', error)
    }
  }, [])

  // Create new folder (from notes-explorer)
  const createSaveAsFolder = async (folderName: string, parentId?: string) => {
    try {
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'folder',
          name: folderName,
          parentId: parentId || null,
          metadata: {}
        })
      })

      if (!response.ok) throw new Error('Failed to create folder')

      const data = await response.json()
      return data.item
    } catch (error) {
      console.error('[CanvasPanel] Failed to create folder:', error)
      return null
    }
  }

  // Load dialog when opened (from notes-explorer)
  useEffect(() => {
    console.log('[SaveAs] showSaveAsDialog changed to:', showSaveAsDialog)
    if (showSaveAsDialog) {
      console.log('[SaveAs] Loading dialog data...')

      // Generate a fresh name with current timestamp
      const timestamp = new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
      const defaultName = `New Note - ${timestamp}`

      setSaveAsNoteName(defaultName)
      fetchSaveAsFolders()
    }
  }, [showSaveAsDialog, fetchSaveAsFolders])

  // Handle Save As - creates a new note with the branch content
  const createSaveAsNote = async () => {
    try {
      const result = await createNote({
        name: saveAsNoteName.trim() || "Untitled",
        parentId: saveAsSelectedFolderId,
        metadata: {
          branchType: currentBranch.type,
          savedFrom: panelId,
          savedAt: new Date().toISOString()
        }
      })

      if (result.success && result.noteId) {
        console.log('[CanvasPanel] Note created, saving content to:', result.noteId)

        // Get current content from editor or branch
        const currentContent = (editorRef.current as any)?.getJSON?.() || currentBranch.content

        if (!currentContent) {
          console.warn('[CanvasPanel] No content to save')
        }

        // Copy the content to the new note
        // Use 'main' as panelId since this is a new standalone note
        try {
          await fetch(`/api/postgres-offline/documents/${result.noteId}/main`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: currentContent,
              version: 1,
              baseVersion: 0
            })
          })
          console.log('[CanvasPanel] Content copied to new note successfully')

          // Update the current panel to reflect the new note
          dataStore.update(storeKey, {
            ...currentBranch,
            title: saveAsNoteName.trim() || "Untitled",
            noteId: result.noteId
          })

          // Update the note name in the database so it appears correctly in recent/organization
          if (currentNoteId) {
            try {
              await fetch(`/api/items/${result.noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: saveAsNoteName.trim() || "Untitled"
                })
              })
              console.log('[CanvasPanel] Note name updated in database')
            } catch (updateError) {
              console.error('[CanvasPanel] Failed to update note name in database:', updateError)
            }
          }

          // Force re-render to show updated title
          dispatch({ type: "BRANCH_UPDATED" })

          alert(`Note "${saveAsNoteName}" created successfully with content!`)
        } catch (saveError) {
          console.error('[CanvasPanel] Failed to save content to new note:', saveError)
          alert(`Note "${saveAsNoteName}" created, but content copy failed. Please edit the new note manually.`)
        }

        // Close dialog and reset
        setShowSaveAsDialog(false)
        setSaveAsNoteName("")
        setSaveAsSelectedFolderId(null)
        setSaveAsAvailableFolders([])
        setSaveAsIsCreatingFolder(false)
        setSaveAsNewFolderName("")
        setSaveAsShowCustomFolder(false)
        setSaveAsCustomFolderInput("")
      } else {
        throw new Error(result.error || 'Failed to create note')
      }
    } catch (error) {
      console.error('[CanvasPanel] Save As failed:', error)
      alert('Failed to save note. Please try again.')
    }
  }

  // Listen for insert-annotation events at the panel level
  useEffect(() => {
    const handleInsertAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent
      const { type, annotationId, branchId } = customEvent.detail
      
      // Insert the annotation using the editor's command
      if (editorRef.current) {
        editorRef.current.insertAnnotation(type, annotationId, branchId)
      } else {
        console.warn('Editor ref not available for annotation insertion')
      }
    }

    // Listen for global insert-annotation events
    const handleGlobalInsertAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent
      if (customEvent.detail.panelId === panelId) {
        handleInsertAnnotation(event)
      }
    }

    // Add event listeners
    const panel = panelRef.current
    if (panel) {
      panel.addEventListener('insert-annotation', handleInsertAnnotation)
    }
    window.addEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
    
    return () => {
      if (panel) {
        panel.removeEventListener('insert-annotation', handleInsertAnnotation)
      }
      window.removeEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
    }
  }, [panelId])

  const generateBreadcrumb = () => {
    const breadcrumbs = []
    let currentId = panelId

    while (currentId) {
      const currentStoreKey = ensurePanelKey(effectiveNoteId, currentId)
      if (!dataStore.has(currentStoreKey)) break

      const currentBranch = dataStore.get(currentStoreKey)
      breadcrumbs.unshift({
        id: currentId,
        title: currentBranch.title,
      })
      currentId = currentBranch.parentId
    }

    if (breadcrumbs.length <= 1) return null

    return breadcrumbs.map((crumb, index) => (
      <span key={crumb.id}>
        {index === breadcrumbs.length - 1 ? (
          <span>{crumb.title}</span>
        ) : (
          <span className="cursor-pointer text-indigo-600 hover:underline">
            {crumb.title}
          </span>
        )}
        {index < breadcrumbs.length - 1 && <span className="mx-1 text-gray-400">›</span>}
      </span>
    ))
  }

  // Panel dragging logic
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }

    const header = panel.querySelector('.panel-header') as HTMLElement
    if (!header) {
      return
    }
    
    // Update header cursor based on layer state
    const updateHeaderCursor = () => {
      if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
        header.style.cursor = 'not-allowed'
      } else {
        header.style.cursor = 'move'
      }
    }
    updateHeaderCursor()
    
    const handleMouseDown = (e: MouseEvent) => {
      // Don't start drag if clicking on any button (close, layer actions, lock/unlock)
      const target = e.target instanceof Element ? e.target : null
      if (target && target.closest('button')) {
        return
      }

      // Block drag if popup layer is active - USE REFS for current values
      if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      dragState.current.isDragging = true

      // Notify editor to defer heavy operations
      const perfSetter = (editorRef.current as any)?.setPerformanceMode
      if (typeof perfSetter === 'function') {
        perfSetter(true)
      }

      // Get current panel position from style
      const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
      const currentTop = parseInt(panel.style.top || position.y.toString(), 10)

      // DEBUG: Log initial position sources
      debugLog({
        component: 'CanvasPanel',
        action: 'drag_init_position_sources',
        metadata: {
          panelId,
          styleLeft: panel.style.left,
          styleTop: panel.style.top,
          positionProp: position,
          canvasNodePosition: canvasNode?.position,
          renderPosition,
          computedLeft: currentLeft,
          computedTop: currentTop
        }
      })

      // Store initial position
      dragState.current.initialPosition = { x: currentLeft, y: currentTop }
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
      dragState.current.pointerDelta = { x: 0, y: 0 }
      dragState.current.autoScrollOffset = { x: 0, y: 0 }
      dragState.current.mouseMoveCount = 0
      dragState.current.lastMoveTime = performance.now()
      dragState.current.lastPosition = { x: currentLeft, y: currentTop }

      // DEBUG: Log drag initialization
      debugLog({
        component: 'CanvasPanel',
        action: 'drag_start',
        metadata: {
          panelId,
          initialPosition: { x: currentLeft, y: currentTop },
          cursorPosition: { x: e.clientX, y: e.clientY },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight
          },
          distanceToLeftEdge: e.clientX,
          distanceToRightEdge: window.innerWidth - e.clientX,
          distanceToTopEdge: e.clientY,
          distanceToBottomEdge: window.innerHeight - e.clientY,
          autoScrollThreshold: 80,
          cameraEnabled: isCameraEnabled,
          canvasState: {
            translateX: state.canvasState?.translateX || 0,
            translateY: state.canvasState?.translateY || 0,
            zoom: state.canvasState?.zoom || 1
          }
        }
      })

      // Update render position to current position when starting drag
      setRenderPosition({ x: currentLeft, y: currentTop })

      // Prepare panel for dragging
      panel.style.transition = 'none'

      // Bring panel to front while dragging
      // Always use LayerManager for focus/z-index management
      if (layerManager.isEnabled) {
        layerManager.focusNode(storeKey) // This brings to front and updates focus time
      }
      globalDraggingPanelId = panelId

      // Prevent text selection while dragging
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'move'
      panel.style.cursor = 'move'

      e.preventDefault()
      e.stopPropagation()
    }

    // RAF-throttled position update function
    const updatePanelPosition = () => {
      const state = dragState.current
      if (!state.isDragging || !state.pendingMouseEvent || !panelRef.current) {
        state.rafScheduled = false
        return
      }

      const e = state.pendingMouseEvent
      const now = performance.now()
      const timeDelta = now - state.lastMoveTime

      // Calculate position from pending mouse event
      const deltaX = e.clientX - state.startX
      const deltaY = e.clientY - state.startY

      state.pointerDelta = { x: deltaX, y: deltaY }

      const baseX = state.initialPosition.x + deltaX
      const baseY = state.initialPosition.y + deltaY
      const newLeft = isCameraEnabled ? baseX - state.autoScrollOffset.x : baseX
      const newTop = isCameraEnabled ? baseY - state.autoScrollOffset.y : baseY

      // Calculate position change from last frame
      const positionDeltaX = newLeft - state.lastPosition.x
      const positionDeltaY = newTop - state.lastPosition.y
      const positionDeltaMagnitude = Math.sqrt(positionDeltaX * positionDeltaX + positionDeltaY * positionDeltaY)

      // DEBUG: Log jitter metrics for moves 5-20
      if (state.mouseMoveCount >= 5 && state.mouseMoveCount <= 20) {
        debugLog({
          component: 'CanvasPanel',
          action: 'drag_jitter_raf_no_react',
          metadata: {
            panelId,
            moveCount: state.mouseMoveCount,
            timeDelta,
            positionDelta: { x: positionDeltaX, y: positionDeltaY },
            positionDeltaMagnitude,
            autoScrollOffset: { ...state.autoScrollOffset },
            cursorPosition: { x: e.clientX, y: e.clientY },
            calculatedPosition: { x: newLeft, y: newTop },
            hasAutoScrollInterference: state.autoScrollOffset.x !== 0 || state.autoScrollOffset.y !== 0,
            hasDecimalPrecision: newLeft % 1 !== 0 || newTop % 1 !== 0,
            rafThrottled: true,
            reactStateUpdateSkipped: true  // No setRenderPosition during drag
          }
        })
      }

      // Apply position update (DOM only - no React state during drag)
      panelRef.current.style.left = newLeft + 'px'
      panelRef.current.style.top = newTop + 'px'

      // DON'T call setRenderPosition during drag - causes re-render jitter
      // We'll update React state only when drag ends

      // Update tracking for next frame
      state.lastMoveTime = now
      state.lastPosition = { x: newLeft, y: newTop }
      state.pendingMouseEvent = null
      state.rafScheduled = false
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return

      const state = dragState.current
      state.mouseMoveCount++

      // Store the latest mouse event
      state.pendingMouseEvent = { clientX: e.clientX, clientY: e.clientY }

      // Calculate distances to edges
      const distanceToLeft = e.clientX
      const distanceToRight = window.innerWidth - e.clientX
      const distanceToTop = e.clientY
      const distanceToBottom = window.innerHeight - e.clientY
      const threshold = 50 // Updated to match useAutoScroll threshold

      // Determine if near any edge
      const nearLeftEdge = distanceToLeft < threshold
      const nearRightEdge = distanceToRight < threshold
      const nearTopEdge = distanceToTop < threshold
      const nearBottomEdge = distanceToBottom < threshold
      const nearAnyEdge = nearLeftEdge || nearRightEdge || nearTopEdge || nearBottomEdge

      // DEBUG: Log mouse movement and edge proximity
      debugLog({
        component: 'CanvasPanel',
        action: 'drag_mouse_move',
        metadata: {
          panelId,
          moveCount: state.mouseMoveCount,
          cursorPosition: { x: e.clientX, y: e.clientY },
          distanceToEdges: {
            left: distanceToLeft,
            right: distanceToRight,
            top: distanceToTop,
            bottom: distanceToBottom
          },
          nearEdge: {
            left: nearLeftEdge,
            right: nearRightEdge,
            top: nearTopEdge,
            bottom: nearBottomEdge,
            any: nearAnyEdge
          },
          threshold,
          aboutToCheckAutoScroll: true,
          dragState: {
            pointerDelta: { ...state.pointerDelta },
            autoScrollOffset: { ...state.autoScrollOffset }
          }
        }
      })

      // Check for auto-scroll when near edges
      checkAutoScroll(e.clientX, e.clientY)

      // Schedule RAF update if not already scheduled
      if (!state.rafScheduled) {
        state.rafScheduled = true
        rafIdRef.current = requestAnimationFrame(updatePanelPosition)
      }

      e.preventDefault()
    }

    const finalizeDrag = (event?: MouseEvent | PointerEvent | FocusEvent) => {
      if (!dragState.current.isDragging) return

      // Cancel any pending RAF update
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }

      // Stop auto-scroll when dragging ends
      stopAutoScroll()

      dragState.current.isDragging = false
      dragState.current.rafScheduled = false
      dragState.current.pendingMouseEvent = null
      globalDraggingPanelId = null
      
      // Re-enable normal editor operations
      const perfSetter = (editorRef.current as any)?.setPerformanceMode
      if (typeof perfSetter === 'function') {
        perfSetter(false)
      }
      
      // Get final position from current style
      const finalX = parseInt(panel.style.left, 10)
      const finalY = parseInt(panel.style.top, 10)

      // DEBUG: Log drag end with all position sources
      debugLog({
        component: 'CanvasPanel',
        action: 'drag_end',
        metadata: {
          panelId,
          finalPosition: { x: finalX, y: finalY },
          renderPosition,
          propPosition: position,
          dragState: {
            initialPosition: { ...dragState.current.initialPosition },
            pointerDelta: { ...dragState.current.pointerDelta },
            autoScrollOffset: { ...dragState.current.autoScrollOffset }
          }
        }
      })

      // Clean up global dragging state
      if (globalDraggingPanelId === panelId) {
        globalDraggingPanelId = null
      }

      // Update render position to final position
      setRenderPosition({ x: finalX, y: finalY })

      // DEBUG: Log before persistence
      debugLog({
        component: 'CanvasPanel',
        action: 'drag_end_persisting',
        metadata: {
          panelId,
          finalPosition: { x: finalX, y: finalY },
          coordinateSpace: 'world'
        }
      })

      // Persist to database - StateTransaction will update all stores atomically
      // finalX/finalY are already in world-space (from panel.style.left/top)
      persistPanelUpdate({
        panelId,
        storeKey: ensurePanelKey(effectiveNoteId, panelId),  // Composite key for multi-note support
        position: { x: finalX, y: finalY },
        coordinateSpace: 'world'  // CRITICAL: These coordinates are already world-space
      }).catch(err => {
        console.error('[CanvasPanel] Panel persistence failed:', err)
      })

      if (panelId === 'main' && effectiveNoteId) {
        void updateMainPosition(effectiveNoteId, { x: finalX, y: finalY }).catch(error => {
          console.error('[CanvasPanel] Failed to update workspace main position:', error)
        })
      }

      // Reset camera pan accumulation if using camera mode
      if (isCameraEnabled) {
        resetPanAccumulation()
      }

      dragState.current.pointerDelta = { x: 0, y: 0 }
      dragState.current.autoScrollOffset = { x: 0, y: 0 }
      
      // Reset cursor
      document.body.style.userSelect = ''
      document.body.style.cursor = ''

      if (event instanceof MouseEvent) {
        event.preventDefault()
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      finalizeDrag(e)
    }

    const handlePointerUp = (e: PointerEvent) => {
      finalizeDrag(e)
    }

    const handleWindowBlur = (e: FocusEvent) => {
      finalizeDrag(e)
    }

    // Add event listeners
    header.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('pointerup', handlePointerUp, { capture: true })
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      // Clean up event listeners
      header.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('blur', handleWindowBlur)
      
      // Stop auto-scroll on cleanup
      stopAutoScroll()
      
      // Reset any lingering styles
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [
    checkAutoScroll,
    stopAutoScroll,
    panelId,
    isCameraEnabled,
    resetPanAccumulation,
    persistPanelUpdate,
    updateMainPosition,
    effectiveNoteId
  ]) // Add auto-scroll functions, camera deps, persistence helpers, and note context as dependencies

  // Update cursor when layer state changes
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    
    const header = panel.querySelector('.panel-header') as HTMLElement
    if (!header) return
    
    if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
      header.style.cursor = 'not-allowed'
    } else {
      header.style.cursor = 'move'
    }
  }, [layerContext?.activeLayer]) // Re-run when active layer changes

  const isMainPanel = panelId === 'main'
  const showToolbar = isMainPanel || isEditing

  // Reinforce focus after mount or load when entering edit mode (Option A only)
  useEffect(() => {
    if (!isPlainMode) return
    if (isEditing && !isContentLoading && editorRef.current && isLayerInteractive) {
      const delays = [50, 200, 400]
      delays.forEach((d) => setTimeout(() => {
        // Double-check layer state at time of focus
        if (layerContextRef.current?.activeLayer === 'notes' || !multiLayerEnabledRef.current) {
          editorRef.current?.focus()
        }
      }, d))
    }
  }, [isEditing, isContentLoading, isPlainMode, isLayerInteractive])

  // Registration happens in onClick handler above (when panel is clicked)

  // Filter branches based on active filter
  // In plain mode, get branches from dataStore; otherwise use provider
  const allBranches = isPlainMode
    ? (dataStore.get(storeKey)?.branches || [])
    : (provider.getBranches ? provider.getBranches(panelId) : [])
  const filteredBranches = allBranches.filter((branchId: string) => {
    if (activeFilter === 'all') return true

    // Try to get branch from provider first, then dataStore
    const branchStoreKey = ensurePanelKey(effectiveNoteId, branchId)
    const providerChild = branchesMap.get(branchStoreKey)
    const storeChild = dataStore.get(branchStoreKey)
    const childBranch = providerChild || storeChild
    
    // If we can't find the branch data, include it anyway for 'all' filter
    if (!childBranch) {
      return false
    }
    
    return childBranch.type === activeFilter
  })

  // Force re-render when branches change
  useEffect(() => {
    // In plain mode, listen for dataStore updates
    if (isPlainMode) {
      // Set up listener for dataStore changes
      const handleDataStoreUpdate = (updatedPanelId: string) => {
        // Defer state updates to avoid React warning
        setTimeout(() => {
          // If this panel or its branches were updated, force re-render
          if (updatedPanelId === panelId || dataStore.get(storeKey)?.branches?.includes(updatedPanelId)) {
            setLastBranchUpdate(Date.now())
            forceUpdate()
          }
        }, 0)
      }
      
      // Listen for dataStore updates
      dataStore.on('update', handleDataStoreUpdate)
      dataStore.on('set', handleDataStoreUpdate)
      
      return () => {
        dataStore.off('update', handleDataStoreUpdate)
        dataStore.off('set', handleDataStoreUpdate)
      }
    }
    
    // Check if branchesMap has observe method (Yjs Map)
    if (!branchesMap || typeof branchesMap.observe !== 'function') {
      // Plain JavaScript Map, no observation needed
      return
    }
    
    const updateHandler = (event: any) => {
      // Defer state updates to avoid React warning
      setTimeout(() => {
        // Check if this panel's branches were updated
        if (event && event.keysChanged && event.keysChanged.has(panelId)) {
          setLastBranchUpdate(Date.now())
        }
        
        forceUpdate()
      }, 0)
    }
    
    // Listen for changes to the YJS native structure
    const branchesArrayUpdateHandler = () => {
      // Defer state updates to avoid React warning
      setTimeout(() => {
        setLastBranchUpdate(Date.now())
        forceUpdate()
      }, 0)
    }
    
    // Listen for any changes to the branches map (legacy)
    branchesMap.observe(updateHandler)
    
    // Listen for changes to the YJS native branches array
    try {
      const structure = provider.getDocumentStructure && provider.getDocumentStructure()
      if (structure && structure.getBranchesArray) {
        const branchesArray = structure.getBranchesArray(panelId)
        if (branchesArray && typeof branchesArray.observe === 'function') {
          branchesArray.observe(branchesArrayUpdateHandler)
          
          return () => {
            branchesMap.unobserve(updateHandler)
            branchesArray.unobserve(branchesArrayUpdateHandler)
          }
        }
      }
      
      // Fallback to legacy observation only
      return () => {
        branchesMap.unobserve(updateHandler)
      }
    } catch {
      // Fallback to legacy observation only
      return () => {
        branchesMap.unobserve(updateHandler)
      }
    }
  }, [panelId, forceUpdate, branchesMap, provider, isPlainMode])

  // Calculate position for branch panel relative to parent
  const calculateBranchPanelPosition = () => {
    const currentPanel = panelRef.current
    let parentPosition = { x: 2000, y: 1500 } // Default position
    
    if (currentPanel) {
      // Get the actual panel dimensions
      const rect = currentPanel.getBoundingClientRect()
      const panelWidth = rect.width || 800 // Fallback to 800 if width not available
      const gap = 50 // Gap between panels
      
      // Get the transform values from the panel's style
      const style = window.getComputedStyle(currentPanel)
      const transform = style.transform
      
      if (transform && transform !== 'none') {
        // Extract translation values from the transform matrix
        const matrix = new DOMMatrixReadOnly(transform)
        const currentX = matrix.m41
        const currentY = matrix.m42
        
        // Smart positioning logic:
        // 1. Check if there are already panels on either side
        // 2. Prefer right side by default
        // 3. Use left if right side would go too far (beyond viewport or x > 4000)
        // 4. Alternate sides if multiple branches are opened
        
        // Get all existing panels to check for collisions
        const allPanels = document.querySelectorAll('[data-panel-id]')
        let rightOccupied = false
        let leftOccupied = false
        
        allPanels.forEach((panel) => {
          if (panel === currentPanel) return
          
          const panelStyle = window.getComputedStyle(panel)
          const panelTransform = panelStyle.transform
          
          if (panelTransform && panelTransform !== 'none') {
            const panelMatrix = new DOMMatrixReadOnly(panelTransform)
            const panelX = panelMatrix.m41
            
            // Check if a panel is already on the right
            if (panelX > currentX + panelWidth && 
                panelX < currentX + panelWidth + gap + 100) {
              rightOccupied = true
            }
            
            // Check if a panel is already on the left
            if (panelX < currentX - gap && 
                panelX > currentX - panelWidth - gap - 100) {
              leftOccupied = true
            }
          }
        })
        
        // Decide placement based on occupancy and viewport constraints
        let placeOnLeft = false
        
        if (!rightOccupied && !leftOccupied) {
          // Neither side occupied - check viewport constraints
          const viewportWidth = window.innerWidth
          const rightEdgePosition = currentX + panelWidth + gap + panelWidth
          
          // Place on left if right would exceed viewport or go beyond x=4000
          placeOnLeft = rightEdgePosition > viewportWidth || currentX > 2500
        } else if (rightOccupied && !leftOccupied) {
          // Right is occupied, left is free
          placeOnLeft = true
        } else if (!rightOccupied && leftOccupied) {
          // Left is occupied, right is free
          placeOnLeft = false
        } else {
          // Both sides occupied - stack on the right with offset
          placeOnLeft = false
          // Add vertical offset to avoid complete overlap
          parentPosition.y = currentY + 100
        }
        
        // Position the new panel to the left or right of the parent with gap
        parentPosition = {
          x: placeOnLeft 
            ? currentX - panelWidth - gap // Panel width + gap on the left
            : currentX + panelWidth + gap, // Panel width + gap on the right
          y: parentPosition.y || currentY // Use offset Y if set, otherwise same vertical position
        }
      } else {
        // Fallback: try to get position from data stores
        const panelData = isPlainMode 
          ? dataStore.get(storeKey) 
          : branchesMap.get(storeKey)
        
        if (panelData?.position) {
          // Simple fallback logic when transform not available
          const placeOnLeft = panelData.position.x > 2500
          parentPosition = {
            x: placeOnLeft 
              ? panelData.position.x - panelWidth - gap 
              : panelData.position.x + panelWidth + gap,
            y: panelData.position.y
          }
        }
      }
    }
    
    return parentPosition
  }

  // Handle branch click to open panel
  const handleBranchClick = (branchId: string) => {
    // Check if branch exists before creating panel
    const branchExists = branchesMap.has(branchId) || dataStore.has(branchId)
    if (!branchExists) {
      console.warn(`Branch ${branchId} not found`)
      return
    }
    
    // Get position for the new panel
    const parentPosition = calculateBranchPanelPosition()
    
    // Dispatch event to create panel with parent position
    window.dispatchEvent(new CustomEvent('create-panel', { 
      detail: { 
        panelId: branchId,
        parentPanelId: panelId,
        parentPosition: parentPosition,
        noteId
      },
      bubbles: true 
    }))
  }

  return (
    <>
      {/* Edge Glow Visual Affordance - Portal to document.body */}
      {typeof window !== 'undefined' && edgeGlowEdges.length > 0 && createPortal(
        <div className="auto-scroll-edge-glows">
          {edgeGlowEdges.map(edge => (
            <React.Fragment key={edge}>
              {/* Edge glow line */}
              <div
                className={`auto-scroll-edge-glow auto-scroll-edge-glow-${edge.toLowerCase()}`}
                style={{
                  position: 'fixed',
                  zIndex: 999999,
                  pointerEvents: 'none',
                  ...(edge === 'TOP' && {
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  background: '#fbbf24',
                  boxShadow: '0 0 40px rgba(251, 191, 36, 1), 0 0 80px rgba(251, 191, 36, 0.8), 0 0 120px rgba(251, 191, 36, 0.6)'
                }),
                ...(edge === 'BOTTOM' && {
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  background: '#fbbf24',
                  boxShadow: '0 0 40px rgba(251, 191, 36, 1), 0 0 80px rgba(251, 191, 36, 0.8), 0 0 120px rgba(251, 191, 36, 0.6)'
                }),
                ...(edge === 'LEFT' && {
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: '4px',
                  background: '#fbbf24',
                  boxShadow: '0 0 40px rgba(251, 191, 36, 1), 0 0 80px rgba(251, 191, 36, 0.8), 0 0 120px rgba(251, 191, 36, 0.6)'
                }),
                ...(edge === 'RIGHT' && {
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: '4px',
                  background: '#fbbf24',
                  boxShadow: '0 0 40px rgba(251, 191, 36, 1), 0 0 80px rgba(251, 191, 36, 0.8), 0 0 120px rgba(251, 191, 36, 0.6)'
                })
              }}
            />

            {/* Directional icon with text */}
            <div
              className="auto-scroll-icon"
              style={{
                position: 'fixed',
                zIndex: 999999,
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(0, 0, 0, 0.7)',
                padding: '8px 12px',
                borderRadius: '8px',
                opacity: 0.9,
                ...(edge === 'TOP' && {
                  top: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)'
                }),
                ...(edge === 'BOTTOM' && {
                  bottom: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)'
                }),
                ...(edge === 'LEFT' && {
                  left: '20px',
                  top: '50%',
                  transform: 'translateY(-50%)'
                }),
                ...(edge === 'RIGHT' && {
                  right: '20px',
                  top: '50%',
                  transform: 'translateY(-50%)'
                })
              }}
            >
              {/* Arrow icon */}
              <div style={{
                fontSize: '24px',
                color: '#fbbf24',
                transform: edge === 'TOP' ? 'rotate(-90deg)' : edge === 'BOTTOM' ? 'rotate(90deg)' : edge === 'LEFT' ? 'rotate(180deg)' : 'rotate(0deg)'
              }}>
                →
              </div>

              {/* Text label */}
              <div style={{
                fontSize: '11px',
                color: '#fff',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                textShadow: '0 1px 2px rgba(0,0,0,0.5)'
              }}>
                Hold to scroll
              </div>
            </div>
          </React.Fragment>
          ))}
          <style jsx>{`
            @keyframes edgeGlowFadeIn {
              from {
                opacity: 0;
                transform: scale(0.95);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }
            @keyframes edgeGlowPulse {
              0%, 100% {
                opacity: 0.6;
              }
              50% {
                opacity: 1;
              }
            }
            .auto-scroll-edge-glow {
              animation: edgeGlowFadeIn 0.3s ease-out forwards, edgeGlowPulse 1.5s ease-in-out infinite;
            }
          `}</style>
        </div>,
        document.body
      )}

      <div
        ref={panelRef}
        className={`panel ${currentBranch.type}`}
        id={`panel-${panelId}`}
        data-store-key={storeKey}
      onClick={() => {
        // Register this panel's editor as active when panel is clicked
        // Pass composite key (storeKey) so FloatingToolbar can identify correct panel in shared workspace
        if (editorRef.current && onRegisterActiveEditor) {
          onRegisterActiveEditor(editorRef.current, storeKey)
        }
      }}
      onMouseEnter={() => {
        if (panelHoverHideTimeoutRef.current) {
          clearTimeout(panelHoverHideTimeoutRef.current)
          panelHoverHideTimeoutRef.current = null
        }
        if (panelHoverShowTimeoutRef.current) {
          clearTimeout(panelHoverShowTimeoutRef.current)
        }

        if (isPanelHovered) {
          panelHoverShowTimeoutRef.current = null
          return
        }

        panelHoverShowTimeoutRef.current = setTimeout(() => {
          setIsPanelHovered(true)
          panelHoverShowTimeoutRef.current = null
        }, HEADER_BUTTON_HOVER_DELAY_MS)
      }}
      onMouseLeave={() => {
        if (panelHoverShowTimeoutRef.current) {
          clearTimeout(panelHoverShowTimeoutRef.current)
          panelHoverShowTimeoutRef.current = null
        }
        if (panelHoverHideTimeoutRef.current) {
          clearTimeout(panelHoverHideTimeoutRef.current)
        }

        panelHoverHideTimeoutRef.current = setTimeout(() => {
          // Only hide if no popups are visible
          if (!isActionsVisible && !isActionsHovering) {
            setIsPanelHovered(false)
          }
          panelHoverHideTimeoutRef.current = null
        }, HEADER_BUTTON_HOVER_DELAY_MS)
      }}
      style={{
        position: 'absolute',
        left: renderPosition.x + 'px',
        top: renderPosition.y + 'px',
        width: `${panelWidth}px`,
        height: `${panelHeight}px`,
        maxHeight: isPanelHeightExpanded ? 'none' : '80vh',
        background: isIsolated ? '#fff5f5' : 'white',
        borderRadius: '16px',
        boxShadow: panelBoxShadow,
        transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        transform: isHighlighting ? 'scale(1.01)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: zIndex,
        border: isIsolated ? '2px solid #ef4444' : 'none',
      }}
    >
      {/* Panel Header */}
      <div 
        className="panel-header"
        style={{
          background: currentBranch.type === 'main' 
            ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
            : currentBranch.type === 'note'
            ? 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)'
            : currentBranch.type === 'explore'
            ? 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)'
            : 'linear-gradient(135deg, #27ae60 0%, #229954 100%)',
          padding: '12px 20px',
          height: '56px',
          minHeight: '56px',
          maxHeight: '56px',
          color: 'white',
          fontWeight: 600,
          fontSize: '16px',
          cursor: 'move',
          userSelect: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'auto',
          borderBottom: isIsolated ? '3px solid #ef4444' : 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          flex: '0 0 auto',
        }}>
          {/* Lock and Close buttons - moved to left side before title */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            opacity: headerControlsActive ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: headerControlsActive ? 'auto' : 'none'
          }}>
            {/* Lock/Unlock button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                const debug = (window as any).__isolationDebug
                if (debug) {
                  if (isIsolated) {
                    debug.restore(panelId)
                  } else {
                    debug.isolate(panelId)
                  }
                }
              }}
              style={{
                background: isIsolated ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                color: 'white',
                fontSize: '12px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isIsolated ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.3)'
                e.currentTarget.style.transform = 'scale(1.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isIsolated ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.2)'
                e.currentTarget.style.transform = 'scale(1)'
              }}
              title={isIsolated ? 'Restore panel' : 'Isolate panel'}
            >
              {isIsolated ? '🔓' : '🔒'}
            </button>

            {onClose && (
              <button
                className="panel-close"
                onClick={onClose}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontSize: '14px',
                  color: 'white',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                  e.currentTarget.style.transform = 'scale(1.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
                title="Close panel"
              >
                ×
              </button>
            )}
          </div>

          {/* Type Selector - only for branch panels */}
          {panelId !== 'main' && currentBranch.type && currentBranch.type !== 'main' && (
            <TypeSelector
              currentType={currentBranch.type as AnnotationType}
              onTypeChange={handleTypeChange}
              disabled={isChangingType}
            />
          )}

          {/* Panel Title */}
          {showPanelTitle && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              overflow: 'hidden',
              flex: 1,
            }}>
              {isRenaming ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleValue}
                  disabled={isSaving}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSaveRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      handleCancelRename()
                    }
                  }}
                  onBlur={handleSaveRename}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: isSaving ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.9)',
                    color: isSaving ? '#95a5a6' : '#2c3e50',
                    border: '2px solid rgba(255,255,255,0.5)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '16px',
                    fontWeight: 600,
                    outline: 'none',
                    width: '250px',
                    cursor: isSaving ? 'wait' : 'text',
                    opacity: isSaving ? 0.7 : 1,
                  }}
                />
              ) : (
                <div className="group" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  maxWidth: '300px',
                }}>
                  <span style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{panelTitle}</span>
                  {/* Hover pencil icon for quick rename - inline with title */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartRename()
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: 'rgba(255,255,255,0.2)',
                      border: 'none',
                      borderRadius: '50%',
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      flexShrink: 0,
                      color: 'white',
                      padding: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                    }}
                    title="Rename panel"
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              )}
              {isIsolated && currentBranch.type !== 'main' && (
                <span style={{
                  background: '#ef4444',
                  color: 'white',
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                }}>
                  ISOLATED
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Right side buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: headerControlsActive ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: headerControlsActive ? 'auto' : 'none',
            position: 'relative',
            justifyContent: 'flex-end',
            flex: (currentBranch.type === 'main' || headerControlsActive) ? '1 1 auto' : '0 1 auto',
            marginLeft: 'auto'
          }}
        >
          {layerManager.isEnabled && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (layerManager.isEnabled) {
                  layerManager.bringToFront(storeKey)
                  }
                }}
                disabled={layerBandInfo?.isAtTop}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: layerBandInfo?.isAtTop ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'white',
                  fontSize: '12px',
                  opacity: layerBandInfo?.isAtTop ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!layerBandInfo?.isAtTop) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                }}
                title="Bring to front"
              >
                ↑
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (layerManager.isEnabled) {
                  layerManager.sendToBack(storeKey)
                  }
                }}
                disabled={layerBandInfo?.isAtBottom}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: layerBandInfo?.isAtBottom ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'white',
                  fontSize: '12px',
                  opacity: layerBandInfo?.isAtBottom ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!layerBandInfo?.isAtBottom) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                }}
                title="Send to back"
              >
                ↓
              </button>
            </>
          )}

          {/* Tools button */}
          <button
              onClick={(e) => {
                e.stopPropagation()
                setShowToolsDropdown(!showToolsDropdown)
              }}
              style={{
                background: showToolsDropdown ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                color: 'white',
                fontSize: '12px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = showToolsDropdown ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)'
              }}
              title="Panel Tools"
            >
              <Wrench size={14} />
            </button>

          {/* Save As button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              console.log('[SaveAs] Button clicked, current state:', showSaveAsDialog)
              setShowSaveAsDialog(true)
              console.log('[SaveAs] State set to true')
            }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              color: 'white',
              fontSize: '12px',
              pointerEvents: 'auto', // Ensure button is always clickable
              position: 'relative',
              zIndex: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
              console.log('[SaveAs] Button hovered')
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
            }}
            title="Save branch as new note"
          >
            <Save className="w-3 h-3" />
            <span>Save As</span>
          </button>
        </div>

      </div>

      {/* Check if isolated and show placeholder */}
      {isIsolated ? (
        <div style={{ padding: '20px' }}>
          {placeholder}
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Editor Section */}
          <div style={{
            flex: 1,
            padding: '20px 25px 25px 25px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}>
          {/* Auto Save Indicator */}
          <div
            id={`auto-save-${storeKey}`}
            style={{
              position: 'absolute',
              top: '12px',
              right: '15px',
              padding: '4px 8px',
              background: '#28a745',
              color: 'white',
              borderRadius: '12px',
              fontSize: '10px',
              opacity: 0,
              transition: 'opacity 0.3s ease',
              zIndex: 2,
            }}
          >
            Saved
          </div>

          {/* Editor Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="rich-editor-wrapper">
              
              {isContentLoading ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: '#666',
                  fontSize: '14px'
                }}>
                  Loading content...
                </div>
              ) : isPlainMode ? (
                plainProvider ? (
                  <TiptapEditorPlain
                    ref={editorRef as any}
                    // DON'T pass content when using provider to avoid triggering fallback effect
                    isEditable={actuallyEditable}  // Respects layer state
                    noteId={currentNoteId || ''}
                    panelId={panelId}
                    onUpdate={(content) => handleUpdate(typeof content === 'string' ? content : JSON.stringify(content))}
                    onSelectionChange={handleSelectionChange}
                    onCollapsibleSelectionChange={handleCollapsibleSelectionChange}
                    placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
                    provider={plainProvider}
                    onContentLoaded={handleEditorContentLoaded}
                  />
                ) : (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    Initializing plain mode provider...
                  </div>
                )
              ) : (
                ydocState.loading && !ydocState.doc ? (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    Loading collaborative editor...
                  </div>
                ) : (
                  <TiptapEditorCollab
                    ref={editorRef}
                    content={''}
                    isEditable={actuallyEditable}  // Respects layer state
                    panelId={panelId}
                    onUpdate={handleUpdate}
                    onSelectionChange={handleSelectionChange}
                    placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
                    ydoc={ydocState.doc as Y.Doc}
                    provider={provider.getProvider() as any}
                  />
                )
              )}
            </div>
          </div>
        </div>

      </div>
      )}

      {/* Connection points */}
      {!isMainPanel && (
        <div className="connection-point input" style={{
          position: 'absolute',
          left: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '16px',
          height: '16px',
          background: '#667eea',
          borderRadius: '50%',
          border: '3px solid white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }} />
      )}
      <div className="connection-point output" style={{
        position: 'absolute',
        right: '-8px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '16px',
        height: '16px',
        background: '#667eea',
        borderRadius: '50%',
        border: '3px solid white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />

    </div>

      {/* Save As Dialog - EXACT copy from notes-explorer (no modifications) */}
      {showSaveAsDialog && typeof window !== 'undefined' && (() => {
        console.log('[SaveAs] Dialog rendering, showSaveAsDialog =', showSaveAsDialog)
        console.log('[SaveAs] document.body exists:', !!document.body)
        setTimeout(() => {
          const overlays = document.querySelectorAll('[style*="position: fixed"]')
          console.log('[SaveAs] Found fixed position elements:', overlays.length)
          overlays.forEach((el, i) => {
            const style = window.getComputedStyle(el)
            console.log(`[SaveAs] Overlay ${i}:`, {
              element: el,
              zIndex: style.zIndex,
              display: style.display,
              position: style.position,
              visibility: style.visibility,
              opacity: style.opacity
            })
          })
        }, 100)
        return createPortal(
          <div
            onClick={(e) => {
              console.log('[SaveAs] Overlay clicked')
              if (e.target === e.currentTarget) {
                setShowSaveAsDialog(false)
              }
            }}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999999,
            }}
          >
            <div
              style={{
                backgroundColor: '#1f2937',
                borderRadius: '8px',
                padding: '24px',
                width: '384px',
                maxWidth: '90vw',
                position: 'relative',
                zIndex: 1000000,
              }}
              onMouseDown={(e) => {
                // Prevent overlay click from closing when clicking inside dialog
                e.stopPropagation()
              }}
            >
              <h2 className="text-xl font-semibold mb-4 text-white">Save Branch As Note</h2>

            {/* Note Name Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Note Name
              </label>
              <input
                type="text"
                value={saveAsNoteName}
                onChange={(e) => setSaveAsNoteName(e.target.value)}
                placeholder="Enter note name..."
                className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
            </div>

            {/* Folder Selector - Phase 3 Enhanced */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Save to Folder
              </label>

              {!saveAsShowCustomFolder ? (
                <>
                  <select
                    value={saveAsSelectedFolderId || 'create-new'}
                    onChange={async (e) => {
                      const value = e.target.value
                      if (value === 'create-new') {
                        setSaveAsIsCreatingFolder(true)
                        setSaveAsShowCustomFolder(false)
                      } else if (value === 'type-custom') {
                        setSaveAsShowCustomFolder(true)
                        setSaveAsIsCreatingFolder(false)
                      } else {
                        setSaveAsSelectedFolderId(value)
                        setSaveAsIsCreatingFolder(false)
                        setSaveAsShowCustomFolder(false)
                      }
                    }}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a folder...</option>
                    <option value="create-new" className="font-semibold text-indigo-400">
                      + Create New Folder...
                    </option>
                    <option value="type-custom" className="font-semibold text-green-400">
                      ✏️ Type Custom Path...
                    </option>
                    <optgroup label="Existing Folders">
                      {saveAsAvailableFolders.map(folder => {
                        // Create visual hierarchy with indentation
                        const indent = '　'.repeat(folder.depth || 0)
                        const displayName = folder.path === '/knowledge-base'
                          ? 'Knowledge Base'
                          : folder.name

                        return (
                          <option key={folder.id} value={folder.id}>
                            {indent}{(folder.depth || 0) > 0 ? '└─ ' : ''}{displayName}
                          </option>
                        )
                      })}
                    </optgroup>
                  </select>

                  {/* New Folder Name Input */}
                  {saveAsIsCreatingFolder && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        value={saveAsNewFolderName}
                        onChange={(e) => setSaveAsNewFolderName(e.target.value)}
                        placeholder="Enter folder name..."
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <select
                        value={saveAsSelectedFolderId || ''}
                        onChange={(e) => setSaveAsSelectedFolderId(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      >
                        <option value="">Create under Knowledge Base (root)</option>
                        {saveAsAvailableFolders.map(folder => (
                          <option key={folder.id} value={folder.id}>
                            Create under: {folder.path.replace('/knowledge-base/', '') || 'Knowledge Base'}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={async () => {
                          if (saveAsNewFolderName.trim()) {
                            const folder = await createSaveAsFolder(saveAsNewFolderName.trim(), saveAsSelectedFolderId || undefined)
                            if (folder) {
                              setSaveAsIsCreatingFolder(false)
                              setSaveAsNewFolderName("")
                              // Re-fetch folders to update the list
                              await fetchSaveAsFolders()
                            }
                          }
                        }}
                        className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                      >
                        Create Folder
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Type-to-Create Pattern */
                <div>
                  <input
                    type="text"
                    value={saveAsCustomFolderInput}
                    onChange={(e) => setSaveAsCustomFolderInput(e.target.value)}
                    placeholder="e.g., Projects/Web/MyApp or just MyFolder"
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setSaveAsShowCustomFolder(false)
                        setSaveAsCustomFolderInput("")
                      }}
                      className="text-xs text-gray-400 hover:text-gray-300"
                    >
                      ← Back to dropdown
                    </button>
                    {saveAsCustomFolderInput && !saveAsAvailableFolders.some(f =>
                      f.path.endsWith('/' + saveAsCustomFolderInput) ||
                      f.name === saveAsCustomFolderInput
                    ) && (
                      <span className="text-xs text-green-400">
                        Will create: {saveAsCustomFolderInput}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {saveAsSelectedFolderId && !saveAsIsCreatingFolder && !saveAsShowCustomFolder && (
                <p className="mt-2 text-xs text-gray-400">
                  Will be saved to: {saveAsAvailableFolders.find(f => f.id === saveAsSelectedFolderId)?.path}
                </p>
              )}
            </div>

            {/* Dialog Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSaveAsDialog(false)
                  setSaveAsNoteName("")
                  setSaveAsSelectedFolderId(null)
                  setSaveAsAvailableFolders([]) // Clear folders to prevent stale data
                  setSaveAsIsCreatingFolder(false)
                  setSaveAsNewFolderName("")
                  setSaveAsShowCustomFolder(false)
                  setSaveAsCustomFolderInput("")
                }}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createSaveAsNote}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>,
        document.body
        )
      })()}

      {/* Tools Dropdown */}
      {showToolsDropdown && (() => {
        const TOOL_CATEGORIES = [
          { id: "layer" as const, label: "Layer" },
          { id: "format" as const, label: "Format" },
          { id: "resize" as const, label: "Resize" },
          { id: "branches" as const, label: "Branches" },
          { id: "actions" as const, label: "Actions" },
        ]

        return createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowToolsDropdown(false)
                setActiveToolPanel(null)

                // Clear any pending override when modal closes without creating annotation
                window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                  detail: { panelId: null, noteId: null }
                }))
              }
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Tool Categories */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  background: 'rgba(17, 24, 39, 0.98)',
                  padding: '12px',
                  borderRadius: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                }}
              >
                {TOOL_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveToolPanel(cat.id)}
                      style={{
                        background: activeToolPanel === cat.id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '8px 16px',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 500,
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (activeToolPanel !== cat.id) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (activeToolPanel !== cat.id) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                        }
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
              </div>

              {/* Tool Panel Content */}
              {activeToolPanel === 'branches' && (() => {
                // Get the current branch from the shared workspace dataStore
                const sharedStoreKey = ensurePanelKey(noteId, panelId)
                const sharedCurrentBranch = sharedDataStore.get(sharedStoreKey) || currentBranch

                console.log('[CanvasPanel] Rendering BranchesSection:', {
                  panelId,
                  storeKey,
                  sharedStoreKey,
                  noteId,
                  currentBranch: {
                    id: currentBranch.id,
                    type: currentBranch.type,
                    hasBranches: !!currentBranch.branches,
                    branchesLength: currentBranch.branches?.length || 0,
                    branches: currentBranch.branches
                  },
                  sharedCurrentBranch: {
                    id: sharedCurrentBranch.id,
                    type: sharedCurrentBranch.type,
                    hasBranches: !!sharedCurrentBranch.branches,
                    branchesLength: sharedCurrentBranch.branches?.length || 0,
                    branches: sharedCurrentBranch.branches
                  },
                  dataStoreKeys: Array.from(dataStore.keys ? dataStore.keys() : []),
                  sharedDataStoreKeys: Array.from(sharedDataStore.keys ? sharedDataStore.keys() : []),
                  allBranchData: Array.from(sharedDataStore.keys ? sharedDataStore.keys() : [])
                    .filter((k: string) => k.includes('::'))
                    .map((k: string) => ({
                      key: k,
                      hasBranches: !!sharedDataStore.get(k)?.branches,
                      branchCount: sharedDataStore.get(k)?.branches?.length || 0,
                      branches: sharedDataStore.get(k)?.branches
                    }))
                })

                return (
                  <BranchesSection
                    panelId={panelId}
                    branch={sharedCurrentBranch}
                    dataStore={sharedDataStore}
                    state={state}
                    dispatch={dispatch}
                    noteId={noteId}
                  />
                )
              })()}

              {/* Actions Panel - Create Branch */}
              {activeToolPanel === 'actions' && (
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.98)',
                    padding: '20px',
                    borderRadius: '16px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    minWidth: '500px',
                  }}
                >
                  <div style={{ marginBottom: '16px' }}>
                    <span style={{ color: '#1f2937', fontWeight: 600, fontSize: '18px' }}>
                      Create Branch
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {/* Note Button */}
                    <button
                      onClick={() => {
                        // Trigger annotation creation directly from this panel
                        const annotationToolbar = document.getElementById('annotation-toolbar')
                        const noteButton = annotationToolbar?.querySelector('.annotation-btn.note') as HTMLButtonElement
                        if (noteButton) {
                          // Store the current panel ID so annotation-toolbar knows which panel to use
                          console.log('[CanvasPanel] Dispatching set-annotation-panel event:', { panelId, noteId: effectiveNoteId })
                          window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                            detail: { panelId, noteId: effectiveNoteId }
                          }))
                          // Wait for the event to be processed before clicking
                          setTimeout(() => noteButton.click(), 10)
                        } else {
                          // Button not found, clear any pending override
                          console.warn('[CanvasPanel] Note button not found, clearing override')
                          window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                            detail: { panelId: null, noteId: null }
                          }))
                        }
                        setShowToolsDropdown(false)
                        setActiveToolPanel(null)
                      }}
                      style={{
                        flex: 1,
                        background: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '20px 16px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 600,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        boxShadow: '0 4px 12px rgba(52, 152, 219, 0.3)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(52, 152, 219, 0.4)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(52, 152, 219, 0.3)'
                      }}
                    >
                      <span style={{ fontSize: '32px' }}>📝</span>
                      <span>Note</span>
                    </button>

                    {/* Explore Button */}
                    <button
                      onClick={() => {
                        const annotationToolbar = document.getElementById('annotation-toolbar')
                        const exploreButton = annotationToolbar?.querySelector('.annotation-btn.explore') as HTMLButtonElement
                        if (exploreButton) {
                          console.log('[CanvasPanel] Dispatching set-annotation-panel event:', { panelId, noteId: effectiveNoteId })
                          window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                            detail: { panelId, noteId: effectiveNoteId }
                          }))
                          // Wait for the event to be processed before clicking
                          setTimeout(() => exploreButton.click(), 10)
                        } else {
                          // Button not found, clear any pending override
                          console.warn('[CanvasPanel] Explore button not found, clearing override')
                          window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                            detail: { panelId: null, noteId: null }
                          }))
                        }
                        setShowToolsDropdown(false)
                        setActiveToolPanel(null)
                      }}
                      style={{
                        flex: 1,
                        background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '20px 16px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 600,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        boxShadow: '0 4px 12px rgba(243, 156, 18, 0.3)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(243, 156, 18, 0.4)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(243, 156, 18, 0.3)'
                      }}
                    >
                      <span style={{ fontSize: '32px' }}>🔍</span>
                      <span>Explore</span>
                    </button>

                    {/* Promote Button */}
                    <button
                      onClick={() => {
                        const annotationToolbar = document.getElementById('annotation-toolbar')
                        const promoteButton = annotationToolbar?.querySelector('.annotation-btn.promote') as HTMLButtonElement
                        if (promoteButton) {
                          console.log('[CanvasPanel] Dispatching set-annotation-panel event:', { panelId, noteId: effectiveNoteId })
                          window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                            detail: { panelId, noteId: effectiveNoteId }
                          }))
                          // Wait for the event to be processed before clicking
                          setTimeout(() => promoteButton.click(), 10)
                        } else {
                          // Button not found, clear any pending override
                          console.warn('[CanvasPanel] Promote button not found, clearing override')
                          window.dispatchEvent(new CustomEvent('set-annotation-panel', {
                            detail: { panelId: null, noteId: null }
                          }))
                        }
                        setShowToolsDropdown(false)
                        setActiveToolPanel(null)
                      }}
                      style={{
                        flex: 1,
                        background: 'linear-gradient(135deg, #27ae60 0%, #229954 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '20px 16px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 600,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        boxShadow: '0 4px 12px rgba(39, 174, 96, 0.3)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(39, 174, 96, 0.4)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.3)'
                      }}
                    >
                      <span style={{ fontSize: '32px' }}>⭐</span>
                      <span>Promote</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      })()}
    </>
  )
} 
