"use client"

import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
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
import { Settings } from "lucide-react"
import { AddComponentMenu } from "./canvas/add-component-menu"
import { ComponentPanel } from "./canvas/component-panel"
import { StickyNoteOverlayPanel } from "./canvas/sticky-note-overlay-panel"
import { CanvasItem, createPanelItem, createComponentItem, isPanel, isComponent, PanelType } from "@/types/canvas-items"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
// IsolationDebugPanel now integrated into EnhancedControlPanelV2
import { loadStateFromStorage } from "@/lib/canvas/canvas-storage"
import { getPlainProvider } from "@/lib/provider-switcher"
import { worldToScreen, screenToWorld } from "@/lib/canvas/coordinate-utils"
import { debugLog, isDebugEnabled } from "@/lib/utils/debug-logger"
import { useCanvasHydration } from "@/lib/hooks/use-canvas-hydration"
import { useCameraPersistence } from "@/lib/hooks/use-camera-persistence"
import { usePanelPersistence } from "@/lib/hooks/use-panel-persistence"
import { useCanvasTransform } from "@/lib/hooks/annotation/use-canvas-transform"
import { useCanvasItems } from "@/lib/hooks/annotation/use-canvas-items"
import { useCanvasNoteSync } from "@/lib/hooks/annotation/use-canvas-note-sync"
import { useCanvasAutosave } from "@/lib/hooks/annotation/use-canvas-autosave"
import { useCanvasSnapshotLifecycle } from "@/lib/hooks/annotation/use-canvas-snapshot-lifecycle"
import { LayerManagerProvider, useLayerManager } from "@/lib/hooks/use-layer-manager"
import { useCanvasWorkspace, SHARED_WORKSPACE_ID, type OpenWorkspaceNote } from "./canvas/canvas-workspace-context"
import { useCameraUserId } from "@/lib/hooks/use-camera-scope"
import { dedupeCanvasItems } from "@/lib/canvas/dedupe-canvas-items"
import { scheduleCanvasSnapshotDedupeMigration } from "@/lib/migrations/dedupe-snapshots-v1"
import { Z_INDEX } from "@/lib/constants/z-index"
import { useCanvasHydrationSync } from "@/lib/hooks/annotation/use-canvas-hydration-sync"
import { useWorkspaceHydrationSeed } from "@/lib/hooks/annotation/use-workspace-hydration-seed"
import { useDefaultMainPanelPersistence } from "@/lib/hooks/annotation/use-default-main-panel-persistence"
import { useCollaborativeNoteInitialization } from "@/lib/hooks/annotation/use-collaborative-note-initialization"
import { useSelectionGuards } from "@/lib/hooks/annotation/use-selection-guards"
import { useCanvasDragListeners } from "@/lib/hooks/annotation/use-canvas-drag-listeners"
import { useStickyOverlay } from "@/lib/hooks/annotation/use-sticky-overlay"
import { useCanvasInteractionCapture } from "@/lib/hooks/annotation/use-canvas-interaction-capture"
import { useCanvasPointerHandlers } from "@/lib/hooks/annotation/use-canvas-pointer-handlers"
import { useMinimapNavigation } from "@/lib/hooks/annotation/use-minimap-navigation"
import { usePanelCloseHandler } from "@/lib/hooks/annotation/use-panel-close-handler"
import { useCameraSnapshotPersistence } from "@/lib/hooks/annotation/use-camera-snapshot-persistence"
import { useCanvasContextSync } from "@/lib/hooks/annotation/use-canvas-context-sync"
import { useWorkspaceSeedRegistry } from "@/lib/hooks/annotation/use-workspace-seed-registry"
import { usePanelCentering } from "@/lib/hooks/annotation/use-panel-centering"
import {
  createDefaultCanvasState,
  createDefaultCanvasItems,
  defaultViewport,
  ensureMainPanel,
  getDefaultMainPosition,
  isDefaultMainPosition,
  LEGACY_DEFAULT_MAIN_POSITION,
} from "@/lib/canvas/canvas-defaults"
const PENDING_SAVE_MAX_AGE_MS = 5 * 60 * 1000

interface ModernAnnotationCanvasProps {
  noteIds: string[]
  primaryNoteId: string | null
  freshNoteSeeds?: Record<string, { x: number; y: number }>
  onConsumeFreshNoteSeed?: (noteId: string) => void
  isNotesExplorerOpen?: boolean
  onCanvasStateChange?: (state: {
    zoom: number
    showConnections: boolean
    translateX: number
    translateY: number
    lastInteraction?: { x: number; y: number } | null
  }) => void
  mainOnlyNoteIds?: string[]
  onMainOnlyLayoutHandled?: (noteId: string) => void
  showAddComponentMenu?: boolean
  onToggleAddComponentMenu?: () => void
  onRegisterActiveEditor?: (editorRef: any, panelId: string) => void
  onSnapshotLoadComplete?: () => void  // Called after snapshot load + centering completes
  skipSnapshotForNote?: string | null
  onSnapshotSettled?: (noteId: string) => void
  children?: React.ReactNode  // Toolbar and other components rendered inside CanvasProvider
  freshNoteIds?: string[]
  onFreshNoteHydrated?: (noteId: string) => void
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

interface NoteHydratorProps {
  noteId: string
  userId?: string
  dataStore: DataStore
  branchesMap: Map<string, any>
  layerManager: ReturnType<typeof useLayerManager>['manager']
  onHydration: (noteId: string, status: ReturnType<typeof useCanvasHydration>) => void
  enabled?: boolean
  workspaceVersion?: number | null
}

function NoteHydrator({
  noteId,
  userId,
  dataStore,
  branchesMap,
  layerManager,
  onHydration,
  enabled = true,
  workspaceVersion,
}: NoteHydratorProps) {
  const status = useCanvasHydration({
    noteId,
    userId,
    dataStore,
    branchesMap,
    layerManager,
    enabled,
    workspaceVersion: workspaceVersion ?? undefined,
  })

  useEffect(() => {
    onHydration(noteId, status)
  }, [noteId, status, onHydration])

  return null
}


// helper functions moved to lib/canvas/canvas-defaults.ts

const ModernAnnotationCanvasInner = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>(({ 
  noteIds,
  primaryNoteId,
  freshNoteSeeds = {},
  onConsumeFreshNoteSeed,
  isNotesExplorerOpen = false,
  onCanvasStateChange,
  mainOnlyNoteIds = [],
  onMainOnlyLayoutHandled,
  showAddComponentMenu: externalShowAddComponentMenu,
  onToggleAddComponentMenu,
  onSnapshotLoadComplete,
  skipSnapshotForNote,
  onSnapshotSettled,
  freshNoteIds = [],
  onFreshNoteHydrated
}, ref) => {
  const noteId = primaryNoteId ?? noteIds[0] ?? ""
  const hasNotes = noteIds.length > 0 && noteId.length > 0

  if (!hasNotes) {
    return null
  }
  const { state: canvasContextState, dispatch, dataStore } = useCanvas()
  const {
    openNotes,
    updateMainPosition,
    getPendingPosition,
    getCachedPosition,
    closeNote
  } = useCanvasWorkspace()
  const workspaceNoteMap = useMemo(() => {
    const map = new Map<string, OpenWorkspaceNote>()
    openNotes.forEach(note => map.set(note.noteId, note))
    return map
  }, [openNotes])
  const activeWorkspaceVersion = workspaceNoteMap.get(noteId)?.version ?? null
  const freshNoteSet = useMemo(() => new Set(freshNoteIds), [freshNoteIds])
  const mainOnlyNoteSet = useMemo(() => new Set(mainOnlyNoteIds), [mainOnlyNoteIds])
  const isDefaultOffscreenPosition = useCallback((position: { x: number; y: number } | null | undefined) => {
    return isDefaultMainPosition(position)
  }, [])

  const resolveWorkspacePosition = useCallback((targetNoteId: string): { x: number; y: number } | null => {
    // CRITICAL FIX: Check workspace mainPosition FIRST (set by openWorkspaceNote)
    // This ensures that newly computed viewport-centered positions override any stale cached positions
    const workspaceEntry = workspaceNoteMap.get(targetNoteId)
    if (workspaceEntry?.mainPosition && !isDefaultOffscreenPosition(workspaceEntry.mainPosition)) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'resolve_workspace_position_from_entry',
        metadata: {
          targetNoteId,
          position: workspaceEntry.mainPosition,
          source: 'workspaceEntry.mainPosition'
        }
      })
      return workspaceEntry.mainPosition
    }

    const pending = getPendingPosition(targetNoteId)
    if (pending && !isDefaultOffscreenPosition(pending)) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'resolve_workspace_position_from_pending',
        metadata: {
          targetNoteId,
          position: pending,
          source: 'pendingPosition'
        }
      })
      return pending
    }

    const cached = getCachedPosition(targetNoteId)
    if (cached && !isDefaultOffscreenPosition(cached)) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'resolve_workspace_position_from_cache',
        metadata: {
          targetNoteId,
          position: cached,
          source: 'cachedPosition'
        }
      })
      return cached
    }

    debugLog({
      component: 'AnnotationCanvas',
      action: 'resolve_workspace_position_null',
      metadata: {
        targetNoteId,
        source: 'none_found'
      }
    })

    return null
  }, [workspaceNoteMap, getPendingPosition, getCachedPosition, isDefaultOffscreenPosition])

  const workspaceMainPosition = useMemo(() => resolveWorkspacePosition(noteId), [noteId, resolveWorkspacePosition])
  const getItemNoteId = useCallback((item: CanvasItem): string | null => {
    if (item.noteId) return item.noteId
    if (item.storeKey) {
      const parsed = parsePanelKey(item.storeKey)
      if (parsed.noteId) return parsed.noteId
    }
    return null
  }, [])

  // Layer system for multi-layer canvas
  const layerContext = useLayer()
  const canvasOpacity = layerContext ? PopupStateAdapter.getLayerOpacity('notes', layerContext.activeLayer) : 1

  const getInitialCanvasState = useCallback(() => {
    const snapshot = activeWorkspaceVersion !== null
      ? loadStateFromStorage(noteId, activeWorkspaceVersion)
      : loadStateFromStorage(noteId)
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
  }, [noteId, activeWorkspaceVersion])

  const {
    canvasState,
    setCanvasState,
    canvasStateRef,
    updateCanvasTransform,
    panBy,
    lastCanvasEventRef,
  } = useCanvasTransform({
    noteId,
    layerContext,
    onCanvasStateChange,
    initialStateFactory: getInitialCanvasState,
  })

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
  const workspaceSeededNotesRef = useRef<Set<string>>(new Set())
  const {
    canvasItems,
    setCanvasItems,
    canvasItemsRef,
    dedupeWarnings,
    updateDedupeWarnings,
  } = useCanvasItems({ noteId })
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const autoSaveTimerRef = useRef<number | null>(null)
  const [showControlPanel, setShowControlPanel] = useState(false)
  const [internalShowAddComponentMenu, setInternalShowAddComponentMenu] = useState(false)
  const mainPanelSeededRef = useRef(false)

  useCanvasNoteSync({
    hasNotes,
    noteIds,
    noteId,
    canvasItemsLength: canvasItems.length,
    mainOnlyNoteSet,
    freshNoteSeeds,
    onConsumeFreshNoteSeed,
    setCanvasItems,
    getItemNoteId,
    resolveWorkspacePosition,
  })

  useWorkspaceSeedRegistry({
    noteId,
    workspaceSeededNotesRef,
    mainPanelSeededRef,
    debugLog,
  })
  const isRestoringSnapshotRef = useRef(false)
  const skipNextContextSyncRef = useRef(false)

  useEffect(() => {
    if (!mainOnlyNoteIds || mainOnlyNoteIds.length === 0) {
      return
    }

    setCanvasItems(prev => {
      let changed = false
      const filtered = prev.filter(item => {
        if (item.itemType !== 'panel' || item.panelId === 'main') {
          return true
        }
        const itemNoteId = getItemNoteId(item)
        if (itemNoteId && mainOnlyNoteSet.has(itemNoteId)) {
          changed = true
          return false
        }
        return true
      })
      return changed ? filtered : prev
    })
  }, [mainOnlyNoteIds, mainOnlyNoteSet, setCanvasItems, getItemNoteId])
  
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
  // Skip camera restore for centered existing notes (main-only mode)
  const skipCameraRestore = mainOnlyNoteSet.has(noteId)

  const primaryHydrationStatus = useCanvasHydration({
    noteId,
    userId: cameraUserId ?? undefined,
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    enabled: Boolean(noteId),
    skipCameraRestore
  })

  const initialCanvasSetupRef = useRef(false)

  useWorkspaceHydrationSeed({
    noteId,
    workspaceMainPosition,
    hydrationSuccess: primaryHydrationStatus.success,
    canvasItems,
    setCanvasItems,
    getItemNoteId,
    workspaceSeededNotesRef,
  })

  // Enable camera persistence (debounced)
  useCameraPersistence({
    noteId,
    userId: cameraUserId ?? undefined,
    debounceMs: 500,
    enabled: true
  })

  // Enable panel persistence
  const { persistPanelCreate, persistPanelUpdate, getPanelDimensions } = usePanelPersistence({
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    noteId,
    canvasItems,
    userId: cameraUserId ?? undefined
  })

  const { handleNoteHydration } = useCanvasHydrationSync({
    noteId,
    hydrationStatus: primaryHydrationStatus,
    canvasItems,
    setCanvasItems,
    getItemNoteId,
    resolveWorkspacePosition,
    canvasStateRef,
    mainOnlyNoteSet,
    dispatch,
    workspaceSeededNotesRef,
    initialCanvasSetupRef,
    freshNoteSet,
    onFreshNoteHydrated,
  })

  useEffect(() => {
    if (!noteId) return
    handleNoteHydration(noteId, primaryHydrationStatus)
  }, [noteId, primaryHydrationStatus, handleNoteHydration])

  const persistCameraSnapshot = useCameraSnapshotPersistence(noteId, cameraUserId ?? null)

  useDefaultMainPanelPersistence({
    noteId,
    hydrationStatus: primaryHydrationStatus,
    canvasItems,
    setCanvasItems,
    getItemNoteId,
    workspaceMainPosition,
    canvasStateRef,
    getPanelDimensions,
    persistPanelCreate,
    dataStore,
    updateMainPosition,
    mainPanelSeededRef,
  })

  const handleMinimapNavigate = useMinimapNavigation(updateCanvasTransform)

  useCanvasContextSync({
    canvasContextState,
    setCanvasState,
    isRestoringSnapshotRef,
    skipNextContextSyncRef,
    noteId,
    debugLog,
  })

  useCollaborativeNoteInitialization({
    noteId,
    workspaceMainPosition,
    provider,
  })

  useCanvasSnapshotLifecycle({
    noteId,
    activeWorkspaceVersion,
    skipSnapshotForNote,
    workspaceMainPosition,
    canvasState,
    canvasStateRef,
    canvasItems,
    getItemNoteId,
    isDefaultOffscreenPosition,
    setCanvasState,
    setCanvasItems,
    setIsStateLoaded,
    autoSaveTimerRef,
    initialCanvasSetupRef,
    skipNextContextSyncRef,
    isRestoringSnapshotRef,
    getPendingPosition,
    getCachedPosition,
    freshNoteSet,
    freshNoteSeeds,
    onSnapshotLoadComplete,
    onSnapshotSettled,
    pendingSaveMaxAgeMs: PENDING_SAVE_MAX_AGE_MS,
    dispatch,
    updateDedupeWarnings,
    primaryHydrationStatus,
    dataStore,
  })

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [])

  const {
    captureInteractionPoint,
    handleMouseMoveCapture: handleCanvasMouseMoveCapture,
    handleWheelCapture: handleCanvasWheelCapture,
  } = useCanvasInteractionCapture({
    lastInteractionRef: lastCanvasEventRef,
  })

  const { enableSelectionGuards, disableSelectionGuards } = useSelectionGuards()

  const {
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleWheel,
  } = useCanvasPointerHandlers({
    captureInteractionPoint,
    setCanvasState,
    canvasStateRef,
    updateCanvasTransform,
    enableSelectionGuards,
    disableSelectionGuards,
    canvasState,
  })

  useCanvasDragListeners({
    isDragging: canvasState.isDragging,
    onMouseMove: handleCanvasMouseMove,
    onMouseUp: handleCanvasMouseUp,
  })

  const handleOverlayMount = useCallback(
    (overlay: HTMLDivElement) => {
      setStickyOverlayEl(overlay)
    },
    [setStickyOverlayEl],
  )

  const handleOverlayUnmount = useCallback(() => {
    setStickyOverlayEl(null)
  }, [setStickyOverlayEl])

  useStickyOverlay(handleOverlayMount, handleOverlayUnmount)

  const handlePanelClose = usePanelCloseHandler({
    noteId,
    setCanvasItems,
    getItemNoteId,
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    dispatch,
    persistPanelUpdate,
    closeNote,
  })

  const handleCreatePanel = (panelId: string, parentPanelId?: string, parentPosition?: { x: number, y: number }, sourceNoteId?: string, isPreview?: boolean, coordinateSpace?: 'screen' | 'world') => {
    const targetNoteId = sourceNoteId || noteId
    if (!targetNoteId) {
      console.warn('[AnnotationCanvas] Cannot create panel without target note id', panelId)
      return
    }

    console.log('[AnnotationCanvas] Creating panel:', panelId, 'for note:', targetNoteId, 'with parent:', parentPanelId, 'at position:', parentPosition)

    if (isDebugEnabled()) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'handle_create_panel',
        metadata: {
          panelId,
          parentPanelId,
          parentPosition,
          isPlainMode: isPlainModeActive(),
          noteId: targetNoteId
        },
        content_preview: `Creating panel ${panelId} at x=${parentPosition?.x}, y=${parentPosition?.y}`,
        note_id: targetNoteId
      }).catch(console.error)
    }

    const isPlainMode = isPlainModeActive()

    setCanvasItems(prev => {
      const newPanelStoreKey = ensurePanelKey(targetNoteId, panelId)

      if (isDebugEnabled()) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'create_panel_check_existing',
          metadata: {
            panelId,
            targetNoteId,
            newPanelStoreKey,
            currentCanvasItemsCount: prev.length,
            panelIdsInItems: prev.filter(isPanel).map(p => ({ panelId: p.panelId, noteId: getItemNoteId(p) }))
          },
          content_preview: `Checking if panel ${panelId} already exists in ${prev.length} items`
        })
      }

      const existingPanelCheck = prev.some(item => isPanel(item) && item.panelId === panelId && getItemNoteId(item) === targetNoteId)

      if (existingPanelCheck) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'create_panel_early_return',
          metadata: {
            panelId,
            targetNoteId,
            reason: 'Panel already exists in canvasItems'
          },
          content_preview: `EARLY RETURN: Panel ${panelId} already exists, not creating`
        })
        return prev
      }

      debugLog({
        component: 'AnnotationCanvas',
        action: 'create_panel_proceeding',
        metadata: {
          panelId,
          targetNoteId,
          isPlainMode: isPlainModeActive()
        },
        content_preview: `Proceeding to create panel ${panelId}`
      })

      if (isPlainMode) {
        if (parentPosition && (window as any).canvasDataStore) {
          const dataStore = (window as any).canvasDataStore
          const existingPanelData = dataStore.get(newPanelStoreKey)

          if (!existingPanelData?.worldPosition) {
            // Only convert screen->world if position is in screen space
            // If coordinateSpace is 'world', parentPosition is already in world coordinates
            const worldPosition = coordinateSpace === 'world'
              ? parentPosition
              : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)

            dataStore.update(newPanelStoreKey, {
              id: panelId,
              position: worldPosition,
              worldPosition
            })
          }
        }
      } else {
        const provider = UnifiedProvider.getInstance()
        provider.setCurrentNote(targetNoteId)

        const yjsBranches = provider.getBranchesMap()
        const panelData = yjsBranches.get(newPanelStoreKey)

        if (!panelData) {
          console.warn(`No data found for panel ${panelId} (note ${targetNoteId})`)
          return prev
        }

        if (parentPosition) {
          // Only convert screen->world if position is in screen space
          // If coordinateSpace is 'world', parentPosition is already in world coordinates
          const worldPosition = coordinateSpace === 'world'
            ? parentPosition
            : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)

          panelData.position = worldPosition
          yjsBranches.set(newPanelStoreKey, panelData)
        }
      }

      const hydratedStoreKey = newPanelStoreKey
      let branchData = dataStore?.get(hydratedStoreKey)
      if (!branchData && branchesMap) {
        branchData = branchesMap.get(hydratedStoreKey)
      }

      let panelType: PanelType
      if (panelId === 'main') {
        panelType = 'main'
      } else if (branchData?.type) {
        panelType = branchData.type as PanelType
      } else {
        panelType = panelId.includes('explore') ? 'explore' : panelId.includes('promote') ? 'promote' : 'note'
      }

      const dbPanelType: 'editor' | 'branch' | 'context' | 'toolbar' | 'annotation' =
        panelId === 'main' ? 'editor' :
        panelType === 'explore' ? 'context' :
        panelType === 'promote' ? 'annotation' : 'branch'

      // For preview panels from dropdown, the parentPosition is already in screen coordinates
      // We DON'T need to convert since the dropdown is fixed and preview should appear adjacent to it
      // Panels are rendered with position:absolute inside the canvas, so we use screen coords directly
      const position = isPreview && parentPosition
        ? (() => {
            console.log('[AnnotationCanvas] Using preview screen position directly:', {
              isPreview,
              position: parentPosition,
              note: 'Screen coordinates from fixed dropdown'
            })
            return parentPosition  // Already screen coordinates, no conversion needed
          })()
        : (branchData?.position || branchData?.worldPosition)
          ? (branchData.position || branchData.worldPosition)
          : parentPosition
            ? (coordinateSpace === 'world'
                ? parentPosition  // Already in world coordinates, no conversion needed
                : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom))
            : { x: 2000, y: 1500 }

      let panelTitle: string | undefined
      if (panelType !== 'main') {
        if (branchData?.preview) {
          panelTitle = branchData.preview
        } else if (branchData?.title) {
          panelTitle = branchData.title
        }
      } else {
        const mainStoreKey = ensurePanelKey(targetNoteId, 'main')
        const mainBranch = dataStore.get(mainStoreKey)
        panelTitle =
          (mainBranch && typeof mainBranch.title === 'string' && mainBranch.title.trim().length > 0
            ? mainBranch.title
            : undefined) ?? 'Main'
      }

      // Use the provided coordinateSpace, or determine it based on position source
      const effectiveCoordinateSpace = coordinateSpace ?? ((isPreview && parentPosition) ? 'screen' : 'world')

      const persistencePosition = effectiveCoordinateSpace === 'screen' && parentPosition
        ? parentPosition
        : position

      persistPanelCreate({
        panelId,
        storeKey: hydratedStoreKey,
        type: dbPanelType,
        position: persistencePosition,
        size: { width: 500, height: 400 },
        zIndex: 1,
        title: panelTitle,
        metadata: { annotationType: panelType },
        coordinateSpace: effectiveCoordinateSpace
      }).catch(err => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_create_persist_failed',
          metadata: {
            panelId,
            noteId: targetNoteId,
            error: err instanceof Error ? err.message : 'Unknown error'
          }
        })
      })

      persistPanelUpdate({
        panelId,
        storeKey: hydratedStoreKey,
        position: persistencePosition,
        coordinateSpace: effectiveCoordinateSpace,
        state: 'active'
      }).catch(err => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_state_active_persist_failed',
          metadata: {
            panelId,
            noteId: targetNoteId,
            error: err instanceof Error ? err.message : 'Unknown error'
          }
        })
      })

      const existingPanel = prev.find(item => item.itemType === 'panel' && item.panelId === panelId && getItemNoteId(item) === targetNoteId)
      if (existingPanel) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_already_exists',
          metadata: {
            panelId,
            noteId: targetNoteId,
            existingPosition: existingPanel.position,
            requestedPosition: position
          }
        })
        return prev
      }

      return [
        ...prev,
        createPanelItem(
          panelId,
          position,
          panelType,
          targetNoteId,
          hydratedStoreKey,
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

  const uniqueNoteIds = useMemo(
    () => Array.from(new Set(noteIds.filter((id): id is string => typeof id === 'string' && id.length > 0))),
    [noteIds]
  )

  const secondaryNoteIds = useMemo(
    () => uniqueNoteIds.filter(id => id !== noteId),
    [uniqueNoteIds, noteId]
  )

  // Subscribe to panel creation events
  useEffect(() => {
    const handlePanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        handleCreatePanel(
          event.detail.panelId,
          event.detail.parentPanelId,
          event.detail.parentPosition,
          event.detail.noteId,
          false, // isPreview
          event.detail.coordinateSpace // Pass coordinate space flag
        )
      }
    }
    
    const handlePreviewPanelEvent = (event: CustomEvent) => {
      console.log('[AnnotationCanvas] Received preview-panel event:', event.detail)

      if (event.detail?.panelId) {
        // Create a temporary preview panel
        // Use previewPosition if provided (viewport-relative), otherwise use parentPosition
        const position = event.detail.previewPosition || event.detail.parentPosition

        console.log('[AnnotationCanvas] Creating preview panel:', {
          panelId: event.detail.panelId,
          position,
          isPreview: true
        })

        handleCreatePanel(
          event.detail.panelId,
          event.detail.parentPanelId,
          position,
          event.detail.noteId,
          true  // isPreview = true, forces use of provided position
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

  useCanvasAutosave({
    noteId,
    canvasItems,
    getItemNoteId,
    viewportSnapshot,
    isStateLoaded,
    activeWorkspaceVersion,
    updateDedupeWarnings,
    autoSaveTimerRef,
  })

  const { resolvePanelPosition, centerOnPanel } = usePanelCentering({
    noteId,
    canvasItemsRef,
    dataStore,
    resolveWorkspacePosition,
    isDefaultOffscreenPosition,
    canvasStateRef,
    setCanvasState,
    dispatch,
  })

  const handleRestoreMainPosition = useCallback(
    (targetNoteId: string, persistedPosition: { x: number; y: number }) => {
      const storeKey = ensurePanelKey(targetNoteId, 'main')
      const normalizedPosition = { x: persistedPosition.x, y: persistedPosition.y }

      setCanvasItems(prev =>
        prev.map(item => {
          if (item.itemType === 'panel' && item.panelId === 'main') {
            const itemNoteId = getItemNoteId(item)
            if (itemNoteId === targetNoteId) {
              return { ...item, position: normalizedPosition }
            }
          }
          return item
        }),
      )

      if (dataStore) {
        try {
          dataStore.update(storeKey, { position: normalizedPosition })
        } catch (error) {
          console.warn('[AnnotationCanvas] Failed to update dataStore for restore', error)
        }
      }

      persistPanelUpdate({
        panelId: 'main',
        storeKey,
        position: normalizedPosition,
        coordinateSpace: 'world',
      }).catch(error => {
        console.warn('[AnnotationCanvas] Failed to persist panel during restore', error)
      })

      void updateMainPosition(targetNoteId, normalizedPosition).catch(error => {
        console.error('[AnnotationCanvas] Failed to update workspace main position during restore', error)
      })

      debugLog({
        component: 'AnnotationCanvas',
        action: 'restore_main_position',
        metadata: { noteId: targetNoteId, position: normalizedPosition },
      })

      onMainOnlyLayoutHandled?.(targetNoteId)
      centerOnPanel(storeKey)
    },
    [centerOnPanel, dataStore, getItemNoteId, onMainOnlyLayoutHandled, persistPanelUpdate, setCanvasItems, updateMainPosition],
  )

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      updateCanvasTransform(prev => {
        const newZoom = Math.min(prev.zoom * 1.1, 2)
        return { ...prev, zoom: newZoom }
      })
    },
    zoomOut: () => {
      updateCanvasTransform(prev => {
        const newZoom = Math.max(prev.zoom * 0.9, 0.3)
        return { ...prev, zoom: newZoom }
      })
    },
    resetView: () => {
      updateCanvasTransform(prev => {
        return { ...prev, zoom: 1, translateX: 0, translateY: 0 }
      })
    },
    getCameraState: () => {
      // Use ref to get current value, not stale closure value
      return {
        translateX: canvasStateRef.current.translateX,
        translateY: canvasStateRef.current.translateY,
        zoom: canvasStateRef.current.zoom
      }
    },
    panBy,
    toggleConnections: () => {
      setCanvasState(prev => {
        return { ...prev, showConnections: !prev.showConnections }
      })
    },
    centerOnPanel,
    addComponent: (type: string, position?: { x: number; y: number }) => {
      handleAddComponent(type, position)
    }
  }), [onCanvasStateChange, canvasState, updateCanvasTransform, panBy, handleAddComponent, resolveWorkspacePosition, dataStore, noteId])

  useEffect(() => {
    debugLog({
      component: 'AnnotationApp',
      action: 'canvas_outline_applied',
      metadata: {
        outline: 'rgba(99, 102, 241, 0.85) solid 4px',
        outlineOffset: '6px'
      }
    })
  }, [])

  return (
    <>
      {secondaryNoteIds.map(id => (
        <NoteHydrator
          key={`hydrator-${id}`}
          noteId={id}
          userId={cameraUserId ?? undefined}
          dataStore={dataStore}
          branchesMap={branchesMap}
          layerManager={layerManagerApi.manager}
          enabled={true}
          workspaceVersion={workspaceNoteMap.get(id)?.version ?? null}
          onHydration={handleNoteHydration}
        />
      ))}
      <div
        className="w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500"
        style={{
          opacity: canvasOpacity,
          transition: 'opacity 0.3s ease',
        }}
      >
        {dedupeWarnings.length > 0 && (
          <div className="fixed top-4 right-4 z-[1100] max-w-sm rounded-md border border-amber-500/80 bg-white/95 p-4 shadow-lg text-sm text-amber-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Canvas state warnings</p>
                <p className="text-xs text-amber-700">
                  Some panels are missing metadata and were normalised. Please review before continuing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateDedupeWarnings([], { append: false })}
                className="text-xs font-medium text-amber-700 hover:text-amber-800"
              >
                Dismiss
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {dedupeWarnings.slice(0, 5).map((warning, index) => (
                <li key={`${warning.code}-${warning.storeKey ?? warning.panelId ?? index}`} className="leading-snug">
                  {warning.message}
                </li>
              ))}
            </ul>
            {dedupeWarnings.length > 5 && (
              <p className="mt-2 text-xs text-amber-700">
                +{dedupeWarnings.length - 5} more warning{dedupeWarnings.length - 5 === 1 ? '' : 's'} logged to console.
              </p>
            )}
          </div>
        )}
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
          className="fixed top-16 right-4 p-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg shadow-lg transition-all duration-200 hover:scale-110"
          style={{ zIndex: Z_INDEX.CANVAS_MINIMAP }}
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
          onNavigate={handleMinimapNavigate}
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
            // Canvas boundary - thick border around viewport
            outline: 'rgba(99, 102, 241, 0.85) solid 4px',
            outlineOffset: '6px',
          }}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onMouseMoveCapture={handleCanvasMouseMoveCapture}
          onWheelCapture={handleCanvasWheelCapture}
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
            {/* Grid Background - Moves with canvas */}
            <div
              style={{
                position: 'absolute',
                left: '-5000px',
                top: '-5000px',
                width: '20000px',
                height: '16000px',
                backgroundImage: `
                  linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
                `,
                backgroundSize: '100px 100px',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            {/* Grid Coordinate Labels - Shows world coordinates */}
            {/* X-axis labels across multiple Y positions */}
            {Array.from({ length: 20 }, (_, xi) => xi * 1000).flatMap(x =>
              Array.from({ length: 10 }, (_, yi) => yi * 1000).map(y => (
                <div
                  key={`label-x${x}-y${y}`}
                  style={{
                    position: 'absolute',
                    left: `${x}px`,
                    top: `${y}px`,
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    fontFamily: 'monospace',
                    pointerEvents: 'none',
                    padding: '4px 8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    zIndex: 1,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                >
                  ({x}, {y})
                </div>
              ))
            )}

            {/* Connection Lines - Widget Studio Style */}
            {canvasState.showConnections && (!isPlainModeActive() || primaryHydrationStatus.success) && (
              <WidgetStudioConnections
                key={canvasContextState.lastUpdate ?? 0}
                canvasItems={canvasItems}
                branchVersion={canvasContextState.lastUpdate ?? 0}
              />
            )}

            {/* Panels */}
        <PanelsRenderer
          defaultNoteId={noteId}
          canvasItems={canvasItems}
          dataStore={dataStore}
          resolveWorkspacePosition={resolveWorkspacePosition}
          onRestorePanelPosition={handleRestoreMainPosition}
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
    </>
  )
})

const ModernAnnotationCanvas = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>((props, ref) => {
  const { getWorkspace } = useCanvasWorkspace()
  const workspace = useMemo(() => getWorkspace(SHARED_WORKSPACE_ID), [getWorkspace])
  const activeNoteId = props.primaryNoteId ?? props.noteIds[0] ?? ""

  useEffect(() => {
    scheduleCanvasSnapshotDedupeMigration()
  }, [])

  return (
    <IsolationProvider config={{ enabled: false }}>
      <LayerManagerProvider manager={workspace.layerManager}>
        <CanvasProvider
          noteId={activeNoteId}
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
  defaultNoteId,
  canvasItems,
  dataStore,
  onClose,
  resolveWorkspacePosition,
  onRestorePanelPosition,
}: {
  defaultNoteId: string
  canvasItems: CanvasItem[]
  dataStore: DataStore
  onClose: (id: string, noteId?: string) => void
  resolveWorkspacePosition?: (noteId: string) => { x: number; y: number } | null
  onRestorePanelPosition?: (noteId: string, position: { x: number; y: number }) => void
}) {
  const isPlainMode = isPlainModeActive()
  const seenStoreKeys = new Set<string>()
  
  // Yjs access only when not in plain mode
  const provider = UnifiedProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(defaultNoteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null
  
  const panels = canvasItems.filter(isPanel)
  
  return (
    <>
      {panels.map((panel) => {
        const panelId = panel.panelId!
        const panelNoteId = panel.noteId ?? defaultNoteId
        const storeKey = panel.storeKey ?? ensurePanelKey(panelNoteId, panelId)
        const branch = isPlainMode ? dataStore.get(storeKey) : branchesMap?.get(storeKey)
        if (!branch) {
          console.warn(
            `[PanelsRenderer] Branch ${panelId} (note=${panelNoteId}, storeKey=${storeKey}) not found in ${isPlainMode ? 'plain' : 'yjs'} store`,
          )
          return null
        }

        if (seenStoreKeys.has(storeKey)) {
          console.warn(
            `[PanelsRenderer] Duplicate store key detected; skipping render`,
            { panelId, panelNoteId, storeKey },
          )
          return null
        }
        seenStoreKeys.add(storeKey)

        if (isDebugEnabled()) {
          // Debug: Log branch type being passed to CanvasPanel
          debugLog({
            component: 'AnnotationCanvas',
            action: 'rendering_panel',
            metadata: {
              panelId,
              branchType: branch.type,
              branchDbType: branch.dbType,
              branchMetadata: branch.metadata,
              isPlainMode,
            },
          })

          console.log(`[PanelsRenderer] Rendering panel ${panelId}:`, {
            hasContent: !!branch.content,
            contentLength: typeof branch.content === 'string' ? branch.content.length : 'N/A',
            isNew: branch.isNew,
            isEditable: branch.isEditable,
          })
        }

        // CRITICAL FIX: Only use workspacePosition for MAIN panel
        // Branch panels should use their own branch.position, NOT the main panel's workspace position
        const workspacePosition = (panelId === 'main') ? (resolveWorkspacePosition?.(panelNoteId) ?? null) : null
        const position = workspacePosition ?? branch.position ?? getDefaultMainPosition()

        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_position_resolution',
          metadata: {
            panelId,
            panelNoteId,
            branchPosition: branch.position,
            workspacePosition,
            finalPosition: position
          }
        })
        const shouldOfferRestore =
          panelId === 'main' &&
          workspacePosition &&
          (Math.round(workspacePosition.x) !== Math.round(position.x) ||
            Math.round(workspacePosition.y) !== Math.round(position.y))

        return (
          <CanvasPanel
            key={storeKey}
            panelId={panelId}
            branch={branch}
            position={position}
            noteId={panelNoteId}
            onClose={() => onClose(panelId, panelNoteId)}
            canRestorePosition={Boolean(shouldOfferRestore)}
            onRestorePosition={
              shouldOfferRestore && workspacePosition && onRestorePanelPosition
                ? () => onRestorePanelPosition(panelNoteId, workspacePosition)
                : undefined
            }
          />
        )
      })}
    </>
  )
}

export default ModernAnnotationCanvas 
