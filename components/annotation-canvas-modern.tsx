"use client"

import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react"
import { CanvasProvider, useCanvas } from "./canvas/canvas-context"
import type { DataStore } from "@/lib/data-store"
import { IsolationProvider } from "@/lib/isolation/context"
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
import { PanelsRenderer } from "./canvas/panels-renderer"
import { CanvasItem } from "@/types/canvas-items"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
// IsolationDebugPanel now integrated into EnhancedControlPanelV2
import { loadStateFromStorage } from "@/lib/canvas/canvas-storage"
import { getPlainProvider } from "@/lib/provider-switcher"
import { worldToScreen } from "@/lib/canvas/coordinate-utils"
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
import { useStickyOverlayElement } from "@/lib/hooks/annotation/use-sticky-overlay-element"
import { useCanvasInteractionCapture } from "@/lib/hooks/annotation/use-canvas-interaction-capture"
import { useCanvasPointerHandlers } from "@/lib/hooks/annotation/use-canvas-pointer-handlers"
import { useMinimapNavigation } from "@/lib/hooks/annotation/use-minimap-navigation"
import { usePanelCloseHandler } from "@/lib/hooks/annotation/use-panel-close-handler"
import { useCameraSnapshotPersistence } from "@/lib/hooks/annotation/use-camera-snapshot-persistence"
import { useCanvasContextSync } from "@/lib/hooks/annotation/use-canvas-context-sync"
import { useWorkspaceSeedRegistry } from "@/lib/hooks/annotation/use-workspace-seed-registry"
import { usePanelCentering } from "@/lib/hooks/annotation/use-panel-centering"
import { usePanelCreationEvents } from "@/lib/hooks/annotation/use-panel-creation-events"
import { usePanelCreationHandler } from "@/lib/hooks/annotation/use-panel-creation-handler"
import { useMainPanelRestore } from "@/lib/hooks/annotation/use-main-panel-restore"
import { useComponentCreationHandler } from "@/lib/hooks/annotation/use-component-creation-handler"
import { useWorkspacePositionResolver } from "@/lib/hooks/annotation/use-workspace-position-resolver"
import { useStickyNoteOverlayPanels } from "@/lib/hooks/annotation/use-sticky-note-overlay-panels"
import { useViewportChangeLogger } from "@/lib/hooks/annotation/use-viewport-change-logger"
import { useMainOnlyPanelFilter } from "@/lib/hooks/annotation/use-main-only-panel-filter"
import { useAddComponentMenu } from "@/lib/hooks/annotation/use-add-component-menu"
import { useDedupeWarningBanner } from "@/lib/hooks/annotation/use-dedupe-warning-banner"
import { useCanvasOutlineDebug } from "@/lib/hooks/annotation/use-canvas-outline-debug"
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
  workspaceId?: string | null
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
  noteTitleMap?: Map<string, string> | null
  workspaceSnapshotRevision?: number
  onComponentChange?: () => void
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
  onFreshNoteHydrated,
  noteTitleMap = null,
  workspaceSnapshotRevision = 0,
  onComponentChange,
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
  const { resolveWorkspacePosition, workspaceMainPosition } = useWorkspacePositionResolver({
    noteId,
    workspaceNoteMap,
    getPendingPosition,
    getCachedPosition,
    isDefaultOffscreenPosition,
  })
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

  useViewportChangeLogger({ noteId, canvasState })

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
  const mainPanelSeededRef = useRef(false)
  const provider = useMemo(() => UnifiedProvider.getInstance(), [])
  const branchesMap = useMemo(() => provider.getBranchesMap(), [provider])

  useWorkspaceSeedRegistry({
    noteId,
    workspaceSeededNotesRef,
    mainPanelSeededRef,
    debugLog,
  })
  const isRestoringSnapshotRef = useRef(false)
  const skipNextContextSyncRef = useRef(false)

  useMainOnlyPanelFilter({
    mainOnlyNoteIds,
    mainOnlyNoteSet,
    setCanvasItems,
    getItemNoteId,
  })
  
  const { showAddComponentMenu, toggleAddComponentMenu, closeAddComponentMenu } = useAddComponentMenu({
    externalShowAddComponentMenu,
    onToggleAddComponentMenu,
  })
  const stickyOverlayEl = useStickyOverlayElement()
  const {
    hasWarnings,
    visibleWarnings,
    extraCount: dedupeExtraCount,
    dismissWarnings,
  } = useDedupeWarningBanner({
    dedupeWarnings,
    updateDedupeWarnings,
  })

  // Canvas state persistence - Get provider instances for hydration
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
    dataStore,
    branchesMap,
    hydrationStateKey: `${primaryHydrationStatus.success}-${primaryHydrationStatus.panelsLoaded}`,
    workspaceSnapshotRevision,
  })

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
    persistCameraSnapshot,
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

  const { handleCreatePanel } = usePanelCreationHandler({
    noteId,
    canvasState,
    getItemNoteId,
    setCanvasItems,
    dataStore,
    branchesMap,
    provider,
    persistPanelCreate,
    persistPanelUpdate,
  })
  const {
    handleAddComponent,
    handleComponentClose,
    handleComponentPositionChange,
    stickyNoteItems,
    floatingComponents,
  } = useComponentCreationHandler({
    canvasState,
    canvasItems,
    setCanvasItems,
    layerManager: layerManagerApi.manager,
    onComponentChange,
  })

  // Rehydrate component items from the current workspace LayerManager when snapshot/revision changes.
  useEffect(() => {
    const lm = layerManagerApi.manager
    if (!lm || typeof lm.getNodes !== "function") return
    const nodes = Array.from(lm.getNodes().values()).filter((node: any) => node.type === "component")
    if (nodes.length === 0) {
      setCanvasItems((prev: CanvasItem[]) => prev.filter((item: CanvasItem) => item.itemType !== "component"))
      return
    }
    setCanvasItems((prev: CanvasItem[]) => {
      const nonComponentItems = prev.filter((item: CanvasItem) => item.itemType !== "component")
      const nextComponents = nodes.map((node: any) => ({
        id: node.id,
        itemType: "component" as const,
        componentType: (node as any).metadata?.componentType ?? (node as any).type,
        position: node.position ?? { x: 0, y: 0 },
        zIndex: typeof node.zIndex === "number" ? node.zIndex : undefined,
        dimensions: (node as any).dimensions ?? undefined,
      }))
      const byId = new Map<string, any>()
      nextComponents.forEach((c) => byId.set(c.id, c))
      nonComponentItems.forEach((item) => byId.set(item.id, item))
      return Array.from(byId.values())
    })
  }, [layerManagerApi.manager, setCanvasItems, workspaceSnapshotRevision])
  const { stickyNoteOverlayPortal } = useStickyNoteOverlayPanels({
    stickyOverlayEl,
    stickyNoteItems,
    onClose: handleComponentClose,
    onPositionChange: handleComponentPositionChange,
  })

  const uniqueNoteIds = useMemo(
    () => Array.from(new Set(noteIds.filter((id): id is string => typeof id === 'string' && id.length > 0))),
    [noteIds]
  )

  const secondaryNoteIds = useMemo(
    () => uniqueNoteIds.filter(id => id !== noteId),
    [uniqueNoteIds, noteId]
  )

  usePanelCreationEvents({
    noteId,
    handleCreatePanel,
    handlePanelClose,
  })

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

  const { handleRestoreMainPosition } = useMainPanelRestore({
    setCanvasItems,
    getItemNoteId,
    dataStore,
    persistPanelUpdate,
    updateMainPosition,
    onMainOnlyLayoutHandled,
    centerOnPanel,
  })

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

  useCanvasOutlineDebug()

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
        {hasWarnings && (
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
                onClick={dismissWarnings}
                className="text-xs font-medium text-amber-700 hover:text-amber-800"
              >
                Dismiss
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {visibleWarnings.map((warning, index) => (
                <li key={`${warning.code}-${warning.storeKey ?? warning.panelId ?? index}`} className="leading-snug">
                  {warning.message}
                </li>
              ))}
            </ul>
            {dedupeExtraCount > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                +{dedupeExtraCount} more warning{dedupeExtraCount === 1 ? '' : 's'} logged to console.
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
          onClose={closeAddComponentMenu}
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
          hydrationReady={primaryHydrationStatus.success}
          noteTitleMap={noteTitleMap}
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

        {stickyNoteOverlayPortal}

        {/* Annotation Toolbar - controlled by Actions button */}
        <AnnotationToolbar />

      </div>
    </>
  )
})

const ModernAnnotationCanvas = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>((props, ref) => {
  const { getWorkspace } = useCanvasWorkspace()
  const workspace = useMemo(() => getWorkspace(props.workspaceId ?? SHARED_WORKSPACE_ID), [getWorkspace, props.workspaceId])
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

export default ModernAnnotationCanvas
