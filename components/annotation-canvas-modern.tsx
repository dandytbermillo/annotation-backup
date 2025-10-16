"use client"

import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { flushSync } from "react-dom"
import { CanvasProvider, useCanvas } from "./canvas/canvas-context"
import type { DataStore } from "@/lib/data-store"
import { IsolationProvider } from "@/lib/isolation/context"
import { CanvasPanel } from "./canvas/canvas-panel"
import { AnnotationToolbar } from "./canvas/annotation-toolbar"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import { useLayer } from "./canvas/layer-provider"
import { PopupStateAdapter } from "@/lib/adapters/popup-state-adapter"
// import { CanvasControls } from "./canvas/canvas-controls" // Removed per user request
import { EnhancedControlPanelV2 } from "./canvas/enhanced-control-panel-v2"
import { EnhancedMinimap } from "./canvas/enhanced-minimap"
import { WidgetStudioConnections } from "./canvas/widget-studio-connections"
import { panToPanel } from "@/lib/canvas/pan-animations"
import { Settings } from "lucide-react"
import { AddComponentMenu } from "./canvas/add-component-menu"
import { ComponentPanel } from "./canvas/component-panel"
import { StickyNoteOverlayPanel } from "./canvas/sticky-note-overlay-panel"
import { CanvasItem, createPanelItem, createComponentItem, isPanel, isComponent, PanelType } from "@/types/canvas-items"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
// IsolationDebugPanel now integrated into EnhancedControlPanelV2
import { 
  loadStateFromStorage, 
  saveStateToStorage, 
  CANVAS_STORAGE_DEBOUNCE 
} from "@/lib/canvas/canvas-storage"
import { getPlainProvider } from "@/lib/provider-switcher"
import { getWheelZoomMultiplier } from "@/lib/canvas/zoom-utils"
import { worldToScreen, screenToWorld } from "@/lib/canvas/coordinate-utils"
import { debugLog } from "@/lib/utils/debug-logger"
import { useCanvasHydration } from "@/lib/hooks/use-canvas-hydration"
import { useCameraPersistence } from "@/lib/hooks/use-camera-persistence"
import { usePanelPersistence } from "@/lib/hooks/use-panel-persistence"
import { LayerManagerProvider, useLayerManager } from "@/lib/hooks/use-layer-manager"
import { useCanvasWorkspace } from "./canvas/canvas-workspace-context"
import { useCameraUserId } from "@/lib/hooks/use-camera-scope"

const PENDING_SAVE_MAX_AGE_MS = 5 * 60 * 1000

interface ModernAnnotationCanvasProps {
  noteId: string
  isNotesExplorerOpen?: boolean
  onCanvasStateChange?: (state: { zoom: number; showConnections: boolean }) => void
  showAddComponentMenu?: boolean
  onToggleAddComponentMenu?: () => void
  onRegisterActiveEditor?: (editorRef: any, panelId: string) => void
  onSnapshotLoadComplete?: () => void  // Called after snapshot load + centering completes
  children?: React.ReactNode  // Toolbar and other components rendered inside CanvasProvider
}

interface CanvasImperativeHandle {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  panBy: (deltaX: number, deltaY: number) => void
  toggleConnections: () => void
  centerOnPanel: (panelId: string) => void
  addComponent: (type: string, position?: { x: number; y: number }) => void
}

// Default viewport settings
const defaultViewport = {
  zoom: 1,
  translateX: -1000,
  translateY: -1200,
  showConnections: true,
}

// Create default canvas state
const createDefaultCanvasState = () => ({
  ...defaultViewport,
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
})

// Create default canvas items with main panel
const DEFAULT_MAIN_POSITION = { x: 2000, y: 1500 }

const createDefaultCanvasItems = (noteId: string, mainPosition?: { x: number; y: number }): CanvasItem[] => [
  createPanelItem(
    "main",
    mainPosition ?? DEFAULT_MAIN_POSITION,
    "main",
    noteId,
    ensurePanelKey(noteId, "main"),
  ),
]

// Ensure main panel always exists in items array
const ensureMainPanel = (items: CanvasItem[], noteId: string, mainPosition?: { x: number; y: number }): CanvasItem[] => {
  const hasMain = items.some((item) => item.itemType === "panel" && item.panelId === "main")
  return hasMain
    ? items
    : [
        ...items,
        createPanelItem(
          "main",
          mainPosition ?? DEFAULT_MAIN_POSITION,
          "main",
          noteId,
          ensurePanelKey(noteId, "main"),
        ),
      ]
}

const ModernAnnotationCanvasInner = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>(({
  noteId,
  isNotesExplorerOpen = false,
  onCanvasStateChange,
  showAddComponentMenu: externalShowAddComponentMenu,
  onToggleAddComponentMenu,
  onSnapshotLoadComplete
}, ref) => {
  const { state: canvasContextState, dispatch, dataStore } = useCanvas()
  const { openNotes, updateMainPosition, getPendingPosition, getCachedPosition } = useCanvasWorkspace()
  const workspaceNote = useMemo(
    () => openNotes.find(note => note.noteId === noteId),
    [openNotes, noteId],
  )
  const isDefaultOffscreenPosition = useCallback((position: { x: number; y: number } | null | undefined) => {
    if (!position) return false
    return position.x === DEFAULT_MAIN_POSITION.x && position.y === DEFAULT_MAIN_POSITION.y
  }, [])

  const workspaceMainPosition = useMemo(() => {
    const pending = getPendingPosition(noteId)
    if (pending && !isDefaultOffscreenPosition(pending)) return pending

    const cached = getCachedPosition(noteId)
    if (cached && !isDefaultOffscreenPosition(cached)) return cached

    if (workspaceNote?.mainPosition && !isDefaultOffscreenPosition(workspaceNote.mainPosition)) {
      return workspaceNote.mainPosition
    }

    return null
  }, [workspaceNote, getPendingPosition, getCachedPosition, isDefaultOffscreenPosition, noteId])

  // Layer system for multi-layer canvas
  const layerContext = useLayer()
  const canvasOpacity = layerContext ? PopupStateAdapter.getLayerOpacity('notes', layerContext.activeLayer) : 1

  // Initialize canvas state - check for snapshot to avoid visible jump
  const [canvasState, _setCanvasState] = useState(() => {
    const snapshot = loadStateFromStorage(noteId)
    console.log('[AnnotationCanvas] useState initializer:', {
      noteId,
      hasSnapshot: !!snapshot,
      snapshotViewport: snapshot?.viewport
    })

    if (snapshot && snapshot.viewport) {
      const initialState = {
        ...createDefaultCanvasState(),
        translateX: snapshot.viewport.translateX ?? defaultViewport.translateX,
        translateY: snapshot.viewport.translateY ?? defaultViewport.translateY,
        zoom: snapshot.viewport.zoom ?? 1,
        showConnections: snapshot.viewport.showConnections ?? true
      }
      console.log('[AnnotationCanvas] Initializing state from snapshot:', initialState)
      return initialState
    }

    console.log('[AnnotationCanvas] Initializing state to default (no snapshot)')
    return createDefaultCanvasState()
  })

  // Wrap setCanvasState to log all calls
  const setCanvasState: typeof _setCanvasState = useCallback((update) => {
    const stack = new Error().stack
    const caller = stack?.split('\n').slice(2, 6).join(' | ') || 'unknown'

    debugLog({
      component: 'AnnotationCanvas',
      action: 'setCanvasState_called',
      metadata: {
        noteId,
        isFunction: typeof update === 'function',
        caller: caller.substring(0, 500)
      }
    })

    return _setCanvasState(update)
  }, [noteId])

  // Track viewport changes for debugging
  const previousViewportRef = useRef({ x: canvasState.translateX, y: canvasState.translateY })

  useEffect(() => {
    const prev = previousViewportRef.current
    const changed = prev.x !== canvasState.translateX || prev.y !== canvasState.translateY

    if (changed) {
      const stack = new Error().stack
      const caller = stack?.split('\n')[3] || 'unknown'

      debugLog({
        component: 'AnnotationCanvas',
        action: 'viewport_changed',
        metadata: {
          noteId,
          from: { x: prev.x, y: prev.y },
          to: { x: canvasState.translateX, y: canvasState.translateY },
          delta: { x: canvasState.translateX - prev.x, y: canvasState.translateY - prev.y },
          zoom: canvasState.zoom,
          caller: caller.trim(),
          isDragging: canvasState.isDragging
        }
      })

      previousViewportRef.current = { x: canvasState.translateX, y: canvasState.translateY }
    }
  }, [canvasState.translateX, canvasState.translateY, canvasState.isDragging, noteId])

  // Unified canvas items state
  const initialMainPositionRef = useRef<{ x: number; y: number } | null>(workspaceMainPosition)
  const workspaceSeedAppliedRef = useRef(false)
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>(() =>
    createDefaultCanvasItems(noteId, initialMainPositionRef.current ?? undefined),
  )
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const autoSaveTimerRef = useRef<number | null>(null)
  const [showControlPanel, setShowControlPanel] = useState(false)
  const [internalShowAddComponentMenu, setInternalShowAddComponentMenu] = useState(false)
  const mainPanelSeededRef = useRef(false)

  useEffect(() => {
    mainPanelSeededRef.current = false
  }, [noteId])
  const isRestoringSnapshotRef = useRef(false)
  
  // Use external control if provided, otherwise use internal state
  const showAddComponentMenu = externalShowAddComponentMenu !== undefined ? externalShowAddComponentMenu : internalShowAddComponentMenu
  const toggleAddComponentMenu = onToggleAddComponentMenu || (() => setInternalShowAddComponentMenu(!internalShowAddComponentMenu))
  const [stickyOverlayEl, setStickyOverlayEl] = useState<HTMLElement | null>(null)

  // Canvas state persistence - Get provider instances for hydration
  const provider = useMemo(() => UnifiedProvider.getInstance(), [])
  const branchesMap = useMemo(() => provider.getBranchesMap(), [provider])
  const layerManagerApi = useLayerManager()
  const cameraUserId = useCameraUserId()

  // Hydrate canvas state on mount (panels + camera)
  const hydrationStatus = useCanvasHydration({
    noteId,
    userId: cameraUserId ?? undefined,
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    enabled: true
  })

  const initialHydrationRef = useRef(true)
  const lastHydratedNoteRef = useRef<string | null>(null)
  const initialCanvasSetupRef = useRef(false)

  useEffect(() => {
    if (workspaceSeedAppliedRef.current) return
    if (!workspaceMainPosition) return
    if (hydrationStatus.success) return

    setCanvasItems(prev =>
      prev.map(item =>
        item.itemType === "panel" && item.panelId === "main"
          ? { ...item, position: workspaceMainPosition }
          : item,
      ),
    )
    workspaceSeedAppliedRef.current = true
  }, [workspaceMainPosition, hydrationStatus.success])

  // Create CanvasItems from hydrated panels
  useEffect(() => {
    if (hydrationStatus.success && hydrationStatus.panels.length > 0) {
      const isInitialHydration = initialHydrationRef.current
      const isSameNote = lastHydratedNoteRef.current === noteId

      const panelsToHydrate = isInitialHydration || !isSameNote
        ? (isInitialHydration ? hydrationStatus.panels : hydrationStatus.panels.filter(panel => panel.id === 'main'))
        : hydrationStatus.panels.filter(panel => panel.id === 'main')

      debugLog({
        component: 'AnnotationCanvas',
        action: 'creating_canvas_items_from_hydration',
        metadata: {
          panelCount: hydrationStatus.panels.length,
          panelsHydrated: panelsToHydrate.map(panel => panel.id),
          mode: isInitialHydration ? 'initial_restore' : (isSameNote ? 'same_note_refresh' : 'note_switch')
        }
      })

      if (panelsToHydrate.length === 0) {
        initialHydrationRef.current = false
        lastHydratedNoteRef.current = noteId
        return
      }

      const newItems = panelsToHydrate.map(panel => {
        // Use annotation type from metadata for correct header color
        const panelType = (panel.metadata?.annotationType as PanelType) || 'note'

        debugLog({
          component: 'AnnotationCanvas',
          action: 'hydrating_panel_with_type',
          metadata: {
            panelId: panel.id,
            dbType: panel.type,
            annotationType: panel.metadata?.annotationType,
            resolvedPanelType: panelType
          }
        })

        return createPanelItem(
          panel.id,
          panel.position,
          panelType,
          noteId,
          ensurePanelKey(noteId, panel.id),
        )
      })

      setCanvasItems(prev => {
        // Avoid duplicates - only add panels that don't exist
        const existingPanelIds = new Set(
          prev.filter(item => item.itemType === 'panel').map(item => item.panelId)
        )

        const itemsToAdd = newItems.filter(item => !existingPanelIds.has(item.panelId))

        if (itemsToAdd.length > 0) {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'added_panels_to_canvas_items',
            metadata: { addedCount: itemsToAdd.length, totalItems: prev.length + itemsToAdd.length }
          })
          return [...prev, ...itemsToAdd]
        }

        return prev
      })

      initialHydrationRef.current = false
      lastHydratedNoteRef.current = noteId
    }
  }, [hydrationStatus.success, hydrationStatus.panels, noteId, workspaceMainPosition])

  // Enable camera persistence (debounced)
  useCameraPersistence({
    noteId,
    userId: cameraUserId ?? undefined,
    debounceMs: 500,
    enabled: true
  })

  // Enable panel persistence
  const { persistPanelCreate, persistPanelUpdate, persistPanelDelete, getPanelDimensions } = usePanelPersistence({
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    noteId,
    canvasItems,
    userId: cameraUserId ?? undefined
  })

  const persistCameraSnapshot = useCallback(
    async (camera: { x: number; y: number; zoom: number }) => {
      if (typeof window === 'undefined') return
      try {
        await fetch(`/api/canvas/camera/${noteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ camera, userId: cameraUserId ?? null })
        })
      } catch (error) {
        console.warn('[AnnotationCanvas] Failed to persist restored camera snapshot', error)
      }
    },
    [noteId, cameraUserId]
  )

  // Persist main panel if it doesn't exist in database (first-time note open)
  useEffect(() => {
    if (hydrationStatus.success) {
      const hasMainPanel = hydrationStatus.panels.some(p => p.id === 'main')

      if (!hasMainPanel && !mainPanelSeededRef.current) {
        // Main panel doesn't exist in database - persist it with CENTERED position
        debugLog({
          component: 'AnnotationCanvas',
          action: 'persisting_default_main_panel',
          metadata: { noteId }
        })

        // Calculate a centered position instead of using offscreen default
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080

        const mainPanelItem = canvasItems.find(item => item.itemType === 'panel' && item.panelId === 'main')

        const screenDimensions = getPanelDimensions('main')
        const worldPanelWidth = screenDimensions.width / canvasState.zoom
        const worldPanelHeight = screenDimensions.height / canvasState.zoom

        // Calculate world position that will appear centered with current viewport
        // Screen center position (where we want panel center to appear)
        const screenCenterX = viewportWidth / 2
        const screenCenterY = viewportHeight / 2

        // Convert screen position to world position
        // screenPos = (worldPos + viewportTranslate) * zoom
        // worldPos = (screenPos / zoom) - viewportTranslate
        const worldCenterX = (screenCenterX / canvasState.zoom) - canvasState.translateX
        const worldCenterY = (screenCenterY / canvasState.zoom) - canvasState.translateY

        // Offset by half panel size to center the panel (not just top-left corner)
        const centeredPosition = {
          x: worldCenterX - (worldPanelWidth / 2),
          y: worldCenterY - (worldPanelHeight / 2)
        }

        // Get current main panel position from canvas items (if already set)
        const existingMainPanelPosition = mainPanelItem?.position && !isDefaultOffscreenPosition(mainPanelItem.position)
          ? mainPanelItem.position
          : null
        const workspacePosition = workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)
          ? workspaceMainPosition
          : null

        // Priority: 1) existing main panel position (if not default), 2) workspace position (if not default), 3) calculated centered position
        const mainPosition = existingMainPanelPosition || workspacePosition || centeredPosition

        debugLog({
          component: 'AnnotationCanvas',
          action: 'NEW_NOTE_MAIN_POSITION_DETERMINED',
          metadata: {
            noteId,
            mainPanelItem_position: mainPanelItem?.position,
            workspaceMainPosition,
            DEFAULT_MAIN_POSITION,
            centeredPosition,
            currentViewport: { x: canvasState.translateX, y: canvasState.translateY, zoom: canvasState.zoom },
            finalMainPosition: mainPosition
          }
        })

        console.log('[NEW NOTE] Main panel position determined:', {
          'from canvasItems': mainPanelItem?.position,
          'from workspace': workspaceMainPosition,
          'default (offscreen)': DEFAULT_MAIN_POSITION,
          'calculated centered': centeredPosition,
          'current viewport': { x: canvasState.translateX, y: canvasState.translateY },
          'FINAL POSITION USED': mainPosition
        })

        // Update canvas items to use the final position (especially if we calculated a centered position)
        if (!mainPanelItem?.position || isDefaultOffscreenPosition(mainPanelItem.position)) {
          // Main panel is using default offscreen position or doesn't exist - update it to centered position
          const currentPosition = mainPanelItem?.position
          if (!currentPosition || currentPosition.x !== mainPosition.x || currentPosition.y !== mainPosition.y) {
            setCanvasItems(prev =>
              prev.map(item =>
                item.itemType === 'panel' && item.panelId === 'main'
                  ? { ...item, position: mainPosition }
                  : item
              )
            )
            debugLog({
              component: 'AnnotationCanvas',
              action: 'NEW_NOTE_CANVAS_POSITION_UPDATED',
              metadata: { noteId, mainPosition },
            })
          }
        }

        const cameraForConversion = {
          x: canvasState.translateX,
          y: canvasState.translateY
        }
        const screenPosition = worldToScreen(mainPosition, cameraForConversion, canvasState.zoom)

        const mainStoreKey = ensurePanelKey(noteId, 'main')
        const mainBranch = dataStore.get(mainStoreKey)
        const resolvedTitle =
          (mainBranch && typeof mainBranch.title === 'string' && mainBranch.title.trim().length > 0
            ? mainBranch.title
            : mainPanelItem?.title) ?? undefined

        const seedReason = existingMainPanelPosition
          ? 'existing_position'
          : workspacePosition
            ? 'workspace_position'
            : 'centered_position'

        debugLog({
          component: 'AnnotationCanvas',
          action: 'workspace_main_panel_seeded',
          metadata: {
            noteId,
            seedReason,
            screenDimensions,
            worldPanelSize: { width: worldPanelWidth, height: worldPanelHeight },
            mainPosition,
            viewport: {
              translateX: canvasState.translateX,
              translateY: canvasState.translateY,
              zoom: canvasState.zoom
            }
          }
        })

        persistPanelCreate({
          panelId: 'main',
          storeKey: ensurePanelKey(noteId, 'main'),  // Composite key for multi-note support
          type: 'editor',
          position: screenPosition,
          size: { width: screenDimensions.width, height: screenDimensions.height },
          zIndex: 0,
          title: resolvedTitle,
          metadata: { annotationType: 'main' }
        }).catch(err => {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'main_panel_persist_failed',
            metadata: { error: err instanceof Error ? err.message : 'Unknown error' }
          })
        })

        void updateMainPosition(noteId, mainPosition).catch(err => {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'workspace_main_position_update_failed',
            metadata: {
              error: err instanceof Error ? err.message : 'Unknown error',
              noteId
            }
          })
        })

        mainPanelSeededRef.current = true
      }
    }
  }, [
    hydrationStatus.success,
    hydrationStatus.panels,
    noteId,
    canvasItems,
    persistPanelCreate,
    workspaceMainPosition,
    updateMainPosition,
    canvasState.zoom,
    canvasState.translateX,
    canvasState.translateY,
    dataStore
  ])

  // Selection guards to prevent text highlighting during canvas drag
  const selectionGuardsRef = useRef<{
    onSelectStart: (e: Event) => void;
    onDragStart: (e: Event) => void;
    prevUserSelect: string;
  } | null>(null)

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return
    if (selectionGuardsRef.current) return
    const onSelectStart = (e: Event) => { e.preventDefault() }
    const onDragStart = (e: Event) => { e.preventDefault() }
    selectionGuardsRef.current = { onSelectStart, onDragStart, prevUserSelect: document.body.style.userSelect }
    document.documentElement.classList.add('dragging-no-select')
    document.body.style.userSelect = 'none'
    document.addEventListener('selectstart', onSelectStart, true)
    document.addEventListener('dragstart', onDragStart, true)
    try { window.getSelection()?.removeAllRanges?.() } catch {}
  }, [])

  const pendingDispatchRef = useRef({
    translateX: canvasContextState.canvasState.translateX,
    translateY: canvasContextState.canvasState.translateY,
    zoom: canvasContextState.canvasState.zoom,
  })
  const dispatchFrameRef = useRef<number | null>(null)

  const scheduleDispatch = useCallback(
    (next: { translateX: number; translateY: number; zoom: number }) => {
      pendingDispatchRef.current = next
      if (dispatchFrameRef.current != null) return

      dispatchFrameRef.current = requestAnimationFrame(() => {
        dispatchFrameRef.current = null
        const payload = pendingDispatchRef.current
        dispatch({
          type: 'SET_CANVAS_STATE',
          payload,
        })
      })
    },
    [dispatch]
  )

  useEffect(() => {
    return () => {
      if (dispatchFrameRef.current != null) {
        cancelAnimationFrame(dispatchFrameRef.current)
        dispatchFrameRef.current = null
      }
    }
  }, [])

  const updateCanvasTransform = useCallback(
    (updater: (prev: ReturnType<typeof createDefaultCanvasState>) => ReturnType<typeof createDefaultCanvasState>) => {
      setCanvasState(prev => {
        const next = updater(prev)
        if (
          next.translateX !== prev.translateX ||
          next.translateY !== prev.translateY ||
          next.zoom !== prev.zoom
        ) {
          scheduleDispatch({
            translateX: next.translateX,
            translateY: next.translateY,
            zoom: next.zoom,
          })
        }
        return next
      })
    },
    [scheduleDispatch]
  )

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      if (deltaX === 0 && deltaY === 0) {
        return
      }
      updateCanvasTransform(prev => ({
        ...prev,
        translateX: prev.translateX + deltaX,
        translateY: prev.translateY + deltaY,
      }))
    },
    [updateCanvasTransform]
  )

  useEffect(() => {
    // Skip syncing if we're currently restoring from snapshot
    // This prevents the visible "jump" from default viewport to restored viewport
    if (isRestoringSnapshotRef.current) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'skip_context_sync_during_snapshot_restore',
        metadata: { noteId, reason: 'snapshot_restoration_in_progress' }
      })
      return
    }

    const { translateX, translateY, zoom } = canvasContextState.canvasState
    setCanvasState(prev => {
      if (
        prev.translateX === translateX &&
        prev.translateY === translateY &&
        prev.zoom === zoom
      ) {
        return prev
      }
      return {
        ...prev,
        translateX,
        translateY,
        zoom,
      }
    })
  }, [
    canvasContextState.canvasState.translateX,
    canvasContextState.canvasState.translateY,
    canvasContextState.canvasState.zoom,
    noteId
  ])

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return
    const g = selectionGuardsRef.current
    if (!g) return
    document.removeEventListener('selectstart', g.onSelectStart, true)
    document.removeEventListener('dragstart', g.onDragStart, true)
    document.documentElement.classList.remove('dragging-no-select')
    document.body.style.userSelect = g.prevUserSelect || ''
    selectionGuardsRef.current = null
  }, [])

  useEffect(() => {
    // Note: We no longer clear editor docs when switching notes
    // The composite key system (noteId-panelId) already isolates docs between notes
    // This allows content to load immediately when switching back to a previously viewed note
    
    // Check if we're in plain mode (explicit flag; avoids provider init race)
    const isPlainMode = isPlainModeActive()
    
    if (!isPlainMode) {
      // Initialize collaboration provider with YJS persistence
      const provider = UnifiedProvider.getInstance()
      
      // Set the current note context
      provider.setCurrentNote(noteId)
      
      // Check if this is a new note (check localStorage for existing data)
      const existingData = localStorage.getItem(`note-data-${noteId}`)
      const isNewNote = !existingData
      
      console.log('[AnnotationCanvas] Initializing note:', {
        noteId,
        hasExistingData: !!existingData,
        isNewNote
      })
      
      // Define default data for new notes
      const defaultData = {
        'main': {
          title: 'New Document',
          type: 'main',
          content: '', // Empty content for new documents
          branches: [],
          position: { x: 2000, y: 1500 },
          isEditable: true,
          // Mark as new to force edit mode
          isNew: isNewNote
        }
      }
      
      console.log('[AnnotationCanvas] Default data for main panel:', defaultData.main)
      
      // Initialize with defaults - the provider will merge with existing data if any
      // For new notes, this sets empty content
      // For existing notes, this preserves their content
      provider.initializeDefaultData(noteId, defaultData)
    }

    return () => {
      // Don't destroy note when switching - only cleanup when truly unmounting
      // The provider's smart cache management will handle memory efficiently
      // This allows content to persist when switching between notes
    }
  }, [noteId])

  // Load canvas state when note changes
  useEffect(() => {
    setIsStateLoaded(false)

    // Clear any pending auto-save timer
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    // Check for snapshot FIRST before initializing to default
    const snapshot = loadStateFromStorage(noteId)

    // Only initialize to default if no snapshot exists AND this is first setup
    if (!initialCanvasSetupRef.current && !snapshot) {
      setCanvasState(createDefaultCanvasState())
      setCanvasItems(createDefaultCanvasItems(noteId, workspaceMainPosition ?? undefined))
      initialCanvasSetupRef.current = true
    }
    if (!snapshot) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'no_saved_state_new_note',
        metadata: { noteId }
      })
      console.table([
        {
          Action: 'No Saved State',
          NoteId: noteId,
          Time: new Date().toLocaleTimeString(),
        },
      ])

      // For new notes, we still need to center the main panel
      // Use setTimeout with retries to ensure DOM is ready
      let retries = 0
      const maxRetries = 10
      const tryCenter = () => {
        retries++

        debugLog({
          component: 'AnnotationCanvas',
          action: 'centering_new_note',
          metadata: { noteId, attempt: retries }
        })

        const panelEl = document.querySelector(`[data-panel-id="main"]`) as HTMLElement
        if (!panelEl) {
          if (retries < maxRetries) {
            debugLog({
              component: 'AnnotationCanvas',
              action: 'new_note_panel_not_found_retry',
              metadata: { noteId, attempt: retries, nextRetry: '50ms' }
            })
            setTimeout(tryCenter, 50)
            return
          }

          debugLog({
            component: 'AnnotationCanvas',
            action: 'new_note_panel_not_found',
            metadata: { noteId, attemptsExhausted: retries }
          })
          if (onSnapshotLoadComplete) {
            onSnapshotLoadComplete()
          }
          return
        }

        // Get panel dimensions and calculate center
        const panelDimensions = {
          width: panelEl.offsetWidth,
          height: panelEl.offsetHeight
        }

        const viewportDimensions = {
          width: window.innerWidth,
          height: window.innerHeight
        }

        const mainPanel = canvasItems.find(item => item.itemType === 'panel' && item.panelId === 'main')
        const position: { x: number; y: number } = (() => {
          if (mainPanel?.position && !isDefaultOffscreenPosition(mainPanel.position)) {
            return mainPanel.position
          }
          if (workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)) {
            return workspaceMainPosition
          }

          const pendingPosition = getPendingPosition(noteId)
          if (pendingPosition && !isDefaultOffscreenPosition(pendingPosition)) {
            return pendingPosition
          }

          const cachedPosition = getCachedPosition(noteId)
          if (cachedPosition && !isDefaultOffscreenPosition(cachedPosition)) {
            return cachedPosition
          }

          return { ...DEFAULT_MAIN_POSITION }
        })()

        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_centering_source',
          metadata: {
            noteId,
            mainPanelPosition: mainPanel?.position,
            workspaceMainPosition,
            pendingPosition: getPendingPosition(noteId),
            cachedPosition: getCachedPosition(noteId),
            chosenPosition: position,
          },
        })

        const centerOffset = {
          x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / canvasState.zoom,
          y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / canvasState.zoom
        }

        const targetX = -position.x + centerOffset.x
        const targetY = -position.y + centerOffset.y

        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_centering_calculated',
          metadata: {
            position,
            panelDimensions,
            viewportDimensions,
            targetX,
            targetY
          }
        })

        // Disable CSS transition
        const canvasEl = document.getElementById('infinite-canvas')
        if (canvasEl) {
          canvasEl.style.transition = 'none'
          void canvasEl.offsetHeight
        }

        // Update viewport
        flushSync(() => {
          setCanvasState(prev => ({
            ...prev,
            translateX: targetX,
            translateY: targetY
          }))
        })

        // ✅ CRITICAL FIX: Sync to context to prevent stale state on first drag
        // Without this, panCameraBy reads old translateX=-1000 from context
        // causing panels to snap on first auto-scroll
        dispatch({
          type: 'SET_CANVAS_STATE',
          payload: {
            translateX: targetX,
            translateY: targetY
          }
        })

        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_context_synced',
          metadata: { noteId, targetX, targetY }
        })

        // Restore transition
        if (canvasEl) {
          requestAnimationFrame(() => {
            canvasEl.style.transition = ''
          })
        }

        // Notify parent
        if (onSnapshotLoadComplete) {
          onSnapshotLoadComplete()
        }
      }

      // Start the centering retry loop
      setTimeout(tryCenter, 0)

      setIsStateLoaded(true)
      return
    }

    const plainProvider = getPlainProvider()
    let providerVersion = 0
    let providerHasContent = false
    if (plainProvider) {
      try {
        providerVersion = plainProvider.getDocumentVersion(noteId, 'main')
        const existing = plainProvider.getDocument(noteId, 'main')
        providerHasContent = existing ? !plainProvider.isEmptyContent(existing) : false
      } catch (err) {
        console.warn('[AnnotationCanvas] Failed to inspect provider cache during snapshot load:', err)
      }
    }

    let pendingSnapshotBlocked = false
    if (plainProvider && typeof window !== 'undefined') {
      try {
        const pendingKey = `pending_save_${noteId}_main`
        const pendingData = window.localStorage.getItem(pendingKey)
        if (pendingData) {
          const parsed = JSON.parse(pendingData) as { timestamp?: number; version?: number }
          const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0
          if (timestamp) {
            const age = Date.now() - timestamp
            if (age < PENDING_SAVE_MAX_AGE_MS) {
              const pendingVersion = typeof parsed.version === 'number' ? parsed.version : 0
              if (pendingVersion > providerVersion) {
                pendingSnapshotBlocked = true
              } else {
                window.localStorage.removeItem(pendingKey)
              }
            } else {
              window.localStorage.removeItem(pendingKey)
            }
          } else {
            window.localStorage.removeItem(pendingKey)
          }
        }
      } catch (error) {
        console.warn('[AnnotationCanvas] Failed to inspect pending backup for snapshot guard:', error)
      }
    }

    if (pendingSnapshotBlocked) {
      console.log('[AnnotationCanvas] Deferring snapshot restore; pending save has newer content', {
        noteId,
        providerVersion,
      })
      // Reset viewport to defaults even when deferring snapshot
      setCanvasState((prev) => ({
        ...prev,
        translateX: defaultViewport.translateX,
        translateY: defaultViewport.translateY,
      }))
      setIsStateLoaded(true)
      return
    }

    console.table([
      {
        Action: 'State Loaded',
        NoteId: noteId,
        Items: snapshot.items.length,
        SavedAt: new Date(snapshot.savedAt).toLocaleTimeString(),
        ProviderVersion: providerVersion,
        ProviderHasContent: providerHasContent,
      },
    ])

    const viewport = snapshot.viewport
    const restoredTranslateX = Number.isFinite(viewport.translateX)
      ? viewport.translateX
      : defaultViewport.translateX
    const restoredTranslateY = Number.isFinite(viewport.translateY)
      ? viewport.translateY
      : defaultViewport.translateY
    const restoredZoom = Number.isFinite(viewport.zoom) ? viewport.zoom : canvasState.zoom

    // Mark initial setup as complete (prevents re-initialization on subsequent effect runs)
    if (!initialCanvasSetupRef.current) {
      initialCanvasSetupRef.current = true
    }

    // Mark that we're restoring snapshot to prevent syncing effect from running
    isRestoringSnapshotRef.current = true

    setCanvasState((prev) => ({
      ...prev,
      zoom: restoredZoom,
      translateX: restoredTranslateX,
      translateY: restoredTranslateY,
      showConnections:
        typeof viewport.showConnections === 'boolean' ? viewport.showConnections : prev.showConnections,
    }))

    dispatch({
      type: 'SET_CANVAS_STATE',
      payload: {
        translateX: restoredTranslateX,
        translateY: restoredTranslateY,
      },
    })

    persistCameraSnapshot({
      x: restoredTranslateX,
      y: restoredTranslateY,
      zoom: restoredZoom,
    })

    // Allow syncing effect to run again after snapshot restore completes
    // Use requestAnimationFrame to ensure state updates have been processed
    requestAnimationFrame(() => {
      isRestoringSnapshotRef.current = false
    })

    let restoredItems = ensureMainPanel(
      snapshot.items.map((item) => ({ ...item })) as CanvasItem[],
      noteId,
      workspaceMainPosition ?? undefined
    )

    // CRITICAL: Detect and fix corrupted snapshots with screen-space coordinates
    // Corrupted snapshots have panel positions that are screen-space instead of world-space
    // This happened due to a bug in handleCreatePanel that was converting world→screen
    const mainPanelItem = restoredItems.find(item => item.itemType === 'panel' && item.panelId === 'main')
    if (mainPanelItem && hydrationStatus.panels.length > 0) {
      const dbPanel = hydrationStatus.panels.find(p => p.id === 'main')
      if (dbPanel) {
        // Check if snapshot position differs significantly from database position
        const posDiff = Math.abs(mainPanelItem.position.x - dbPanel.position.x) +
                        Math.abs(mainPanelItem.position.y - dbPanel.position.y)

        // If difference > 1000px, snapshot is likely corrupted (screen-space instead of world-space)
        if (posDiff > 1000) {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'CORRUPTED_SNAPSHOT_DETECTED',
            metadata: {
              snapshotPosition: mainPanelItem.position,
              dbPosition: dbPanel.position,
              difference: posDiff,
              action: 'using_database_position'
            }
          })

          // Use database position instead of corrupted snapshot position
          restoredItems = restoredItems.map(item =>
            item.itemType === 'panel' && item.panelId === 'main'
              ? { ...item, position: dbPanel.position }
              : item
          )
        }
      }
    }

    // Log what we're restoring to debug_logs table (after corruption fix)
    const finalMainPanelItem = restoredItems.find(item => item.itemType === 'panel' && item.panelId === 'main')
    debugLog({
      component: 'AnnotationCanvas',
      action: 'SNAPSHOT_RESTORE_DETAILS',
      metadata: {
        viewport: { x: restoredTranslateX, y: restoredTranslateY, zoom: restoredZoom },
        mainPanelPosition: finalMainPanelItem?.position,
        screenPosition: finalMainPanelItem?.position ? {
          x: (finalMainPanelItem.position.x + restoredTranslateX) * restoredZoom,
          y: (finalMainPanelItem.position.y + restoredTranslateY) * restoredZoom
        } : null,
        totalItems: restoredItems.length
      }
    })

    setCanvasItems(restoredItems)

    const mainPanel = restoredItems.find((item) => item.itemType === 'panel' && item.panelId === 'main')

    if (plainProvider && mainPanel?.position) {
      const mainStoreKey = ensurePanelKey(noteId, 'main')
      const mainBranch = dataStore.get(mainStoreKey)
      if (mainBranch) {
        mainBranch.position = { ...mainPanel.position }
        dataStore.set(mainStoreKey, mainBranch)
        debugLog({
          component: 'AnnotationCanvas',
          action: 'restored_datastore_main_position',
          metadata: { noteId, position: mainBranch.position }
        })
      }
    }

    debugLog({
      component: 'AnnotationCanvas',
      action: 'snapshot_viewport_restored',
      metadata: {
        noteId,
        translateX: restoredTranslateX,
        translateY: restoredTranslateY,
        zoom: restoredZoom,
        items: restoredItems.length,
      }
    })

    setIsStateLoaded(true)

    if (onSnapshotLoadComplete) {
      onSnapshotLoadComplete()
    }

    return
  }, [noteId, onSnapshotLoadComplete])

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only respond to primary button (left-click)
    // Ignore right-click (button 2), middle-click (button 1), etc.
    if (e.button !== 0) return

    // Only start dragging if clicking on canvas background
    // Don't drag if clicking on a panel or component
    const target = e.target instanceof Element ? e.target : null
    if (target && (target.closest('.panel') || target.closest('[data-component-panel]'))) return

    setCanvasState(prev => ({
      ...prev,
      isDragging: true,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY
    }))

    enableSelectionGuards()
    document.body.style.userSelect = 'none'
    try { window.getSelection()?.removeAllRanges?.() } catch {}
    e.preventDefault()
  }

  const handleCanvasMouseMove = (e: MouseEvent) => {
    if (!canvasState.isDragging) return
    
    const deltaX = e.clientX - canvasState.lastMouseX
    const deltaY = e.clientY - canvasState.lastMouseY

    updateCanvasTransform(prev => ({
      ...prev,
      translateX: prev.translateX + deltaX,
      translateY: prev.translateY + deltaY,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY,
    }))
  }

  const handleCanvasMouseUp = () => {
    setCanvasState(prev => ({ ...prev, isDragging: false }))
    document.body.style.userSelect = ''
    disableSelectionGuards()
  }

  const handleWheel = (e: React.WheelEvent) => {
    // Only zoom if Shift key is held down
    if (!e.shiftKey) {
      // Allow normal scrolling when Shift is not pressed
      return
    }
    
    e.preventDefault()

    const multiplier = getWheelZoomMultiplier(e.nativeEvent)
    const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))
    
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const zoomChange = newZoom / canvasState.zoom
    
    updateCanvasTransform(prev => ({
      ...prev,
      zoom: newZoom,
      translateX: mouseX - (mouseX - prev.translateX) * zoomChange,
      translateY: mouseY - (mouseY - prev.translateY) * zoomChange,
    }))
  }

  useEffect(() => {
    document.addEventListener('mousemove', handleCanvasMouseMove)
    document.addEventListener('mouseup', handleCanvasMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleCanvasMouseMove)
      document.removeEventListener('mouseup', handleCanvasMouseUp)
    }
  }, [canvasState.isDragging, canvasState.lastMouseX, canvasState.lastMouseY])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const overlay = document.createElement('div')
    overlay.id = 'sticky-note-overlay-root'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '12000'
    overlay.style.display = 'block'

    document.body.appendChild(overlay)
    setStickyOverlayEl(overlay)

    return () => {
      document.body.removeChild(overlay)
      setStickyOverlayEl(null)
    }
  }, [])

  const handlePanelClose = (panelId: string) => {
    setCanvasItems(prev => prev.filter(item => !(isPanel(item) && item.panelId === panelId)))

    // Persist panel deletion to database
    persistPanelDelete(panelId).catch(err => {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'panel_delete_persist_failed',
        metadata: {
          panelId,
          error: err instanceof Error ? err.message : 'Unknown error'
        }
      })
    })
  }

  const handleCreatePanel = (panelId: string, parentPanelId?: string, parentPosition?: { x: number, y: number }) => {
    console.log('[AnnotationCanvas] Creating panel:', panelId, 'with parent:', parentPanelId, 'at position:', parentPosition)
    
    // Log to debug_logs table
    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'AnnotationCanvas',
        action: 'handle_create_panel',
        metadata: {
          panelId: panelId,
          parentPanelId: parentPanelId,
          parentPosition: parentPosition,
          isPlainMode: isPlainModeActive()
        },
        content_preview: `Creating panel ${panelId} at x=${parentPosition?.x}, y=${parentPosition?.y}`,
        note_id: noteId
      })
    }).catch(console.error)
    
    // Check if we're in plain mode
    const isPlainMode = isPlainModeActive()
    
    setCanvasItems(prev => {
      const newPanelStoreKey = ensurePanelKey(noteId, panelId)
      // Only add if not already present
      if (prev.some(item => isPanel(item) && item.panelId === panelId)) {
        return prev
      }
      
      if (isPlainMode) {
        // Plain mode: Check if panel data exists
        // Note: We'll need to get dataStore from context provider
        console.log('[Plain mode] Creating panel:', panelId)
        
        // If parent position is provided, update the dataStore
        if (parentPosition && (window as any).canvasDataStore) {
          const dataStore = (window as any).canvasDataStore
          const existingPanelData = dataStore.get(newPanelStoreKey)

          if (!existingPanelData?.worldPosition) {
            const camera = {
              x: canvasState.translateX,
              y: canvasState.translateY
            }
            const worldPosition = screenToWorld(parentPosition, camera, canvasState.zoom)

            dataStore.update(newPanelStoreKey, {
              id: panelId,
              position: worldPosition,
              worldPosition: worldPosition
            })
          }
        }
      } else {
        // Ensure the provider knows about the current note
        const provider = UnifiedProvider.getInstance()
        provider.setCurrentNote(noteId)
        
        // Get the panel data from YJS
        const branchesMap = provider.getBranchesMap()
        const panelData = branchesMap.get(newPanelStoreKey)
        
        if (!panelData) {
          console.warn(`No data found for panel ${panelId}`)
          return prev
        }
        
        // If parent position is provided, update the position
        if (parentPosition && panelData) {
          panelData.position = parentPosition
          branchesMap.set(newPanelStoreKey, panelData)
        }
      }
      
      // DISABLED: Auto-pan to newly created panels
      // This was causing unwanted viewport movement when opening branch panels or floating toolbar
      // Users expect panels to appear without moving the viewport
      //
      // setTimeout(() => {
      //   const getPanelPosition = (id: string) => {
      //     if (isPlainMode) {
      //       // In plain mode, use dataStore position
      //       const dataStore = (window as any).canvasDataStore
      //       const panel = dataStore?.get(id)
      //       return panel?.position || { x: 2000, y: 1500 }
      //     } else {
      //       const panel = UnifiedProvider.getInstance().getBranchesMap().get(id)
      //       return panel?.position || null
      //     }
      //   }
      //
      //   panToPanel(
      //     panelId,
      //     getPanelPosition,
      //     canvasState,
      //     (updates) => setCanvasState(prev => ({ ...prev, ...updates })),
      //     {
      //       duration: 600,
      //       callback: () => {
      //         console.log('[AnnotationCanvas] Finished panning to panel:', panelId)
      //       }
      //     }
      //   )
      // }, 100) // Small delay to ensure panel is rendered
      
      // Get branch data to determine annotation type
      const hydratedStoreKey = ensurePanelKey(noteId, panelId)
      let branchData = dataStore?.get(hydratedStoreKey)
      if (!branchData && branchesMap) {
        branchData = branchesMap.get(hydratedStoreKey)
      }

      // Determine panel type from branch data's type field (which contains the annotation type)
      // Fallback to panelId string matching if branch data doesn't have type
      let panelType: PanelType
      if (panelId === 'main') {
        panelType = 'main'
      } else if (branchData?.type) {
        // Use the type from branch data (this is the annotation type: note/explore/promote)
        panelType = branchData.type as PanelType
      } else {
        // Fallback to string matching (for backward compatibility)
        panelType = panelId.includes('explore') ? 'explore' :
                    panelId.includes('promote') ? 'promote' : 'note'
      }

      // Map UI panel type to database panel type
      const dbPanelType: 'editor' | 'branch' | 'context' | 'toolbar' | 'annotation' =
        panelId === 'main' ? 'editor' :
        panelType === 'explore' ? 'context' :
        panelType === 'promote' ? 'annotation' : 'branch'

      // Determine position: CanvasItem.position should be WORLD-SPACE coordinates
      // The canvas transform (translate3d) handles world→screen conversion during rendering
      // Priority: 1) position/worldPosition from store (world), 2) parentPosition (screen needs conversion), 3) default (world)
      const position = (branchData?.position || branchData?.worldPosition)
        ? (branchData.position || branchData.worldPosition)  // Already world-space
        : parentPosition
          ? screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)
          : { x: 2000, y: 1500 }  // Default world position

      debugLog({
        component: 'AnnotationCanvas',
        action: 'determining_panel_position',
        metadata: {
          panelId,
          branchDataKeys: branchData ? Object.keys(branchData) : [],
          branchDataPosition: branchData?.position,
          branchDataWorldPosition: branchData?.worldPosition,
          parentPosition,
          finalPosition: position,
          hasBranchData: !!branchData,
          hasWorldPosition: !!branchData?.worldPosition,
          hasPosition: !!branchData?.position
        }
      })

      // Get panel title from branch data (for branch panels) or note title (for main panel)
      let panelTitle: string | undefined
      if (panelType !== 'main') {
        // Try to get title from branch data
        if (branchData?.preview) {
          panelTitle = branchData.preview
        } else if (branchData?.title) {
          panelTitle = branchData.title
        }
      } else {
        const mainStoreKey = ensurePanelKey(noteId, 'main')
        const mainBranch = dataStore.get(mainStoreKey)
        panelTitle =
          (mainBranch && typeof mainBranch.title === 'string' && mainBranch.title.trim().length > 0
            ? mainBranch.title
            : undefined) ?? 'Main'
      }

      debugLog({
        component: 'AnnotationCanvas',
        action: 'creating_panel_with_title',
        metadata: {
          panelId,
          panelType,
          panelTitle,
          branchDataType: branchData?.type,
          hasBranchData: !!branchData,
          hasDataStore: !!dataStore,
          hasBranchesMap: !!branchesMap,
          dataStoreHasPanel: dataStore?.has(panelId),
          branchesMapHasPanel: branchesMap?.has(panelId)
        }
      })

      // Persist panel to database with annotation type in metadata
      const defaultDimensions = { width: 500, height: 400 }
      const metadata = {
        annotationType: panelType  // Store UI panel type (note/explore/promote) for color
      }

      persistPanelCreate({
        panelId,
        storeKey: hydratedStoreKey,  // Composite key for multi-note support
        type: dbPanelType,
        position,
        size: defaultDimensions,
        zIndex: 1,
        title: panelTitle,
        metadata
      }).catch(err => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_create_persist_failed',
          metadata: {
            panelId,
            error: err instanceof Error ? err.message : 'Unknown error'
          }
        })
      })

      // Check if panel already exists in canvas items (e.g., from hydration)
      const existingPanel = prev.find(item => item.itemType === 'panel' && item.panelId === panelId)

      if (existingPanel) {
        // Panel already exists - don't create duplicate
        // This happens when clicking annotation icon after hydration loaded the panel
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_already_exists',
          metadata: {
            panelId,
            existingPosition: existingPanel.position,
            requestedPosition: position
          }
        })
        return prev
      }

      // Panel doesn't exist - create it
      return [
        ...prev,
        createPanelItem(
          panelId,
          position,
          panelType,
          noteId,
          ensurePanelKey(noteId, panelId),
        ),
      ]
    })
  }
  
  // Handle adding components
  const handleAddComponent = (type: string, position?: { x: number; y: number }) => {
    console.log('[Canvas] handleAddComponent called with type:', type, 'position:', position)

    // Calculate position - center of viewport in world coordinates
    // The canvas translate is the offset, so we need to negate it to get world position
    const viewportCenterX = window.innerWidth / 2
    const viewportCenterY = window.innerHeight / 2

    // Convert from screen space to world space
    // World position = (Screen position - Canvas translate) / zoom
    const worldX = (-canvasState.translateX + viewportCenterX) / canvasState.zoom
    const worldY = (-canvasState.translateY + viewportCenterY) / canvasState.zoom

    // Center the component (component is ~350px wide, ~300px tall)
    const finalPosition = position || {
      x: worldX - 175,
      y: worldY - 150
    }

    const stickyScreenPosition = position || {
      x: viewportCenterX - 175,
      y: viewportCenterY - 150
    }

    console.log('[Canvas] Creating component at position:', type === 'sticky-note' ? stickyScreenPosition : finalPosition)

    const newComponent = createComponentItem(
      type as 'calculator' | 'timer' | 'sticky-note' | 'dragtest' | 'perftest',
      type === 'sticky-note' ? stickyScreenPosition : finalPosition
    )

    console.log('[Canvas] Created component:', newComponent)
    console.log('[Canvas] Adding to canvasItems')
    setCanvasItems(prev => [...prev, newComponent])
  }
  
  const handleComponentClose = (id: string) => {
    setCanvasItems(prev => prev.filter(item => item.id !== id))
  }
  
  const handleComponentPositionChange = (id: string, position: { x: number; y: number }) => {
    setCanvasItems(prev => prev.map(item => 
      item.id === id ? { ...item, position } : item
    ))
  }

  const componentItems = useMemo(() => canvasItems.filter(isComponent), [canvasItems])
  const stickyNoteItems = useMemo(
    () => componentItems.filter(item => item.componentType === 'sticky-note'),
    [componentItems]
  )
  const floatingComponents = useMemo(
    () => componentItems.filter(item => item.componentType !== 'sticky-note'),
    [componentItems]
  )

  // Subscribe to panel creation events
  useEffect(() => {
    const handlePanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        handleCreatePanel(
          event.detail.panelId, 
          event.detail.parentPanelId, 
          event.detail.parentPosition
        )
      }
    }
    
    const handlePreviewPanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        // Create a temporary preview panel
        // For now, just create a regular panel - you can enhance this later
        // to show it in a special preview mode (e.g., semi-transparent, different position)
        handleCreatePanel(
          event.detail.panelId, 
          event.detail.parentPanelId, 
          event.detail.parentPosition
        )
      }
    }
    
    const handleRemovePreviewPanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        // Remove the preview panel
        handlePanelClose(event.detail.panelId)
      }
    }

    window.addEventListener('create-panel' as any, handlePanelEvent)
    window.addEventListener('preview-panel' as any, handlePreviewPanelEvent)
    window.addEventListener('remove-preview-panel' as any, handleRemovePreviewPanelEvent)
    
    return () => {
      window.removeEventListener('create-panel' as any, handlePanelEvent)
      window.removeEventListener('preview-panel' as any, handlePreviewPanelEvent)
      window.removeEventListener('remove-preview-panel' as any, handleRemovePreviewPanelEvent)
    }
  }, [noteId]) // Add noteId dependency to ensure we're using the correct note

  // Create viewport snapshot for auto-save
  const viewportSnapshot = useMemo(
    () => ({
      zoom: canvasState.zoom,
      translateX: canvasState.translateX,
      translateY: canvasState.translateY,
      showConnections: canvasState.showConnections,
    }),
    [canvasState.zoom, canvasState.translateX, canvasState.translateY, canvasState.showConnections]
  )

  useEffect(() => {
    if (!isStateLoaded) return

    // Clear existing timer before scheduling a new save
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      const success = saveStateToStorage(noteId, {
        viewport: viewportSnapshot,
        items: canvasItems,
      })

      if (!success) {
        console.warn('[AnnotationCanvas] Failed to save canvas state')
      }

      autoSaveTimerRef.current = null
    }, CANVAS_STORAGE_DEBOUNCE)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [noteId, viewportSnapshot, canvasItems, isStateLoaded])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      updateCanvasTransform(prev => {
        const newZoom = Math.min(prev.zoom * 1.1, 2)
        const next = { ...prev, zoom: newZoom }
        onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections })
        return next
      })
    },
    zoomOut: () => {
      updateCanvasTransform(prev => {
        const newZoom = Math.max(prev.zoom * 0.9, 0.3)
        const next = { ...prev, zoom: newZoom }
        onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections })
        return next
      })
    },
    resetView: () => {
      updateCanvasTransform(prev => {
        const next = { ...prev, zoom: 1, translateX: -1000, translateY: -1200 }
        onCanvasStateChange?.({ zoom: 1, showConnections: prev.showConnections })
        return next
      })
    },
    panBy,
    toggleConnections: () => {
      setCanvasState(prev => {
        const newShowConnections = !prev.showConnections
        const newState = { ...prev, showConnections: newShowConnections }
        onCanvasStateChange?.({ zoom: prev.zoom, showConnections: newShowConnections })
        return newState
      })
    },
    centerOnPanel: (panelId: string) => {
      const getPanelPosition = (id: string): { x: number; y: number } | null => {
        // 1) Try collaboration map if not in plain mode
        const provider = UnifiedProvider.getInstance()
        if (!isPlainModeActive()) {
          const branchesMap = provider.getBranchesMap()
          const branch = branchesMap?.get(id)
          if (branch?.position) return branch.position
        }
        
        // 2) DOM lookup (plain mode)
        const el = document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement | null
        if (el) {
          const rect = el.getBoundingClientRect()
          const container = document.getElementById('canvas-container')
          const containerRect = container?.getBoundingClientRect()
          
          // Get the center of the panel relative to the container
          const screenX = (rect.left + rect.width / 2) - (containerRect?.left ?? 0)
          const screenY = (rect.top + rect.height / 2) - (containerRect?.top ?? 0)
          
          // Convert screen coordinates to world coordinates
          // The panel's world position when canvas has translate(tx, ty) scale(zoom):
          // screenPos = (worldPos + translate) * zoom
          // Therefore: worldPos = screenPos / zoom - translate
          const worldX = (screenX / canvasState.zoom) - canvasState.translateX
          const worldY = (screenY / canvasState.zoom) - canvasState.translateY
          
          return { x: worldX, y: worldY }
        }
        
        // 3) Don't use fallback immediately - return null to trigger retry
        return null
      }

      console.log(`[Canvas] Attempting to center on panel '${panelId}'`)
      
      // Retry mechanism: wait for panel to be in DOM
      let retryCount = 0
      const maxRetries = 10
      const retryDelay = 100 // ms
      
      const attemptCenter = () => {
        const position = getPanelPosition(panelId)

        if (position) {
          console.log(`[Canvas] Panel '${panelId}' found, centering instantly (no animation)...`)

          debugLog({
            component: 'AnnotationCanvas',
            action: 'center_on_panel',
            metadata: {
              panelId,
              position
            }
          })

          // Get actual panel dimensions from DOM
          const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement
          const panelDimensions = panelElement
            ? { width: panelElement.offsetWidth, height: panelElement.offsetHeight }
            : { width: 500, height: 400 }  // Fallback if panel not found

          const viewportDimensions = { width: window.innerWidth, height: window.innerHeight }

          debugLog({
            component: 'AnnotationCanvas',
            action: 'panel_dimensions',
            metadata: {
              panelId,
              panelFound: !!panelElement,
              panelDimensions,
              viewportDimensions,
              zoom: canvasState.zoom
            }
          })

          // Calculate offset to center the panel (from panToPanel)
          const centerOffset = {
            x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / canvasState.zoom,
            y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / canvasState.zoom
          }

          // Calculate target viewport position (from smoothPanTo)
          const targetX = -position.x + centerOffset.x
          const targetY = -position.y + centerOffset.y

          debugLog({
            component: 'AnnotationCanvas',
            action: 'calculated_target',
            metadata: {
              panelId,
              position,
              targetX,
              targetY,
              currentX: canvasState.translateX,
              currentY: canvasState.translateY
            }
          })

          // Get canvas DOM element for direct manipulation
          const canvasEl = document.getElementById('infinite-canvas')

          if (canvasEl) {
            // Step 1: Disable transition directly on DOM
            const originalTransition = canvasEl.style.transition
            canvasEl.style.transition = 'none'

            // Force reflow to apply transition change
            void canvasEl.offsetHeight

            debugLog({
              component: 'AnnotationCanvas',
              action: 'transition_disabled_dom',
              metadata: { panelId, originalTransition }
            })
          }

          // Step 2: Update React state with new coordinates
          flushSync(() => {
            setCanvasState(prev => ({
              ...prev,
              translateX: targetX,
              translateY: targetY
            }))
          })

          // ✅ CRITICAL FIX: Sync to context to prevent stale state on first drag
          // Without this, panCameraBy reads old translateX=-1000 from context
          // causing panels to snap on first auto-scroll
          dispatch({
            type: 'SET_CANVAS_STATE',
            payload: {
              translateX: targetX,
              translateY: targetY
            }
          })

          debugLog({
            component: 'AnnotationCanvas',
            action: 'viewport_updated_instant',
            metadata: { panelId, targetX, targetY }
          })

          debugLog({
            component: 'AnnotationCanvas',
            action: 'centerOnPanel_context_synced',
            metadata: { panelId, targetX, targetY }
          })

          // Step 3: Restore transition after transform is applied
          if (canvasEl) {
            requestAnimationFrame(() => {
              canvasEl.style.transition = ''  // Clear inline style, let React control it
              debugLog({
                component: 'AnnotationCanvas',
                action: 'transition_restored_dom',
                metadata: { panelId }
              })
            })
          }
        } else if (retryCount < maxRetries) {
          retryCount++
          console.log(`[Canvas] Panel '${panelId}' not found, retry ${retryCount}/${maxRetries}`)
          setTimeout(attemptCenter, retryDelay)
        } else {
          // Final fallback: calculate viewport-centered position
          console.warn(`[Canvas] Panel '${panelId}' not found after ${maxRetries} retries, using viewport center`)
          
          // Calculate position to place panel at viewport center
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const panelWidth = 800
          const panelHeight = 600
          
          // Calculate world position that would appear centered
          const centerWorldX = (viewportWidth / 2 - panelWidth / 2) / canvasState.zoom - canvasState.translateX
          const centerWorldY = (viewportHeight / 2 - panelHeight / 2) / canvasState.zoom - canvasState.translateY
          
          // For new panels, we actually want them to appear centered
          // So we don't pan, we just note where they should be created
          console.log(`[Canvas] Panel should be created at world position (${centerWorldX}, ${centerWorldY}) to appear centered`)
        }
      }
      
      attemptCenter()
    },
    addComponent: (type: string, position?: { x: number; y: number }) => {
      handleAddComponent(type, position)
    }
  }), [onCanvasStateChange, canvasState, updateCanvasTransform, panBy, handleAddComponent])

  return (
      <div
        className="w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500"
        style={{
          opacity: canvasOpacity,
          transition: 'opacity 0.3s ease',
        }}
      >
        {/* Demo Header - Disabled per user request */}
        {/* <div className="fixed top-0 left-0 right-0 bg-black/90 text-white p-3 text-xs font-medium z-[1000] border-b border-white/10 flex items-center justify-between">
          <span>🚀 Yjs-Ready Unified Knowledge Canvas • Collaborative-Ready Architecture with Tiptap Editor</span>
          <span className="text-gray-300 flex items-center gap-2">
            <span className="text-yellow-400">💡</span>
            Hold <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs font-bold">Shift</kbd> + Scroll to zoom
          </span>
        </div> */}

        {/* Canvas Controls - Removed per user request */}
        {/* {!isNotesExplorerOpen && (
          <CanvasControls 
            zoom={canvasState.zoom}
            onZoomIn={() => setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.1, 2) }))}
            onZoomOut={() => setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.9, 0.3) }))}
            onResetView={() => setCanvasState(prev => ({ ...prev, zoom: 1, translateX: -1000, translateY: -1200 }))}
            onToggleConnections={() => setCanvasState(prev => ({ ...prev, showConnections: !prev.showConnections }))}
            showConnections={canvasState.showConnections}
          />
        )} */}
        
        {/* Control Panel Toggle Button - Always visible */}
        <button
          onClick={() => setShowControlPanel(!showControlPanel)}
          className="fixed top-16 right-4 z-[900] p-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg shadow-lg transition-all duration-200 hover:scale-110"
          title="Toggle Control Panel"
        >
          <Settings size={20} />
        </button>
        
        {/* Add Components Button - Moved to sidebar */}

        {/* Enhanced Control Panel V2 - Wider with always-visible metrics */}
        <EnhancedControlPanelV2 
          visible={showControlPanel}
          onClose={() => setShowControlPanel(false)}
          canvasItems={canvasItems}
          onAddComponent={handleAddComponent}
        />
        
        {/* Isolation Debug Panel - Only in development */}
        {/* Isolation Debug now integrated into Control Panel */}

        {/* Enhanced Minimap */}
        <EnhancedMinimap 
          canvasItems={canvasItems}
          canvasState={canvasState}
          onNavigate={(x, y) => updateCanvasTransform(prev => ({ ...prev, translateX: x, translateY: y }))}
        />
        
        {/* Add Components Menu */}
        <AddComponentMenu 
          visible={showAddComponentMenu}
          onClose={() => {
            if (onToggleAddComponentMenu && externalShowAddComponentMenu) {
              onToggleAddComponentMenu()
            } else {
              setInternalShowAddComponentMenu(false)
            }
          }}
          onAddComponent={handleAddComponent}
        />

        {/* Canvas Container */}
        <div 
          id="canvas-container"
          className={`relative w-full h-full cursor-grab overflow-hidden ${canvasState.isDragging ? 'cursor-grabbing' : ''}`}
          style={{
            // Isolate canvas painting to avoid cross-layer re-rasterization while dragging
            contain: 'layout paint',
            isolation: 'isolate',
            // Stabilize font rendering during transforms
            WebkitFontSmoothing: 'antialiased',
            textRendering: 'optimizeLegibility',
          }}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Infinite Canvas */}
          <div
            id="infinite-canvas"
            style={{
              position: 'absolute',
              // Use translate3d without rounding for smooth motion (infinite-canvas approach)
              transform: `translate3d(${canvasState.translateX}px, ${canvasState.translateY}px, 0) scale(${canvasState.zoom})`,
              transformOrigin: '0 0',
              // Critical: NO transition during drag to prevent text blinking
              transition: canvasState.isDragging ? 'none' : 'transform 0.3s ease',
              // Optimize GPU layers only during active drag
              willChange: canvasState.isDragging ? 'transform' : 'auto',
              // Force stable GPU layer composition
              backfaceVisibility: 'hidden' as const,
              transformStyle: 'preserve-3d' as const,
            }}
          >
            {/* Connection Lines - Widget Studio Style */}
            {canvasState.showConnections && (!isPlainModeActive() || hydrationStatus.success) && (
              <WidgetStudioConnections
                key={canvasContextState.lastUpdate ?? 0}
                canvasItems={canvasItems}
                branchVersion={canvasContextState.lastUpdate ?? 0}
              />
            )}

            {/* Panels */}
        <PanelsRenderer
          noteId={noteId}
          canvasItems={canvasItems}
          dataStore={dataStore}
          onClose={handlePanelClose}
        />
            
            {/* Component Panels */}
            {floatingComponents.map(component => (
              <ComponentPanel
                key={component.id}
                id={component.id}
                type={component.componentType!}
                position={component.position}
                onClose={handleComponentClose}
                onPositionChange={handleComponentPositionChange}
              />
            ))}
          </div>
        </div>

        {stickyOverlayEl && stickyNoteItems.length > 0 && createPortal(
          stickyNoteItems.map(component => (
            <StickyNoteOverlayPanel
              key={component.id}
              id={component.id}
              position={component.position}
              onClose={handleComponentClose}
              onPositionChange={handleComponentPositionChange}
            />
          )),
          stickyOverlayEl
        )}

        {/* Annotation Toolbar - controlled by Actions button */}
        <AnnotationToolbar />

      </div>
  )
})

const ModernAnnotationCanvas = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>((props, ref) => {
  const { getWorkspace } = useCanvasWorkspace()
  const workspace = useMemo(() => getWorkspace(props.noteId), [getWorkspace, props.noteId])

  return (
    <IsolationProvider config={{ enabled: false }}>
      <LayerManagerProvider manager={workspace.layerManager}>
        <CanvasProvider
          noteId={props.noteId}
          onRegisterActiveEditor={props.onRegisterActiveEditor}
          externalDataStore={workspace.dataStore}
          externalEvents={workspace.events}
        >
          <ModernAnnotationCanvasInner {...props} ref={ref} />
          {props.children}
        </CanvasProvider>
      </LayerManagerProvider>
    </IsolationProvider>
  )
})

ModernAnnotationCanvas.displayName = 'ModernAnnotationCanvas'

// Renders panels using plain dataStore in plain mode, Yjs map otherwise
function PanelsRenderer({
  noteId,
  canvasItems,
  dataStore,
  onClose,
}: {
  noteId: string
  canvasItems: CanvasItem[]
  dataStore: DataStore
  onClose: (id: string) => void
}) {
  const isPlainMode = isPlainModeActive()
  
  // Yjs access only when not in plain mode
  const provider = UnifiedProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(noteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null
  
  const panels = canvasItems.filter(isPanel)
  
  return (
    <>
      {panels.map((panel) => {
        const panelId = panel.panelId!
        const storeKey = panel.storeKey ?? ensurePanelKey(noteId, panelId)
        const branch = isPlainMode ? dataStore.get(storeKey) : branchesMap?.get(storeKey)
        if (!branch) {
          console.warn(
            `[PanelsRenderer] Branch ${panelId} (storeKey=${storeKey}) not found in ${isPlainMode ? 'plain' : 'yjs'} store`,
          )
          return null
        }

        // Debug: Log branch type being passed to CanvasPanel
        debugLog({
          component: 'AnnotationCanvas',
          action: 'rendering_panel',
          metadata: {
            panelId,
            branchType: branch.type,
            branchDbType: branch.dbType,
            branchMetadata: branch.metadata,
            isPlainMode
          }
        })
        
        console.log(`[PanelsRenderer] Rendering panel ${panelId}:`, {
          hasContent: !!branch.content,
          contentLength: typeof branch.content === 'string' ? branch.content.length : 'N/A',
          isNew: branch.isNew,
          isEditable: branch.isEditable
        })
        
        const position = branch.position || { x: 2000, y: 1500 }
        return (
          <CanvasPanel
            key={panelId}
            panelId={panelId}
            branch={branch}
            position={position}
            noteId={noteId}
            onClose={() => onClose(panelId)}
          />
        )
      })}
    </>
  )
}

export default ModernAnnotationCanvas 
